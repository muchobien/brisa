import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const adminKey = readFileSync(".dev.vars", "utf8").match(/^ADMIN_TOKEN="([^"]+)"/m)![1]!;
test("a workspace can create a topic, send a notification, read it, and remove the topic", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Workspace access key").fill(adminKey);
  await page.getByRole("button", { name: "Open your inbox" }).click();
  await expect(page.getByRole("heading", { name: "Inbox." })).toBeVisible();
  const name = `browser-${Date.now()}`;
  await page.getByRole("button", { name: "Create topic", exact: true }).click();
  await page.getByLabel("Topic name").fill(name);
  await page.getByLabel("Description").fill("Created in a real browser");
  await page.getByRole("dialog").getByRole("button", { name: "Create topic", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Send notification", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("A little browser test");
  await page
    .getByRole("combobox", { name: "Topic", exact: true })
    .selectOption({ label: `# ${name}` });
  await page.getByLabel("Message", { exact: true }).fill("The frontend and Worker are connected.");
  await page.getByRole("dialog").getByRole("button", { name: "Send notification" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByText("A little browser test", { exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("The frontend and Worker are connected."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name })).toHaveCount(0);
  await page.getByRole("button", { name: "Use dark appearance" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("mobile navigation, install assets, and forms remain usable", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Workspace access key").fill(adminKey);
  await page.getByRole("button", { name: "Open your inbox" }).click();
  await expect(page.getByRole("heading", { name: "Inbox." })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Devices" })
    .click();
  await expect(page.getByText("On iPhone or iPad?", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Workspace access key")).toBeVisible();
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  const script = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).active?.scriptURL,
  );
  expect(script).toContain("/dev-sw.js?dev-sw");
});
