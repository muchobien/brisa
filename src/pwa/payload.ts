export function pushContent(value: unknown): { id: string; title: string; body: string } {
  const data =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    id: typeof data.id === "string" ? data.id : "",
    title: typeof data.title === "string" && data.title ? data.title : "Brisa",
    body:
      typeof data.body === "string" && data.body
        ? data.body
        : "A new notification is waiting for you.",
  };
}
