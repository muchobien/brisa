import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import webpush from "web-push";

if (existsSync(".dev.vars")) {
  console.log("Local secrets already exist. Keeping them unchanged.");
} else {
  const keys = webpush.generateVAPIDKeys();
  const admin = randomBytes(32).toString("base64url");
  writeFileSync(
    ".dev.vars",
    `ADMIN_TOKEN="${admin}"\nVAPID_PUBLIC_KEY="${keys.publicKey}"\nVAPID_PRIVATE_KEY="${keys.privateKey}"\nVAPID_SUBJECT="mailto:admin@example.com"\n`,
    { mode: 0o600, flag: "wx" },
  );
  chmodSync(".dev.vars", 0o600);
  console.log("Created .dev.vars with a workspace access key and VAPID keys.");
  console.log("Read ADMIN_TOKEN from that file to sign in locally. No secrets are printed.");
}
