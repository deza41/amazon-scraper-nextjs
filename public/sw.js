// Minimal service worker: exists so the app is installable as a PWA.
// This app is entirely dynamic (realtime PocketBase data, live scraping),
// so it deliberately does not cache anything — every request just passes
// straight through to the network.
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
    // no-op: let the browser handle every request normally
});
