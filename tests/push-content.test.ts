import { describe, expect, it } from "vite-plus/test";
import { pushContent } from "../src/pwa/payload";

describe("service-worker push content", () => {
  it("preserves the message ID and display content used by notification clicks", () => {
    expect(
      pushContent({ id: "message-123", title: "Backup complete", body: "Everything is safe." }),
    ).toEqual({ id: "message-123", title: "Backup complete", body: "Everything is safe." });
  });
  it("uses a visible fallback for malformed or missing payloads", () => {
    for (const value of [undefined, null, "text", { id: 123, title: {}, body: [] }]) {
      expect(pushContent(value)).toEqual({
        id: "",
        title: "Brisa",
        body: "A new notification is waiting for you.",
      });
    }
  });
});
