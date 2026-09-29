/* Cache only this build's shell. Auth and manufacturing API data never enter CacheStorage. */
const CACHE_PREFIX = "lechic-shell-"; // BUILD_SCOPE
const SHELL = new URL("./", self.location.href).pathname;
const CACHE = "lechic-shell-v1";
const PRECACHE = []; // BUILD_ASSETS
// Only public image URLs explicitly used by the design catalog enter this cache.
const IMAGE_CACHE = "lechic-design-images-v1";
self.addEventListener("install", (event) => {
  // A new version waits until all old app windows close. Never interrupt work.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)
        .map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method === "GET" && request.destination === "image" && url.protocol === "https:" && url.origin !== self.location.origin) {
    event.respondWith(caches.open(IMAGE_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const update = fetch(request).then(async (response) => {
      if (response.ok || response.type === "opaque") {
        try {
          await cache.put(request, response.clone());
          const keys = await cache.keys();
          await Promise.all(keys.slice(0, Math.max(0, keys.length - 100)).map((key) => cache.delete(key)));
        } catch { /* Image caching must never block a design or work recording. */ }
      } else if (cached) { await cache.delete(request); }
      return response;
      }).catch(() => cached || Response.error());
      event.waitUntil(update.then(() => undefined));
      return cached || update;
    }).catch(() => Response.error()));
    return;
  }
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(SHELL)) return;
  const relative = url.pathname.slice(SHELL.length);
  if (/^(api|auth|rest)\//.test(relative)) return;
  if (request.mode === "navigate") {
    // Keep the offline shell paired with its precached assets, even during updates.
    event.respondWith(fetch(request).catch(async () =>
      (await (await caches.open(CACHE)).match(SHELL)) || Response.error(),
    ));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) =>
      (await cache.match(url.pathname)) || fetch(request),
    ));
  }
});
