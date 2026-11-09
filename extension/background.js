// Web Scraper Helper — background service worker.
// Fetches product pages on behalf of the Web Scraper app, using this browser (your IP, your
// cookies, a real browser fingerprint). It only answers the app's own origin.

const VERSION = chrome.runtime.getManifest().version;
const REQUEST_GAP_MS = 600;
const FETCH_TIMEOUT_MS = 20000;
const TAB_LOAD_TIMEOUT_MS = 30000;
const TAB_SETTLE_MS = 1500;
const CHALLENGE_WAIT_MS = 15000;
const MAX_CHARS = 8 * 1024 * 1024;

// Origins the page bridge is allowed on, derived from the manifest so there is one source of truth.
function allowedOrigins() {
    return chrome.runtime
        .getManifest()
        .content_scripts.flatMap((cs) => cs.matches)
        .map((pattern) => pattern.replace(/\/\*$/, ""));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- safety: only public http(s) pages ----------

function isPrivateIPv4(ip) {
    const [a, b] = ip.split(".").map(Number);
    return (
        a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 192 && b === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    );
}

function assertSafeUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("Invalid URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
    if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Only standard web ports are allowed");
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const isV4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
    const isV6 = host.includes(":");
    if (
        host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
        (isV4 && isPrivateIPv4(host)) ||
        (isV6 && (host === "::" || host === "::1" || /^(fc|fd|fe[89ab])/.test(host) || host.startsWith("::ffff:")))
    ) {
        throw new Error("Private addresses are not allowed");
    }
    return url;
}

// ---------- page fetching ----------

// Keep the payload small for the server's request limit: drop scripts/styles but keep JSON-LD product data.
function slim(html) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => (/type=["']application\/ld\+json["']/i.test(tag) ? tag : ""))
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");
}

const BLOCK_TITLE = /just a moment|attention required|access denied|are you a (human|robot)|robot check|captcha|verify you are human|security check|pardon our interruption/i;

function looksBlocked({ status, html }) {
    if ([401, 403, 429, 503].includes(status)) return true;
    const title = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || "";
    if (BLOCK_TITLE.test(title)) return true;
    return html.length < 5000 && /captcha|robot/i.test(html);
}

async function fetchDirect(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url.href, {
            credentials: "include", // use the user's real session cookies
            redirect: "follow",
            headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
            signal: controller.signal,
        });
        const finalUrl = assertSafeUrl(response.url || url.href).href;
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error("Response too large");
        return { status: response.status, url: finalUrl, html: slim(text) };
    } finally {
        clearTimeout(timer);
    }
}

function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        const done = () => {
            chrome.tabs.onUpdated.removeListener(listener);
            clearTimeout(timer);
            resolve();
        };
        const listener = (id, info) => {
            if (id === tabId && info.status === "complete") done();
        };
        const timer = setTimeout(done, TAB_LOAD_TIMEOUT_MS); // read whatever has rendered by then
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId).then((tab) => tab.status === "complete" && done()).catch(done);
    });
}

// Strongest mode: load the page in a real (background) tab so JavaScript runs and bot checks
// see a genuine browser, then read the rendered DOM.
async function fetchInTab(url) {
    const tab = await chrome.tabs.create({ url: url.href, active: false });
    try {
        await waitForTabLoad(tab.id);
        await sleep(TAB_SETTLE_MS); // let client-side rendering finish

        // Bot-check interstitials ("Just a moment...") usually clear by themselves in a real
        // browser after a few seconds and then reload the page, so wait for that to happen.
        let page = null;
        const deadline = Date.now() + CHALLENGE_WAIT_MS;
        for (;;) {
            try {
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => ({ html: document.documentElement.outerHTML, url: location.href, title: document.title }),
                });
                page = result && result.result;
            } catch {
                // the tab was navigating when we asked; try again shortly
            }
            const stillChallenge = !page || BLOCK_TITLE.test(page.title || "");
            if (!stillChallenge || Date.now() >= deadline) break;
            await sleep(1000);
        }
        if (!page || !page.html) throw new Error("Couldn't read the page");
        const finalUrl = assertSafeUrl(page.url).href;
        if (page.html.length > MAX_CHARS) throw new Error("Response too large");
        return { status: 200, url: finalUrl, html: slim(page.html) };
    } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
    }
}

async function fetchPage(rawUrl, mode) {
    const url = assertSafeUrl(rawUrl);
    if (mode !== "tab") {
        try {
            const page = await fetchDirect(url);
            if (!looksBlocked(page)) return page;
        } catch {
            // fall through to the tab strategy
        }
    }
    return fetchInTab(url);
}

// One page at a time, with a short gap, so bulk refreshes are gentle on the stores.
let queue = Promise.resolve();
function enqueue(task) {
    const run = queue.then(task);
    queue = run.catch(() => {}).then(() => sleep(REQUEST_GAP_MS));
    return run;
}

// ---------- messages from the page bridge (content.js) ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    let origin = "";
    try {
        origin = new URL(sender.tab && sender.tab.url).origin;
    } catch {
        // no tab (e.g. the popup): fall through to the origin check below
    }

    if (message && message.type === "status") {
        // Asked by the toolbar popup.
        sendResponse({ ok: true, version: VERSION, origins: allowedOrigins() });
        return;
    }
    if (!allowedOrigins().includes(origin)) {
        sendResponse({ ok: false, error: "This site isn't allowed to use the helper" });
        return;
    }
    if (message.type === "ping") {
        sendResponse({ ok: true, version: VERSION });
        return;
    }
    if (message.type === "fetch") {
        enqueue(() => fetchPage(String(message.url || ""), message.mode))
            .then((page) => sendResponse({ ok: true, ...page }))
            .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : "Fetch failed" }));
        return true; // async response
    }
    sendResponse({ ok: false, error: "Unknown request" });
});

// Content scripts only attach to pages loaded after install, so inject into already-open app tabs
// right away; the page can then detect the helper without a manual refresh.
chrome.runtime.onInstalled.addListener(async () => {
    try {
        const tabs = await chrome.tabs.query({ url: allowedOrigins().map((origin) => `${origin}/*`) });
        for (const tab of tabs) {
            if (tab.id != null) {
                await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => {});
            }
        }
    } catch {
        // best effort
    }
});
