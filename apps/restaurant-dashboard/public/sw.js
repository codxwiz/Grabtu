const CACHE = "grabtu-dashboard-v8";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/bell-clang-sound.mp3"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put("/", copy)); return response; }).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); } return response; })));
});

self.addEventListener("push", event => {
  const message = event.data?.json() || { title: "Grabtu update", body: "Open the restaurant console for details.", tag: "grabtu-update", url: "/" };
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    if (clients.some(client => client.visibilityState === "visible")) return;
    return self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: message.tag,
      data: { url: message.url || "/", kind: message.kind },
      vibrate: [180, 80, 180],
      silent: false,
    });
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) await existing.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  }));
});
