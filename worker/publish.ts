import type { PublishInput, PushJob } from "../shared/contracts";

// Notification + delivery outbox is one D1 transaction. Cron repairs queue-send failures.
export async function publish(
  env: Env,
  topicId: string,
  input: PublishInput,
  source = "api",
  idempotencyKey?: string,
): Promise<string> {
  if (idempotencyKey) {
    const existing = await env.DB.prepare("SELECT id FROM notifications WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<{ id: string }>();
    if (existing) return existing.id;
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO notifications (id, topic_id, title, body, priority, url, source, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      topicId,
      input.title,
      input.body,
      input.priority,
      input.url ?? null,
      source,
      now,
      idempotencyKey ?? null,
    ),
    env.DB.prepare(`INSERT OR IGNORE INTO deliveries (notification_id, device_id, updated_at)
      SELECT ?, d.id, ? FROM devices d JOIN device_topics dt ON dt.device_id = d.id
      WHERE dt.topic_id = ? AND EXISTS (SELECT 1 FROM notifications WHERE id = ?)`).bind(
      id,
      now,
      topicId,
      id,
    ),
  ]);
  if (!results[0]?.meta.changes && idempotencyKey) {
    const existing = await env.DB.prepare("SELECT id FROM notifications WHERE idempotency_key = ?")
      .bind(idempotencyKey)
      .first<{ id: string }>();
    if (existing) return existing.id;
  }
  const { results: jobs } = await env.DB.prepare(
    "SELECT device_id FROM deliveries WHERE notification_id = ?",
  )
    .bind(id)
    .all<{ device_id: string }>();
  for (const job of jobs) {
    try {
      await env.PUSH_QUEUE.send({ notificationId: id, deviceId: job.device_id } satisfies PushJob);
    } catch {
      console.error(JSON.stringify({ event: "enqueue_deferred", notificationId: id }));
    }
  }
  return id;
}
