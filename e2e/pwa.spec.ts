import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";

test("the built service worker provides offline navigation without caching API data", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        }),
      );
  });
  const registration = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active?.scriptURL };
  });
  expect(registration.scope).toBe("http://127.0.0.1:4173/");
  expect(registration.script).toBe("http://127.0.0.1:4173/sw.js");
  await page.evaluate(async () => {
    await fetch("/api/session");
    await fetch("/api/snapshot");
  });
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname),
        ),
      )
    ).flat();
  });
  expect(cached).toContain("/offline.html");
  expect(cached.some((path) => path.startsWith("/api/"))).toBe(false);
  expect(cached).not.toContain("/index.html");
  await context.setOffline(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A little out of reach." })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Good things. Less noise." })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a new worker waits for approval and preserves an in-progress form", async ({ page }) => {
  // A controllable static origin represents two real releases of the built worker.
  // Cloudflare's preview snapshots asset hashes at startup, so it cannot model this update.
  let release = 1;
  const root = resolve("dist/client");
  const types: Record<string, string> = {
    ".js": "application/javascript",
    ".html": "text/html",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    try {
      if (path.startsWith("/api/")) {
        const upstream = await fetch(`http://127.0.0.1:4173${path}`);
        response.writeHead(upstream.status, { "Content-Type": "application/json" });
        response.end(await upstream.text());
        return;
      }
      const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
      if (!file.startsWith(`${root}/`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(path === "/sw.js" ? `${body.toString()}\n// Release ${release}\n` : body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.getByLabel("Workspace access key").fill("a-draft-that-must-survive-an-update");
    release = 2;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect(page.getByRole("status", { name: "App update available" })).toBeVisible();
    await expect(page.getByLabel("Workspace access key")).toHaveValue(
      "a-draft-that-must-survive-an-update",
    );
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(page.getByLabel("Workspace access key")).toHaveValue("");
    await expect(page.getByRole("status", { name: "App update available" })).toHaveCount(0);
  } finally {
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  }
});
