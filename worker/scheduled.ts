import type { Heartbeat, PushJob } from "../shared/contracts";
import { publish } from "./publish";

export async function maintain(env: Env): Promise<void> {
  const now = Date.now();
  const { results: checks } = await env.DB.prepare("SELECT * FROM heartbeats").all<Heartbeat>();
  for (const check of checks) {
    const overdue =
      now - (check.last_seen_at ?? check.created_at) >
      (check.interval_seconds + check.grace_seconds) * 1000;
    if (overdue && !check.alerting) {
      await publish(
        env,
        check.topic_id,
        {
          title: `${check.name} missed a heartbeat`,
          body: "No heartbeat arrived within the expected interval and grace period.",
          priority: "urgent",
        },
        "heartbeat",
        `heartbeat:${check.id}:${check.last_seen_at ?? check.created_at}`,
      );
      await env.DB.prepare(
        "UPDATE heartbeats SET alerting = 1 WHERE id = ? AND COALESCE(last_seen_at, created_at) = ?",
      )
        .bind(check.id, check.last_seen_at ?? check.created_at)
        .run();
    }
  }
  const { results: pending } = await env.DB.prepare(
    "SELECT notification_id, device_id FROM deliveries WHERE status = 'pending' AND updated_at < ? ORDER BY updated_at LIMIT 100",
  )
    .bind(now - 300000)
    .all<{ notification_id: string; device_id: string }>();
  for (const row of pending) {
    await env.PUSH_QUEUE.send({
      notificationId: row.notification_id,
      deviceId: row.device_id,
    } satisfies PushJob);
    await env.DB.prepare(
      "UPDATE deliveries SET updated_at = ? WHERE notification_id = ? AND device_id = ? AND status = 'pending'",
    )
      .bind(now, row.notification_id, row.device_id)
      .run();
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM login_attempts WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM notifications WHERE created_at < ?").bind(now - 30 * 86400000),
  ]);
}
