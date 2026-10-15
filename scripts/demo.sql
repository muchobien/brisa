-- Optional LOCAL example data. The production deployment never runs this file.
INSERT OR IGNORE INTO topics (id, name, description, color, created_at) VALUES
  ('demo-infra', 'homelab', 'The little things keeping everything running.', 'violet', unixepoch('now') * 1000 - 86400000),
  ('demo-backups', 'backups', 'A little peace of mind, every day.', 'mint', unixepoch('now') * 1000 - 86300000),
  ('demo-deploys', 'deployments', 'Fresh ideas, finding their way into the world.', 'blue', unixepoch('now') * 1000 - 86200000),
  ('demo-personal', 'little-wins', 'Good things worth a gentle nudge.', 'amber', unixepoch('now') * 1000 - 86100000);
INSERT OR IGNORE INTO notifications (id, topic_id, title, body, priority, source, created_at, read_at) VALUES
  ('demo-1', 'demo-backups', 'Everything is safely tucked away.', 'Daily backup completed. Your files are safe, and there’s nothing you need to do.', 'normal', 'api', unixepoch('now') * 1000 - 120000, NULL),
  ('demo-2', 'demo-deploys', 'A fresh version just landed.', 'Brisa is up to date. A few little improvements, a slightly calmer day.', 'normal', 'api', unixepoch('now') * 1000 - 1080000, NULL),
  ('demo-3', 'demo-infra', 'A little less room than usual.', 'Your home server has 12% disk space remaining. A good moment for a little spring cleaning.', 'high', 'grafana', unixepoch('now') * 1000 - 1920000, NULL),
  ('demo-4', 'demo-personal', 'Your weekend reading is ready.', 'Three new articles found their way to your reading list. Take your time.', 'low', 'api', unixepoch('now') * 1000 - 3960000, NULL),
  ('demo-5', 'demo-infra', 'All quiet on the home front.', 'Your home server is checking in again. Everything is running as it should.', 'normal', 'heartbeat', unixepoch('now') * 1000 - 7200000, unixepoch('now') * 1000 - 3600000);
