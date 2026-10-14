const CACHE = "dictation-v1";
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./audio-worklet.js",
  "./vendor/vosk.js",
  "./sw.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(fromCacheOrNetwork(request, url));
});

function isHeavyAsset(url) {
  return url.pathname.endsWith(".tar.gz") || url.pathname.endsWith("/vosk.js");
}

async function fromCacheOrNetwork(request, url) {
  const cache = await caches.open(CACHE);
  if (isHeavyAsset(url)) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return fetch(request);
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === "navigate") {
      const page = await cache.match("./index.html");
      if (page) {
        return page;
      }
    }
    throw error;
  }
}
