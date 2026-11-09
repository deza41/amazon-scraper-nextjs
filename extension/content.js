// Bridge between the Shopping Scraper page and this extension's background worker.
// It only runs on the app's own origin (see "matches" in manifest.json, which the app's
// download endpoint sets to the site you downloaded the extension from).
(() => {
    if (window.__wsHelperBridge) return; // already injected (install/reload re-injects into open tabs)
    window.__wsHelperBridge = true;

    const version = chrome.runtime.getManifest().version;
    // Lets the page detect the extension instantly, without a message round-trip.
    document.documentElement.dataset.wsHelper = version;

    window.addEventListener("message", (event) => {
        // Only accept messages posted by this page's own scripts.
        if (event.source !== window || event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || data.source !== "ws-app" || typeof data.id !== "string") return;

        const reply = (payload) =>
            window.postMessage({ source: "ws-extension", id: data.id, ...payload }, window.location.origin);

        chrome.runtime
            .sendMessage({ type: data.type, url: data.url, mode: data.mode })
            .then((response) => reply(response ?? { ok: false, error: "No response from the extension" }))
            .catch((err) => reply({ ok: false, error: err?.message || "Extension error" }));
    });
})();
