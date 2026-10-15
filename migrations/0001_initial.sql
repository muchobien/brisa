PRAGMA foreign_keys = ON;

CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'blue',
  created_at INTEGER NOT NULL
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
  url TEXT,
  source TEXT NOT NULL DEFAULT 'api',
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  idempotency_key TEXT UNIQUE
);
CREATE INDEX notifications_created ON notifications(created_at DESC);
CREATE INDEX notifications_topic ON notifications(topic_id, created_at DESC);
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE device_topics (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY(device_id, topic_id)
);
CREATE TABLE deliveries (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(notification_id, device_id)
);
CREATE INDEX deliveries_pending ON deliveries(status, updated_at);
CREATE TABLE heartbeats (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  grace_seconds INTEGER NOT NULL,
  last_seen_at INTEGER,
  alerting INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
