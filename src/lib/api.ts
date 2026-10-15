export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/login")
      window.dispatchEvent(new Event("brisa:unauthorized"));
    throw new Error(
      typeof body.error === "string" ? body.error : "The request could not be completed",
    );
  }
  return body as T;
}
export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}
export function remove(path: string): Promise<{ ok: boolean }> {
  return api(path, { method: "DELETE" });
}
export function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export async function subscribeDevice(
  publicKey: string,
  name: string,
  topics: string[],
): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    throw new Error(
      "This browser does not support Web Push. On iPhone, add Brisa to your Home Screen and open it there.",
    );
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Allow notifications in your browser or device settings, then try again.");
  const registration = await navigator.serviceWorker.ready;
  const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
    char.charCodeAt(0),
  );
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }));
  const serialized = subscription.toJSON();
  const result = await post<{ id: string }>("/devices", {
    name,
    topics,
    endpoint: serialized.endpoint,
    keys: serialized.keys,
  });
  localStorage.setItem("brisa:device", result.id);
}
