import webpush from "web-push";
import type { PushJob } from "../shared/contracts";
import { validPushEndpoint } from "./security";

interface DeliveryRow {
  title: string;
  body: string;
  priority: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  status: string;
  attempts: number;
}

export async function deliver(env: Env, job: PushJob): Promise<"done" | "retry"> {
  const row =
    await env.DB.prepare(`SELECT n.title, n.body, n.priority, d.endpoint, d.p256dh, d.auth, x.status, x.attempts
    FROM deliveries x JOIN notifications n ON n.id = x.notification_id JOIN devices d ON d.id = x.device_id
    WHERE x.notification_id = ? AND x.device_id = ?`)
      .bind(job.notificationId, job.deviceId)
      .first<DeliveryRow>();
  if (!row || row.status !== "pending") return "done";
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !validPushEndpoint(row.endpoint))
    return "retry";
  const payload = JSON.stringify({
    id: job.notificationId,
    title: row.title,
    body: row.body,
    priority: row.priority,
  });
  const request = webpush.generateRequestDetails(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    payload,
    {
      TTL: 86400,
      urgency: row.priority === "urgent" || row.priority === "high" ? "high" : "normal",
      vapidDetails: {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
    },
  );
  let status = 0;
  try {
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers as Record<string, string>,
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    status = response.status;
    await response.body?.cancel();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "push_transport_error",
        name: error instanceof Error ? error.name : "unknown",
      }),
    );
    /* Network failures retain the durable outbox entry. */
  }
  if (status === 404 || status === 410) {
    await env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(job.deviceId).run();
    return "done";
  }
  const accepted = status >= 200 && status < 300;
  const permanent = status >= 300 && status < 500 && status !== 408 && status !== 429;
  const exhausted = row.attempts >= 9;
  await env.DB.prepare(
    "UPDATE deliveries SET status = ?, attempts = attempts + 1, last_status = ?, updated_at = ? WHERE notification_id = ? AND device_id = ?",
  )
    .bind(
      accepted ? "accepted" : permanent || exhausted ? "failed" : "pending",
      status,
      Date.now(),
      job.notificationId,
      job.deviceId,
    )
    .run();
  return accepted || permanent || exhausted ? "done" : "retry";
}
