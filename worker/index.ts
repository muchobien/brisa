import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  heartbeatSchema,
  publishSchema,
  subscriptionSchema,
  topicSchema,
} from "../shared/contracts";
import type { Device, Heartbeat, PushJob, Token, Topic, Notification } from "../shared/contracts";
import { hash, matchesSecret, secret, validPushEndpoint, validPushKey } from "./security";
import { publish } from "./publish";
import { deliver } from "./push";
import { maintain } from "./scheduled";

const app = new Hono<{ Bindings: Env; Variables: { topicId: string } }>();
app.use(
  "/api/*",
  bodyLimit({ maxSize: 32768, onError: (c) => c.json({ error: "Request is too large" }, 413) }),
);
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin)
      return c.json({ error: "Cross-origin requests are not allowed" }, 403);
  }
  await next();
});
app.get("/api/health", (c) => c.json({ ok: true, name: "brisa" }));
app.get("/api/session", async (c) => {
  const value = getCookie(c, "brisa_session");
  const row = value
    ? await c.env.DB.prepare("SELECT hash FROM sessions WHERE hash = ? AND expires_at > ?")
        .bind(await hash(value), Date.now())
        .first()
    : null;
  return c.json({
    authenticated: !!row,
    configured: !!c.env.ADMIN_TOKEN && c.env.ADMIN_TOKEN.length >= 32,
  });
});
app.post("/api/login", async (c) => {
  if (!c.env.ADMIN_TOKEN || c.env.ADMIN_TOKEN.length < 32)
    return c.json({ error: "Run the setup script to configure a workspace access key." }, 503);
  const input = z.object({ key: z.string().max(256) }).parse(await c.req.json());
  const key = await hash(c.req.header("CF-Connecting-IP") ?? "local");
  const now = Date.now();
  const attempt =
    await c.env.DB.prepare(`INSERT INTO login_attempts (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at < ? THEN 1 ELSE count + 1 END,
    expires_at = CASE WHEN expires_at < ? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
      .bind(key, now + 60000, now, now)
      .first<{ count: number }>();
  if ((attempt?.count ?? 99) > 10)
    return c.json({ error: "Too many attempts. Try again in a minute." }, 429);
  if (!(await matchesSecret(input.key, c.env.ADMIN_TOKEN)))
    return c.json({ error: "That access key does not match this workspace." }, 401);
  const session = secret();
  await c.env.DB.prepare("INSERT INTO sessions (hash, expires_at) VALUES (?, ?)")
    .bind(await hash(session), now + 30 * 86400000)
    .run();
  setCookie(c, "brisa_session", session, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 86400,
  });
  return c.json({ ok: true });
});
app.post("/api/logout", async (c) => {
  const session = getCookie(c, "brisa_session");
  if (session)
    await c.env.DB.prepare("DELETE FROM sessions WHERE hash = ?")
      .bind(await hash(session))
      .run();
  deleteCookie(c, "brisa_session", { path: "/" });
  return c.json({ ok: true });
});

// Only the three ingestion paths accept scoped publishing keys. Management uses cookies.
app.use("/api/*", async (c, next) => {
  if (/^\/api\/(publish|webhooks\/grafana|heartbeats\/[^/]+\/ping)$/.test(c.req.path)) {
    const authorization = c.req.header("Authorization") ?? "";
    if (!authorization.startsWith("Bearer "))
      return c.json({ error: "A publishing key is required" }, 401);
    const token = await c.env.DB.prepare("SELECT id, topic_id FROM tokens WHERE hash = ?")
      .bind(await hash(authorization.slice(7)))
      .first<{ id: string; topic_id: string }>();
    if (!token) return c.json({ error: "Invalid publishing key" }, 401);
    c.set("topicId", token.topic_id);
    await c.env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?")
      .bind(Date.now(), token.id)
      .run();
    await next();
    return;
  }
  const session = getCookie(c, "brisa_session");
  const row = session
    ? await c.env.DB.prepare("SELECT hash FROM sessions WHERE hash = ? AND expires_at > ?")
        .bind(await hash(session), Date.now())
        .first()
    : null;
  if (!row) return c.json({ error: "Sign in to your workspace" }, 401);
  await next();
});
app.get("/api/snapshot", async (c) => {
  const [topics, notifications, devices, links, tokens, heartbeats] = await c.env.DB.batch([
    c.env.DB
      .prepare(`SELECT t.*, COUNT(n.id) AS total, SUM(CASE WHEN n.id IS NOT NULL AND n.read_at IS NULL THEN 1 ELSE 0 END) AS unread
      FROM topics t LEFT JOIN notifications n ON t.id = n.topic_id GROUP BY t.id ORDER BY t.created_at`),
    c.env.DB.prepare(
      "SELECT n.*, t.name AS topic_name, t.color AS topic_color FROM notifications n JOIN topics t ON t.id = n.topic_id ORDER BY n.created_at DESC LIMIT 500",
    ),
    c.env.DB.prepare("SELECT id, name, created_at FROM devices ORDER BY created_at"),
    c.env.DB.prepare("SELECT device_id, topic_id FROM device_topics"),
    c.env.DB.prepare(
      "SELECT id, name, topic_id, created_at, last_used_at FROM tokens ORDER BY created_at DESC",
    ),
    c.env.DB.prepare("SELECT * FROM heartbeats ORDER BY created_at"),
  ]);
  if (!topics || !notifications || !devices || !links || !tokens || !heartbeats)
    throw new Error("Incomplete snapshot");
  const topicLinks = links.results as { device_id: string; topic_id: string }[];
  return c.json({
    topics: topics.results as unknown as Topic[],
    notifications: notifications.results as unknown as Notification[],
    devices: (devices.results as unknown as Omit<Device, "topics">[]).map((d) => ({
      ...d,
      topics: topicLinks.filter((link) => link.device_id === d.id).map((link) => link.topic_id),
    })),
    tokens: tokens.results as unknown as Token[],
    heartbeats: heartbeats.results as unknown as Heartbeat[],
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY ?? "",
    pushConfigured: !!c.env.VAPID_PUBLIC_KEY && !!c.env.VAPID_PRIVATE_KEY,
  });
});
app.post("/api/topics", async (c) => {
  const input = topicSchema.parse(await c.req.json());
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM topics").first<{
    count: number;
  }>();
  if ((count?.count ?? 0) >= 50)
    return c.json({ error: "This workspace supports up to 50 topics" }, 409);
  const existing = await c.env.DB.prepare("SELECT id FROM topics WHERE name = ?")
    .bind(input.name)
    .first();
  if (existing) return c.json({ error: "A topic with that name already exists" }, 409);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO topics (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, input.name, input.description, input.color, Date.now())
    .run();
  return c.json({ id }, 201);
});
app.delete("/api/topics/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM topics WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
app.post("/api/notifications", async (c) => {
  const input = publishSchema.safeExtend({ topic_id: z.string().min(1) }).parse(await c.req.json());
  if (!(await c.env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(input.topic_id).first()))
    return c.json({ error: "Topic not found" }, 404);
  return c.json({ id: await publish(c.env, input.topic_id, input, "console") }, 201);
});
app.post("/api/notifications/read", async (c) => {
  const input = z
    .object({ ids: z.array(z.string()).min(1).max(500), read: z.boolean().default(true) })
    .parse(await c.req.json());
  await c.env.DB.batch(
    input.ids.map((id) =>
      c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ?").bind(
        input.read ? Date.now() : null,
        id,
      ),
    ),
  );
  return c.json({ ok: true });
});
app.delete("/api/notifications/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM notifications WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
app.post("/api/tokens", async (c) => {
  const input = z
    .object({ name: z.string().trim().min(1).max(80), topic_id: z.string() })
    .parse(await c.req.json());
  if (!(await c.env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(input.topic_id).first()))
    return c.json({ error: "Topic not found" }, 404);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM tokens").first<{
    count: number;
  }>();
  if ((count?.count ?? 0) >= 100)
    return c.json({ error: "Revoke an unused key before creating another" }, 409);
  const token = `brisa_${secret()}`;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO tokens (id, name, hash, topic_id, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, input.name, await hash(token), input.topic_id, Date.now())
    .run();
  return c.json({ id, token }, 201);
});
app.delete("/api/tokens/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM tokens WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
app.post("/api/devices", async (c) => {
  const input = subscriptionSchema.parse(await c.req.json());
  if (!validPushEndpoint(input.endpoint) || !validPushKey(input.keys.p256dh))
    return c.json({ error: "Unsupported browser push provider" }, 400);
  const topics = await c.env.DB.prepare("SELECT id FROM topics").all<{ id: string }>();
  if (input.topics.some((id) => !topics.results.some((topic) => topic.id === id)))
    return c.json({ error: "Unknown topic" }, 400);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM devices").first<{
    count: number;
  }>();
  const existing = await c.env.DB.prepare("SELECT id FROM devices WHERE endpoint = ?")
    .bind(input.endpoint)
    .first<{ id: string }>();
  if (!existing && (count?.count ?? 0) >= 50)
    return c.json({ error: "Remove an unused device before adding another" }, 409);
  const id = existing?.id ?? crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO devices (id, name, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET name = excluded.name, p256dh = excluded.p256dh, auth = excluded.auth",
    ).bind(id, input.name, input.endpoint, input.keys.p256dh, input.keys.auth, Date.now()),
    c.env.DB.prepare("DELETE FROM device_topics WHERE device_id = ?").bind(id),
    ...[...new Set(input.topics)].map((topic) =>
      c.env.DB.prepare("INSERT INTO device_topics (device_id, topic_id) VALUES (?, ?)").bind(
        id,
        topic,
      ),
    ),
  ]);
  return c.json({ id }, 201);
});
app.delete("/api/devices/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
app.post("/api/heartbeats", async (c) => {
  const input = heartbeatSchema.parse(await c.req.json());
  if (!(await c.env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(input.topic_id).first()))
    return c.json({ error: "Topic not found" }, 404);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM heartbeats").first<{
    count: number;
  }>();
  if ((count?.count ?? 0) >= 50)
    return c.json({ error: "This workspace supports up to 50 heartbeat monitors" }, 409);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO heartbeats (id, topic_id, name, interval_seconds, grace_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, input.topic_id, input.name, input.interval_seconds, input.grace_seconds, Date.now())
    .run();
  return c.json({ id }, 201);
});
app.delete("/api/heartbeats/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM heartbeats WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

app.post("/api/publish", async (c) => {
  const input = publishSchema.parse(await c.req.json());
  const key = c.req.header("Idempotency-Key");
  if (key && key.length > 128)
    return c.json({ error: "Idempotency-Key must be at most 128 characters" }, 400);
  const id = await publish(
    c.env,
    c.get("topicId"),
    input,
    "api",
    key ? `api:${c.get("topicId")}:${key}` : undefined,
  );
  return c.json({ id }, 202);
});
const grafanaSchema = z.object({
  alerts: z
    .array(
      z.object({
        status: z.enum(["firing", "resolved"]),
        labels: z.record(z.string(), z.string()),
        annotations: z.record(z.string(), z.string()).default({}),
        fingerprint: z.string().max(128),
        startsAt: z.string().max(64),
        endsAt: z.string().max(64).optional(),
        generatorURL: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
});
app.post("/api/webhooks/grafana", async (c) => {
  const input = grafanaSchema.parse(await c.req.json());
  const ids: string[] = [];
  for (const alert of input.alerts) {
    const name = alert.annotations.summary || alert.labels.alertname || "Grafana alert";
    const link = alert.generatorURL?.startsWith("https://") ? alert.generatorURL : undefined;
    const notification = publishSchema.parse({
      title: `${alert.status === "resolved" ? "Resolved" : "Firing"} · ${name}`.slice(0, 120),
      body: (alert.annotations.description || name).slice(0, 1800),
      priority:
        alert.status === "resolved"
          ? "normal"
          : alert.labels.severity === "critical"
            ? "urgent"
            : "high",
      url: link,
    });
    ids.push(
      await publish(
        c.env,
        c.get("topicId"),
        notification,
        "grafana",
        `grafana:${c.get("topicId")}:${alert.fingerprint}:${alert.status}:${alert.startsAt}:${alert.endsAt ?? ""}`,
      ),
    );
  }
  return c.json({ ids }, 202);
});
app.post("/api/heartbeats/:id/ping", async (c) => {
  const check = await c.env.DB.prepare("SELECT * FROM heartbeats WHERE id = ? AND topic_id = ?")
    .bind(c.req.param("id"), c.get("topicId"))
    .first<Heartbeat>();
  if (!check) return c.json({ error: "Heartbeat not found in this topic" }, 404);
  if (check.alerting)
    await publish(
      c.env,
      check.topic_id,
      {
        title: `${check.name} is back`,
        body: "Heartbeats are arriving again.",
        priority: "normal",
      },
      "heartbeat",
      `recovery:${check.id}:${check.last_seen_at ?? check.created_at}`,
    );
  await c.env.DB.prepare("UPDATE heartbeats SET last_seen_at = ?, alerting = 0 WHERE id = ?")
    .bind(Date.now(), check.id)
    .run();
  return c.json({ ok: true });
});
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error, c) => {
  if (error instanceof z.ZodError)
    return c.json({ error: error.issues[0]?.message ?? "Invalid input" }, 400);
  if (error instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
  console.error(JSON.stringify({ event: "request_failed", path: c.req.path, name: error.name }));
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<PushJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if ((await deliver(env, message.body)) === "retry")
          message.retry({ delaySeconds: Math.min(900, 30 * 2 ** Math.min(message.attempts, 5)) });
        else message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "delivery_error",
            reason: error instanceof Error ? error.message : "unknown",
          }),
        );
        message.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await maintain(env);
  },
} satisfies ExportedHandler<Env, PushJob>;
