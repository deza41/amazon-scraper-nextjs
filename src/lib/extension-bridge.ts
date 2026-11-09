// Talks to the optional "Shopping Scraper Helper" browser extension (see /extension).
// The extension's content script runs on this site only. It marks <html data-ws-helper="version">
// (instant detection) and relays window.postMessage requests to its background worker, which can
// fetch pages as the user's own browser (their IP, cookies and real browser fingerprint).

export const EXTENSION_DOWNLOAD_URL = "/api/extension";

export interface FetchedPage {
    status: number;
    url: string;
    html: string;
}

/** Version of the installed extension, or null when it isn't installed (or the page predates it). */
export function getExtensionVersion(): string | null {
    if (typeof document === "undefined") return null;
    return document.documentElement.dataset.wsHelper ?? null;
}

/**
 * Fetches a page through the extension. "auto" tries a plain fetch and falls back to a rendered
 * background tab if the site blocks it; "tab" goes straight to the rendered tab.
 */
export function fetchViaExtension(url: string, mode: "auto" | "tab" = "auto"): Promise<FetchedPage> {
    return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = window.setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error("The browser helper took too long to fetch that page."));
        }, mode === "tab" ? 75_000 : 90_000);

        function onMessage(event: MessageEvent) {
            const data = event.data;
            if (event.source !== window || !data || data.source !== "ws-extension" || data.id !== id) return;
            window.clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            if (data.ok) {
                resolve({ status: Number(data.status) || 0, url: String(data.url || url), html: String(data.html || "") });
            } else {
                reject(new Error(`Browser helper: ${data.error || "request failed"}`));
            }
        }

        window.addEventListener("message", onMessage);
        window.postMessage({ source: "ws-app", id, type: "fetch", url, mode }, window.location.origin);
    });
}
