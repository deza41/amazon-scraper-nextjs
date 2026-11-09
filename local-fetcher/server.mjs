#!/usr/bin/env node
// Local fetch helper: lets the web app fetch product pages from *your own machine* (your home
// IP, your network) when Vercel's datacenter IPs get blocked by Amazon or other stores.
//
//   npm run local-fetcher
//   ALLOWED_ORIGINS=https://your-app.vercel.app npm run local-fetcher
//
// The browser calls http://127.0.0.1:4545/fetch?url=..., this script downloads the page and
// returns its HTML, and the app sends that HTML to the server to be parsed and saved.
//
// Security model (this opens a local port, so it is deliberately locked down):
//   - listens on loopback only (127.0.0.1)
//   - only answers browser requests from ALLOWED_ORIGINS (CORS + explicit Origin check)
//   - rejects unexpected Host headers (DNS-rebinding defence)
//   - only fetches public internet addresses: private/loopback/link-local IPs are refused,
//     checked at DNS resolution and on every redirect hop
//   - GET only, 8 MB response cap, requests are queued one at a time with a short gap
// No dependencies; needs Node 18+.

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";

const PORT = Number(process.env.PORT || 4545);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 800);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 25_000;

// ---------- address safety ----------

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

function isPrivateIPv6(ip) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    if (lower.startsWith("::ffff:")) return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

function isPrivateAddress(ip) {
    const family = net.isIP(ip);
    if (family === 4) return isPrivateIPv4(ip);
    if (family === 6) return isPrivateIPv6(ip);
    return true;
}

class UnsafeUrlError extends Error {}

function assertSafeTarget(target) {
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are allowed.");
    if (target.port && target.port !== "80" && target.port !== "443") throw new UnsafeUrlError("Only standard web ports are allowed.");
    const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host) throw new UnsafeUrlError("Invalid host.");
    if (net.isIP(host)) {
        if (isPrivateAddress(host)) throw new UnsafeUrlError("Private addresses are not allowed.");
    } else if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
        throw new UnsafeUrlError("Local hostnames are not allowed.");
    }
}

// Checked at connect time so a hostname that resolves (or flips) to a private IP is refused.
function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
            return callback(new UnsafeUrlError("Host resolves to a private address."));
        }
        if (options.all) return callback(null, addresses);
        return callback(null, addresses[0].address, addresses[0].family);
    });
}

// ---------- fetching ----------

const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
};

function requestOnce(target) {
    return new Promise((resolve, reject) => {
        const client = target.protocol === "https:" ? https : http;
        const req = client.request(
            target,
            { method: "GET", headers: BROWSER_HEADERS, lookup: safeLookup, timeout: TIMEOUT_MS },
            (res) => {
                const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
                let stream = res;
                if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
                else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
                else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());

                const chunks = [];
                let size = 0;
                stream.on("data", (chunk) => {
                    size += chunk.length;
                    if (size > MAX_BYTES) {
                        req.destroy(new Error("Response too large"));
                        return;
                    }
                    chunks.push(chunk);
                });
                stream.on("end", () =>
                    resolve({ status: res.statusCode || 0, location: res.headers.location, body: Buffer.concat(chunks).toString("utf8") })
                );
                stream.on("error", reject);
            }
        );
        req.on("timeout", () => req.destroy(new Error("Timed out")));
        req.on("error", reject);
        req.end();
    });
}

async function fetchPage(rawUrl) {
    let target = new URL(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        assertSafeTarget(target);
        const res = await requestOnce(target);
        if (res.status >= 300 && res.status < 400 && res.location) {
            target = new URL(res.location, target);
            continue;
        }
        return { status: res.status, url: target.toString(), html: res.body };
    }
    throw new Error("Too many redirects");
}

// Keep size down for Vercel's request body cap: drop scripts/styles, but keep JSON-LD product data.
function slim(html) {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => (/type=["']application\/ld\+json["']/i.test(tag) ? tag : ""))
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");
}

// One request at a time with a small gap, so bulk refreshes don't hammer a store from your IP.
let queue = Promise.resolve();
function enqueue(task) {
    const run = queue.then(task);
    queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, REQUEST_GAP_MS)));
    return run;
}

// ---------- server ----------

function sendJson(res, status, body, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
    const hostHeader = String(req.headers.host || "").toLowerCase();
    if (hostHeader !== `127.0.0.1:${PORT}` && hostHeader !== `localhost:${PORT}`) {
        return sendJson(res, 403, { error: "Bad Host header" });
    }

    const origin = req.headers.origin ? String(req.headers.origin).replace(/\/+$/, "") : "";
    if (origin) {
        if (!ALLOWED_ORIGINS.includes(origin)) {
            return sendJson(res, 403, { error: `Origin ${origin} is not allowed. Start the helper with ALLOWED_ORIGINS=${origin}` });
        }
    } else if (req.headers["sec-fetch-site"]) {
        // A browser request without an Origin (e.g. <img src>, navigation) — never legitimate for us.
        return sendJson(res, 403, { error: "Browser requests must come from an allowed origin" });
    }

    const cors = origin
        ? {
              "Access-Control-Allow-Origin": origin,
              Vary: "Origin",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Access-Control-Allow-Headers": "content-type",
              // Chrome's Private Network Access preflight for public site -> localhost requests.
              "Access-Control-Allow-Private-Network": "true",
              "Access-Control-Max-Age": "600",
          }
        : {};

    if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        return res.end();
    }
    if (req.method !== "GET") return sendJson(res, 405, { error: "GET only" }, cors);

    const { pathname, searchParams } = new URL(req.url || "/", `http://${hostHeader}`);

    if (pathname === "/health") return sendJson(res, 200, { ok: true, name: "local-fetcher" }, cors);

    if (pathname === "/fetch") {
        const target = searchParams.get("url");
        if (!target) return sendJson(res, 400, { error: "url is required" }, cors);
        try {
            new URL(target);
        } catch {
            return sendJson(res, 400, { error: "Invalid url" }, cors);
        }
        try {
            const page = await enqueue(() => fetchPage(target));
            const html = slim(page.html);
            console.log(`[${new Date().toLocaleTimeString()}] ${new URL(page.url).hostname} -> HTTP ${page.status}, ${Math.round(html.length / 1024)} KB`);
            return sendJson(res, 200, { status: page.status, url: page.url, html }, cors);
        } catch (err) {
            const unsafe = err instanceof UnsafeUrlError || err?.cause instanceof UnsafeUrlError;
            console.log(`[${new Date().toLocaleTimeString()}] ${target.slice(0, 60)} -> ${unsafe ? "refused" : "failed"}: ${err.message}`);
            return sendJson(res, unsafe ? 400 : 502, { error: unsafe ? err.message || err.cause.message : `Fetch failed: ${err.message}` }, cors);
        }
    }

    return sendJson(res, 404, { error: "Not found" }, cors);
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`Local fetch helper listening on http://127.0.0.1:${PORT}`);
    console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
    if (!process.env.ALLOWED_ORIGINS) {
        console.log("Tip: for your deployed app, restart with ALLOWED_ORIGINS=https://your-app.vercel.app");
    }
});
