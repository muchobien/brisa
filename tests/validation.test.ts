import { describe, expect, it } from "vite-plus/test";
import { publishSchema, topicSchema } from "../shared/contracts";
import { hash, matchesSecret, validPushEndpoint } from "../worker/security";

describe("input and trust boundaries", () => {
  it("accepts ordinary topic names and rejects paths and ambiguous slugs", () => {
    expect(topicSchema.parse({ name: "daily-backups" }).color).toBe("blue");
    for (const name of ["../admin", "a/b", "Two Words", "-name", "a--b"])
      expect(topicSchema.safeParse({ name }).success).toBe(false);
  });
  it("rejects unsafe action links and oversized push bodies", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hello", "http://example.com"])
      expect(publishSchema.safeParse({ title: "Hello", url }).success).toBe(false);
    expect(publishSchema.safeParse({ title: "Hello", body: "a".repeat(1801) }).success).toBe(false);
    expect(publishSchema.safeParse({ title: "Hello", body: "界".repeat(1200) }).success).toBe(
      false,
    );
    expect(publishSchema.safeParse({ title: "Hello", body: "\u0001".repeat(1000) }).success).toBe(
      false,
    );
    expect(
      publishSchema.parse({ title: "Hello", url: "https://grafana.example.com" }).priority,
    ).toBe("normal");
  });
  it("allows browser push providers without allowing lookalike hosts or redirects", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/test",
      "https://updates.push.services.mozilla.com/wpush/v2/test",
      "https://web.push.apple.com/Qtest",
      "https://wns2-db5p.notify.windows.com/w/?token=x",
    ])
      expect(validPushEndpoint(endpoint)).toBe(true);
    for (const endpoint of [
      "https://127.0.0.1/push",
      "http://fcm.googleapis.com/send",
      "https://fcm.googleapis.com.evil.test/send",
      "https://evilpush.apple.com/send",
      "https://user:password@fcm.googleapis.com/send",
      "https://fcm.googleapis.com:8443/send",
      "not-a-url",
    ])
      expect(validPushEndpoint(endpoint)).toBe(false);
  });
  it("compares secrets without exposing or persisting raw tokens", async () => {
    expect(await matchesSecret("a-long-secret", "a-long-secret")).toBe(true);
    expect(await matchesSecret("short", "a-long-secret")).toBe(false);
    expect(await hash("a-long-secret")).toMatch(/^[a-f0-9]{64}$/);
  });
});
