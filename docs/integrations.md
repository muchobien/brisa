# API and integrations

Create a topic and a publishing key in Brisa’s Integrations page. Keys are shown
once and stored only as SHA-256 hashes. Each key is restricted to one topic.
Send them using `Authorization: Bearer YOUR_KEY`; never put credentials in URLs.

## Publish a notification

`POST /api/publish` accepts JSON:

| Field      | Meaning                                             |
| ---------- | --------------------------------------------------- |
| `title`    | Required, 1–120 characters                          |
| `body`     | Optional, up to 1,800 characters                    |
| `priority` | `low`, `normal` (default), `high`, or `urgent`      |
| `url`      | Optional HTTPS link, opened from the message detail |

Title and body must also fit in 3,000 UTF-8 bytes when JSON-encoded, to leave
room for Web Push metadata and encryption. Request bodies are capped at 32 KiB.
Brisa does not fetch links or execute actions from notification contents.

Success returns HTTP 202 and `{"id":"..."}` after the notification and delivery
outbox are persisted. Queue errors are recovered asynchronously by cron. An
optional `Idempotency-Key` header (up to 128 characters) deduplicates requests
within the key’s topic while the notification remains in the 30-day history.
Reusing a key returns the first notification; it does not replace its content.

```sh
curl -fsS -X POST 'https://YOUR_BRISA_HOST/api/publish' \
  -H "Authorization: Bearer $BRISA_PUBLISH_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Backup complete","body":"Everything is safe.","priority":"normal"}'
```

Invalid input returns 400, missing/revoked credentials 401, cross-origin browser
writes 403, oversized bodies 413, and server failures 500. Publishers should retry
transient failures using the same idempotency key.

## Grafana

Create a Webhook contact point:

- URL: `https://YOUR_BRISA_HOST/api/webhooks/grafana`
- HTTP method: POST
- Authorization scheme: Bearer
- Authorization credentials: a Brisa publishing key
- Leave the default Grafana JSON payload enabled.
- Set Max Alerts to 50 or fewer; split larger groups upstream.

Route the desired notification policy to this contact point. The receiver accepts
firing and resolved alerts, uses `annotations.summary` or `labels.alertname` as
the title, and uses `annotations.description` as the body. Critical firing alerts
use urgent priority; other firing alerts use high; resolved alerts use normal.
The alert fingerprint, status, and timestamps form the deduplication key.

The receiver uses Bearer authentication, not Grafana HMAC signing. Interactive
authentication middleware must not intercept this endpoint. See the
[Grafana webhook documentation](https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/webhook-notifier/).

## Heartbeats

Create a monitor in Integrations. Pick its topic and expected interval; the UI
adds a two-minute grace period. Monitoring begins immediately. Ping its generated
endpoint using a publishing key for the same topic:

```sh
curl -fsS -X POST 'https://YOUR_BRISA_HOST/api/heartbeats/YOUR_MONITOR_ID/ping' \
  -H "Authorization: Bearer $BRISA_PUBLISH_KEY"
```

Run this from your scheduler at the configured interval. For a backup, ping only
after the job succeeds. For a host, use a systemd timer or cron on that host.
Keep the publishing key in a protected environment file.

The Cloudflare minute cron detects missed pings even when the monitored host and
its Grafana instance are down. Each outage produces one alert; the first new ping
produces a recovery message. Brisa measures incoming heartbeats rather than
probing private hosts directly.

## Devices

Open Brisa on the receiving device and use Devices → Add this device. Choose its
topics and allow notifications. To change this browser’s topics, add it again
with the new selection; the existing endpoint is updated rather than duplicated.
Removing another device disconnects its delivery server-side.

On iPhone/iPad (16.4+), open the installed Home Screen app before enabling push.
Push must display a notification; Brisa does not use silent background pushes.
Desktop delivery depends on browser/platform background behavior. Installation
alone does not bypass notification permissions or operating-system restrictions.
