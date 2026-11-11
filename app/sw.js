// Offline support. On install it caches the app, the JSON database, every park
// file and every image, so the guide keeps working with poor signal in the park.
//
//   images, fonts       → cache first (they never change)
//   html, js, css, json → network first, cache as fallback (edits show up when online)
//
// Bump VERSION after changing files so phones drop the old cache.

const VERSION = "zoo-gps-v1";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon.svg",
  "css/guide.css",
  "css/gps.css",
  "js/app.js",
  "js/data.js",
  "js/geo.js",
  "js/nearby.js",
  "js/position.js",
  "js/record.js",
  "js/render.js",
  "data/content.json",
  "data/parks/index.json",
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(SHELL);
      // Everything the database refers to: images and park files.
      const content = await (await cache.match("data/content.json")).json();
      const images = content.animals.flatMap((a) => [a.image.photo, a.image.thumb]);
      const index = await (await cache.match("data/parks/index.json")).json();
      const parks = (index.parks || []).map((p) => "data/parks/" + p.file);
      await cache.addAll([...new Set([...images, ...parks])]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/images/") || url.pathname.includes("/icons/")) event.respondWith(cacheFirst(req));
  else event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await cache.match("index.html") : null);
    if (hit) return hit;
    throw err;
  }
}
