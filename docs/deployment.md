# Deploy Brisa on Cloudflare

One installation is one trusted shared workspace. You need a Cloudflare account
with Workers, D1, and Queues access. Brisa does not depend on your monitored host
to serve the UI, authenticate devices, or evaluate heartbeats.

## Prepare

Run the local setup from the README. Keep `.dev.vars` safe. Set `VAPID_SUBJECT` to
your real contact email in the form `mailto:you@example.com`; the generated
`admin@example.com` value is only for local development. Keep `ADMIN_TOKEN` and
both VAPID keys unchanged across deployments unless intentionally rotating them.

Authenticate and select your account explicitly:

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
export CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
cp wrangler.jsonc wrangler.deploy.jsonc
```

`wrangler.deploy.jsonc` is ignored by Git. It keeps your account and resource
identifiers separate from the portable application configuration.

Create the database and let Wrangler write its ID into that deployment config:

```sh
pnpm exec wrangler d1 create brisa \
  --binding DB --update-config --config wrangler.deploy.jsonc
pnpm exec wrangler queues create brisa-push
pnpm exec wrangler queues create brisa-push-failed
pnpm db:migrate:remote
```

These commands create remote resources. If you already have resources with those
names, verify their ownership and use the existing IDs rather than recreating
them. The main and dead-letter queues must exist before deployment. Use distinct
names, update the config, and adjust the migration command for multiple installs
in one account.

Upload the four secret/config values from the protected local file. Wrangler
supports `.env` format and does not require putting secret values in arguments:

```sh
pnpm exec wrangler secret bulk .dev.vars --config wrangler.deploy.jsonc
pnpm deploy
```

On a first install, Wrangler may offer to create the Worker while uploading
secrets. Use the configured `brisa` Worker. Deployment builds the frontend and
Worker with `wrangler.deploy.jsonc`, then deploys the generated config so the
assets, database, queue producer, queue consumer, and minute cron stay aligned.
The frontend assets never include `.dev.vars`.

The deployment prints your HTTPS Workers URL. Sign in using `ADMIN_TOKEN`, create
a topic, add a publishing key, and enable notifications on each device.

## Verify

1. Open `/api/health` and verify `{"ok":true,"name":"brisa"}`.
2. Verify `/api/snapshot` returns 401 without a session.
3. Publish through a scoped key, then check the inbox and your device.
4. With the phone locked and the app closed, publish again and tap the push.
5. Create a heartbeat, send a ping, then stop pings until the interval and grace
   period pass. Expect one missed-heartbeat alert and a recovery message on the
   next ping. Cron runs once per minute, so alerts have that additional granularity.

Tests mock the external push provider. They do not verify an actual phone, Focus
settings, browser background behavior, or production delivery latency.

## Domains and network access

Use a stable HTTPS origin: browser permissions, service workers, and push
subscriptions are tied to it. Configure a custom domain in Cloudflare Workers
if desired. If your private DNS sends a wildcard domain to a local server, add
an exact DNS exception for Brisa so clients reach Cloudflare.

The PWA and sign-in run independently of services on your monitored host. Links
in notifications can still require a VPN or access to that host. Existing device
subscriptions receive encrypted payloads without fetching the message from a
VPN-only origin, but opening the inbox and managing the device require access
to Brisa itself.

## Updates and operations

The PWA plugin keeps a new service worker waiting while an existing version is
open. Users see a Reload prompt and can finish their current form before updating.
Keep the `/sw.js` URL, scope, and origin stable so push subscriptions survive
routine releases. `pnpm test:pwa` verifies the built worker’s offline and update
behavior locally before deployment.

Back up D1 and preserve the VAPID keys and access key before changes. Apply new
migrations with `pnpm db:migrate:remote`, run the checks, and deploy. Restoring a
Worker version does not roll back database migrations or storage.

Notifications older than 30 days, expired sessions, and expired login-attempt
counters are removed by the minute cron. Removing a topic cascades to its
messages, publishing keys, delivery records, subscriptions, and heartbeats.

Inspect queue metrics, the `brisa-push-failed` dead-letter queue, and Workers Logs
for failed deliveries. Pending deliveries older than five minutes are re-enqueued
from D1, at most 100 per cron run. After ten transport/provider attempts, a
delivery becomes failed. Permanent HTTP errors become failed immediately;
404/410 removes the expired device. Queue or runtime failures before a transport
attempt remain pending for later recovery. Provider acceptance is recorded as
`accepted`, not as a read or delivery receipt.

The dead-letter queue is diagnostic. Replaying its stale jobs after successful
recovery is unnecessary; the D1 status suppresses accepted/failed jobs. Manage
its retention and purge old entries through Cloudflare as appropriate.

This small-workspace release caps topics at 50, devices at 50, publishing keys
at 100, heartbeats at 50, and the inbox view at 500 recent messages. It is not a
multi-tenant notification platform.

Free-tier usage may be sufficient, but Web Push encryption consumes CPU. Measure
your workload and fan-out before relying on free limits. Review current
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and configure account-level usage notifications and invocation CPU limits for
your needs.
