# Security

Please report vulnerabilities using this repository’s private GitHub security
advisory reporting, when enabled. Do not put credentials, push endpoints, or
private notification content in a public issue.

Each deployment is a single trusted workspace. Anyone with its workspace access
key can read and manage all its contents. Publishing keys are restricted to one
topic and cannot read messages or manage configuration. Session cookies are
HttpOnly and SameSite=Lax, with Secure on HTTPS. Sessions last 30 days.

Brisa stores notifications and browser subscriptions in your D1 database. Web Push
encrypts payloads for browser providers; this is not end-to-end encryption from
the original publisher through storage. The Worker can read message content.
Do not send secrets that should never appear on a device’s lock screen.

Keep the deployment public over HTTPS with authentication enabled. Brisa rejects
cross-origin writes, limits login attempts, caps request bodies, and validates
push destinations. It supports Apple, Google, Mozilla, and Windows push providers.
Configure any additional network protection around the publishing API without
introducing interactive login redirects for scripts.

To revoke every management session, delete the rows in `sessions` and rotate
`ADMIN_TOKEN`. Rotating the access key alone does not remove existing sessions.
Remove devices to revoke their push delivery. Preserve VAPID keys across updates;
changing them requires devices to subscribe again.
