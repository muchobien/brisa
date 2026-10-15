/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  getCacheKeyForURL,
  matchPrecache,
  precacheAndRoute,
} from "workbox-precaching";
import type { PrecacheEntry } from "workbox-precaching";
import { pushContent } from "./payload";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] };

// Only explicitly allowed public assets are precached. No API or inbox caching.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete("brisa-offline-v1"));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.mode !== "navigate" ||
    url.origin !== self.location.origin ||
    /^\/api(?:\/|$)/.test(url.pathname) ||
    getCacheKeyForURL(url.href)
  )
    return;
  event.respondWith(
    fetch(event.request).catch(
      async () => (await matchPrecache("/offline.html")) ?? Response.error(),
    ),
  );
});
self.addEventListener("push", (event) => {
  let value: unknown;
  try {
    value = event.data?.json();
  } catch {
    value = null;
  }
  const data = pushContent(value);
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge.png",
      tag: data.id || "brisa",
      data: { path: data.id ? `/?notification=${encodeURIComponent(data.id)}` : "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path: unknown = event.notification.data?.path;
  const target = new URL(typeof path === "string" ? path : "/", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        await existing.navigate(target.href);
        return existing.focus();
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
