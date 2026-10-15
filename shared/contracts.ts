import { z } from "zod";

export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type Priority = z.infer<typeof prioritySchema>;
export const colorSchema = z.enum(["blue", "violet", "mint", "amber", "rose"]);
export type TopicColor = z.infer<typeof colorSchema>;
export const topicSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens"),
  description: z.string().trim().max(160).default(""),
  color: colorSchema.default("blue"),
});
export const publishSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(1800).default(""),
    priority: prioritySchema.default("normal"),
    url: z
      .url()
      .max(2048)
      .refine((url) => new URL(url).protocol === "https:", "Links must use HTTPS")
      .optional(),
  })
  .refine(
    (input) =>
      new TextEncoder().encode(JSON.stringify({ title: input.title, body: input.body }))
        .byteLength <= 3000,
    "Title and message are too large for a push notification. Please shorten them.",
  );
export type PublishInput = z.infer<typeof publishSchema>;
export const heartbeatSchema = z.object({
  name: z.string().trim().min(1).max(80),
  topic_id: z.string().min(1),
  interval_seconds: z.number().int().min(60).max(604800),
  grace_seconds: z.number().int().min(60).max(86400).default(120),
});
export const subscriptionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }),
  topics: z.array(z.string()).min(1).max(50),
});

export interface Topic {
  id: string;
  name: string;
  description: string;
  color: TopicColor;
  created_at: number;
  unread: number;
  total: number;
}
export interface Notification {
  id: string;
  topic_id: string;
  title: string;
  body: string;
  priority: Priority;
  url: string | null;
  source: string;
  read_at: number | null;
  created_at: number;
  topic_name: string;
  topic_color: TopicColor;
}
export interface Device {
  id: string;
  name: string;
  created_at: number;
  topics: string[];
}
export interface Token {
  id: string;
  name: string;
  topic_id: string;
  created_at: number;
  last_used_at: number | null;
}
export interface Heartbeat {
  id: string;
  name: string;
  topic_id: string;
  interval_seconds: number;
  grace_seconds: number;
  last_seen_at: number | null;
  alerting: number;
  created_at: number;
}
export interface Snapshot {
  topics: Topic[];
  notifications: Notification[];
  devices: Device[];
  tokens: Token[];
  heartbeats: Heartbeat[];
  vapidPublicKey: string;
  pushConfigured: boolean;
}
export interface PushJob {
  notificationId: string;
  deviceId: string;
}
