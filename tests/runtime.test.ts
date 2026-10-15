import { beforeAll, afterAll, describe, expect, it, vi } from "vite-plus/test";
import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from "miniflare";
import { readFile } from "node:fs/promises";
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import type { Snapshot } from "../shared/contracts";

let mf: Miniflare;
let cookie = "";
let pushStatus = 201;
let pushCount = 0;
let encrypted = false;
const admin = randomBytes(32).toString("base64url");

async function request(
  path: string,
  data?: unknown,
  bearer?: string,
  method = data === undefined ? "GET" : "POST",
) {
  return mf.dispatchFetch(`https://brisa.test/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : { Cookie: cookie }),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
}
async function topic(name: string) {
  const response = await request("/topics", { name });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
async function token(topicId: string) {
  const response = await request("/tokens", { name: "Test service", topic_id: topicId });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; token: string };
}
async function snapshot(): Promise<Snapshot> {
  return (await (await request("/snapshot")).json()) as Snapshot;
}

beforeAll(async () => {
  const vapid = webpush.generateVAPIDKeys();
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "artifacts/test-worker/index.js",
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "brisa-tests" },
      queueProducers: { PUSH_QUEUE: "brisa-push" },
      queueConsumers: { "brisa-push": { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 0 } },
      bindings: {
        ADMIN_TOKEN: admin,
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: "mailto:test@example.com",
      },
      outboundService: async (request) => {
        pushCount++;
        encrypted =
          request.headers.get("Content-Encoding") === "aes128gcm" &&
          !!request.headers.get("Authorization")?.startsWith("vapid ");
        await request.arrayBuffer();
        return new WorkerResponse(null, { status: pushStatus });
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  const migration = await readFile("migrations/0001_initial.sql", "utf8");
  for (const sql of migration
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  const login = await request("/login", { key: admin });
  expect(login.status).toBe(200);
  cookie = login.headers.get("Set-Cookie")!.split(";")[0]!;
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});

describe("Worker with real D1 and Queues bindings", () => {
  it("protects management, prevents cross-origin writes, and limits login attempts", async () => {
    expect((await mf.dispatchFetch("https://brisa.test/api/snapshot")).status).toBe(401);
    expect(
      (
        await mf.dispatchFetch("https://brisa.test/api/topics", {
          method: "POST",
          headers: { Origin: "https://evil.test", Cookie: cookie },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    for (let i = 0; i < 9; i++)
      expect((await request("/login", { key: "wrong" })).status).toBe(401);
    expect((await request("/login", { key: "wrong" })).status).toBe(429);
  });
  it("keeps publishing keys scoped to publishing and deduplicates concurrent requests", async () => {
    const id = await topic("scope-test");
    const key = await token(id);
    expect((await request("/snapshot", undefined, key.token)).status).toBe(401);
    expect((await request("/topics", { name: "forbidden" }, key.token)).status).toBe(401);
    const publish = () =>
      mf.dispatchFetch("https://brisa.test/api/publish", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "same-event",
        },
        body: JSON.stringify({ title: "Only once", body: "D1 unique key handles the race." }),
      });
    const responses = await Promise.all([publish(), publish(), publish()]);
    expect(responses.every((r) => r.status === 202)).toBe(true);
    const data = await snapshot();
    expect(data.notifications.filter((n) => n.topic_id === id)).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain(key.token);
    const db = await mf.getD1Database("DB");
    const stored = await db
      .prepare("SELECT hash FROM tokens WHERE id = ?")
      .bind(key.id)
      .first<{ hash: string }>();
    expect(stored?.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("marks read status across the shared workspace and revokes keys", async () => {
    const id = await topic("read-test");
    const key = await token(id);
    const response = await request("/publish", { title: "Read me" }, key.token);
    const notice = (await response.json()) as { id: string };
    expect((await snapshot()).topics.find((t) => t.id === id)?.unread).toBe(1);
    await request("/notifications/read", { ids: [notice.id] });
    expect((await snapshot()).topics.find((t) => t.id === id)?.unread).toBe(0);
    await request(`/tokens/${key.id}`, undefined, undefined, "DELETE");
    expect((await request("/publish", { title: "Revoked" }, key.token)).status).toBe(401);
  });
  it("translates and deduplicates Grafana firing and resolved alerts", async () => {
    const id = await topic("grafana-test");
    const key = await token(id);
    const alert = {
      status: "firing",
      labels: { alertname: "Disk space low", severity: "critical" },
      annotations: { description: "Less than 10% free" },
      fingerprint: "disk-1",
      startsAt: "2026-10-15T00:00:00Z",
    };
    for (let i = 0; i < 2; i++)
      expect((await request("/webhooks/grafana", { alerts: [alert] }, key.token)).status).toBe(202);
    await request(
      "/webhooks/grafana",
      { alerts: [{ ...alert, status: "resolved", endsAt: "2026-10-15T01:00:00Z" }] },
      key.token,
    );
    const notices = (await snapshot()).notifications.filter((n) => n.topic_id === id);
    expect(notices).toHaveLength(2);
    expect(notices.some((n) => n.priority === "urgent" && n.title.startsWith("Firing"))).toBe(true);
    expect(notices.some((n) => n.title.startsWith("Resolved"))).toBe(true);
  });
  it("detects missed heartbeats externally, sends one alert, and reports recovery", async () => {
    const id = await topic("heartbeat-test");
    const key = await token(id);
    const response = await request("/heartbeats", {
      name: "Vega",
      topic_id: id,
      interval_seconds: 60,
      grace_seconds: 60,
    });
    const check = (await response.json()) as { id: string };
    const other = await token(await topic("other-heartbeat"));
    expect((await request(`/heartbeats/${check.id}/ping`, {}, other.token)).status).toBe(404);
    const db = await mf.getD1Database("DB");
    await db
      .prepare("UPDATE heartbeats SET created_at = ? WHERE id = ?")
      .bind(Date.now() - 180000, check.id)
      .run();
    const worker = await mf.getWorker();
    await worker.scheduled({ cron: "* * * * *" });
    await worker.scheduled({ cron: "* * * * *" });
    expect((await snapshot()).notifications.filter((n) => n.topic_id === id)).toHaveLength(1);
    await request(`/heartbeats/${check.id}/ping`, {}, key.token);
    const data = await snapshot();
    expect(data.heartbeats.find((h) => h.id === check.id)?.alerting).toBe(0);
    expect(data.notifications.filter((n) => n.topic_id === id)).toHaveLength(2);
  });
  it("encrypts a push in the Worker, records provider acceptance, and cleans expired endpoints", async () => {
    const id = await topic("push-test");
    const client = createECDH("prime256v1");
    client.generateKeys();
    const device = await request("/devices", {
      name: "Test browser",
      endpoint: "https://fcm.googleapis.com/fcm/send/test-only",
      keys: {
        p256dh: client.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
      topics: [id],
    });
    expect(device.status).toBe(201);
    const deviceId = ((await device.json()) as { id: string }).id;
    pushStatus = 201;
    const before = pushCount;
    const published = await request("/notifications", {
      topic_id: id,
      title: "An encrypted hello",
    });
    expect(published.status).toBe(201);
    const db = await mf.getD1Database("DB");
    await vi.waitFor(
      async () => {
        expect(pushCount).toBeGreaterThan(before);
        expect(
          (
            await db
              .prepare("SELECT status FROM deliveries WHERE device_id = ?")
              .bind(deviceId)
              .first<{ status: string }>()
          )?.status,
        ).toBe("accepted");
      },
      { timeout: 10000 },
    );
    expect(encrypted).toBe(true);
    pushStatus = 410;
    await request("/notifications", { topic_id: id, title: "An expired subscription" });
    await vi.waitFor(
      async () => {
        expect(
          await db.prepare("SELECT id FROM devices WHERE id = ?").bind(deviceId).first(),
        ).toBeNull();
      },
      { timeout: 10000 },
    );
  });
  it("recovers a throttled push from the durable outbox without republishing its message", async () => {
    const id = await topic("retry-test");
    const client = createECDH("prime256v1");
    client.generateKeys();
    const response = await request("/devices", {
      name: "Retry browser",
      endpoint: "https://fcm.googleapis.com/fcm/send/retry-test",
      keys: {
        p256dh: client.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
      topics: [id],
    });
    const deviceId = ((await response.json()) as { id: string }).id;
    const db = await mf.getD1Database("DB");
    pushStatus = 429;
    await request("/notifications", { topic_id: id, title: "Still waiting" });
    await vi.waitFor(async () => {
      expect(
        (
          await db
            .prepare("SELECT last_status FROM deliveries WHERE device_id = ?")
            .bind(deviceId)
            .first<{ last_status: number }>()
        )?.last_status,
      ).toBe(429);
    });
    pushStatus = 201;
    await db
      .prepare("UPDATE deliveries SET updated_at = ? WHERE device_id = ?")
      .bind(Date.now() - 360000, deviceId)
      .run();
    await (await mf.getWorker()).scheduled({ cron: "* * * * *" });
    await vi.waitFor(async () => {
      expect(
        (
          await db
            .prepare("SELECT status FROM deliveries WHERE device_id = ?")
            .bind(deviceId)
            .first<{ status: string }>()
        )?.status,
      ).toBe("accepted");
    });
    expect((await snapshot()).notifications.filter((n) => n.topic_id === id)).toHaveLength(1);
    await request(`/devices/${deviceId}`, undefined, undefined, "DELETE");
  });
  it("removes retained history and expired sessions during scheduled maintenance", async () => {
    const id = await topic("retention-test");
    const response = await request("/notifications", { topic_id: id, title: "Old news" });
    const noticeId = ((await response.json()) as { id: string }).id;
    const db = await mf.getD1Database("DB");
    await db
      .prepare("UPDATE notifications SET created_at = ? WHERE id = ?")
      .bind(Date.now() - 31 * 86400000, noticeId)
      .run();
    await db.prepare("INSERT INTO sessions (hash, expires_at) VALUES ('expired-session', 1)").run();
    await (await mf.getWorker()).scheduled({ cron: "* * * * *" });
    expect(
      await db.prepare("SELECT id FROM notifications WHERE id = ?").bind(noticeId).first(),
    ).toBeNull();
    expect(
      await db.prepare("SELECT hash FROM sessions WHERE hash = 'expired-session'").first(),
    ).toBeNull();
  });
  it("rejects arbitrary subscription endpoints and unsafe notification links", async () => {
    const id = await topic("unsafe-test");
    const client = createECDH("prime256v1");
    client.generateKeys();
    expect(
      (
        await request("/devices", {
          name: "Bad endpoint",
          endpoint: "https://127.0.0.1/admin",
          keys: {
            p256dh: client.getPublicKey().toString("base64url"),
            auth: randomBytes(16).toString("base64url"),
          },
          topics: [id],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/notifications", {
          topic_id: id,
          title: "Bad link",
          url: "javascript:alert(1)",
        })
      ).status,
    ).toBe(400);
  });
  it("cascades topic deletion without leaving notifications or publishing credentials", async () => {
    const id = await topic("delete-test");
    const key = await token(id);
    await request("/publish", { title: "Temporary" }, key.token);
    await request(`/topics/${id}`, undefined, undefined, "DELETE");
    const data = await snapshot();
    expect(data.notifications.some((n) => n.topic_id === id)).toBe(false);
    expect(data.tokens.some((t) => t.topic_id === id)).toBe(false);
    expect((await request("/publish", { title: "Cannot publish" }, key.token)).status).toBe(401);
  });
});
