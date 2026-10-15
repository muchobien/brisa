# Architecture

One Cloudflare Worker handles the authenticated management API, scoped ingestion
API, queue consumer, and scheduled maintenance. Workers Static Assets serves the
Vite-built React PWA. D1 stores persistent state; Queues schedules push attempts.

## Authentication and data

The generated workspace access key is verified using fixed-length SHA-256 hashes
and a constant-time comparison. Successful login creates a random 256-bit
session token. D1 stores only its hash and expiry; the browser receives an
HttpOnly, SameSite=Lax cookie (Secure over HTTPS). Login allows ten attempts per
minute per Cloudflare client-IP hash. Session values and publishing keys are
never exposed through the snapshot API.

Management operations require a session cookie. Only publishing, Grafana, and
heartbeat-ping routes accept publishing keys. A key belongs to a topic and grants
no management or read access. Write requests with a foreign Origin are rejected.

Topics, notifications, tokens, devices, subscriptions, delivery records, and
heartbeats use parameterized D1 queries and foreign keys. Read status is shared
across the workspace. The snapshot includes 500 most recent notifications and
counts across the retained history. No authenticated content is cached by the
service worker.

## Delivery

Publishing writes a notification and one delivery per currently subscribed device
in a single D1 transaction. It then enqueues small notification/device ID pairs.
If enqueueing fails, the durable pending records remain. Cron re-enqueues old
pending records so acceptance does not depend on queue availability at that instant.

The consumer loads current device credentials, encrypts the notification with
`web-push`, constructs VAPID authentication, and sends using Workers `fetch`.
It restricts destinations to known browser push providers and does not follow
redirects. The provider’s accepted response updates that delivery to `accepted`.
404/410 deletes an expired device; transient network, 408, 429, and server errors
are retried with backoff. Other non-success responses and exhausted transport
attempts become `failed`.

Queues provides at-least-once execution. Checking delivery status suppresses
completed jobs, but a crash between provider acceptance and the D1 update, or
concurrent attempts, can still deliver twice. The stable notification ID is also
the browser notification tag, replacing a duplicate rather than stacking it.
Brisa does not claim exactly-once delivery or device read receipts.

Messages include their display content in the encrypted payload, so showing a
push does not require a second authenticated API fetch. The service worker opens
the matching Brisa inbox entry when clicked. External action links are opened
only from that entry after sign-in.

## Availability

Heartbeat detection runs on Cloudflare, independently of monitored hosts.
Authentication also runs there. A host cannot announce its own failure after it
goes down, so use missed heartbeats for complete host/network outages.

The service depends on Cloudflare, Internet connectivity, browser push providers,
and device/browser permissions. Focus modes and browser shutdown policies apply.
For paging that needs acknowledgments or escalation, add another delivery
channel; this release is a personal/team notification inbox.

## Tooling

Vite+ supplies the project-local Vite, Vitest, formatter, and linter. Its bundled
Vitest 5 currently differs from Cloudflare’s Vitest-pool peer requirement, so
runtime tests use Miniflare directly. Tests use the Miniflare version from the
current Wrangler toolchain and its v4-options compatibility converter. Outbound
push requests are intercepted in tests; no real browser subscription is contacted.

Worker types are generated from Wrangler and local secret names. Both frontend
and backend use shared Zod request contracts. Playwright checks real desktop and
mobile browser flows against the Cloudflare Vite development server.
