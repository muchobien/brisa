import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("wrangler.deploy.jsonc")) {
  console.error("Create wrangler.deploy.jsonc using docs/deployment.md before deploying.");
  process.exit(1);
}
for (const args of [
  ["build"],
  ["exec", "wrangler", "deploy", "--config", "dist/brisa/wrangler.json"],
]) {
  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    env: { ...process.env, BRISA_CONFIG: "wrangler.deploy.jsonc" },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
