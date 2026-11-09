import axios from "axios";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// Fetching arbitrary user-supplied URLs from a server is an SSRF risk: without
// checks, someone could point the scraper at localhost, a private network or a
// cloud metadata endpoint (169.254.169.254) and read the response back. This
// module only talks to public internet hosts — validated up front, at DNS
// resolution time (defeats DNS rebinding) and on every redirect hop.

export class UnsafeUrlError extends Error {
    constructor(message = "That URL points to a private or unsupported address.") {
        super(message);
        this.name = "UnsafeUrlError";
    }
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isPrivateIPv4(ip: string): boolean {
    const [a, b] = ip.split(".").map(Number);
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
        (a === 169 && b === 254) || // link-local incl. cloud metadata
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224 // multicast, reserved, broadcast
    );
}

function isPrivateIPv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    if (lower.startsWith("::ffff:")) return true; // hex-form mapped addresses: just refuse
    const firstGroup = parseInt(lower.split(":")[0] || "0", 16);
    if ((firstGroup & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((firstGroup & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstGroup & 0xff00) === 0xff00) return true; // multicast
    return false;
}

export function isPrivateAddress(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 4) return isPrivateIPv4(ip);
    if (family === 6) return isPrivateIPv6(ip);
    return true; // not an IP at all: refuse
}

/** Synchronous checks that don't need DNS: scheme, port, IP literals, obvious local names. */
export function assertSafeUrlShape(target: URL | { protocol: string; hostname: string; port?: string }) {
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new UnsafeUrlError();
    if (target.port && target.port !== "80" && target.port !== "443") {
        throw new UnsafeUrlError("Only standard web ports (80/443) are allowed.");
    }
    const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host) throw new UnsafeUrlError();
    if (net.isIP(host)) {
        if (isPrivateAddress(host)) throw new UnsafeUrlError();
        return;
    }
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
        throw new UnsafeUrlError();
    }
}

// Validates addresses at connect time, so a hostname that resolves to a private
// IP (or flips to one between our check and the connection) is refused.
const safeLookup = ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        const list = addresses as dns.LookupAddress[];
        if (list.length === 0 || list.some((entry) => isPrivateAddress(entry.address))) {
            return callback(new UnsafeUrlError());
        }
        if (options.all) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
}) as unknown as net.LookupFunction;

const httpAgent = new http.Agent({ lookup: safeLookup });
const httpsAgent = new https.Agent({ lookup: safeLookup });

export interface SafeResponse {
    status: number;
    body: string;
    finalUrl: string;
}

const REQUEST_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-AU,en;q=0.9",
};

/** GET a public web URL. Never throws on HTTP error statuses (callers inspect `status`). */
export async function safeGet(
    url: string,
    { accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", timeout = 20000 } = {}
): Promise<SafeResponse> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new UnsafeUrlError("That doesn't look like a valid URL.");
    }
    assertSafeUrlShape(parsed);

    try {
        const response = await axios.get<string>(parsed.toString(), {
            headers: { ...REQUEST_HEADERS, Accept: accept },
            timeout,
            responseType: "text",
            transformResponse: (data) => data,
            validateStatus: () => true,
            maxRedirects: MAX_REDIRECTS,
            maxContentLength: MAX_BODY_BYTES,
            maxBodyLength: MAX_BODY_BYTES,
            httpAgent,
            httpsAgent,
            beforeRedirect: (options: { protocol?: string | null; hostname?: string | null; port?: string | number | null }) => {
                assertSafeUrlShape({
                    protocol: options.protocol ?? "",
                    hostname: options.hostname ?? "",
                    port: options.port ? String(options.port) : "",
                });
            },
        });
        const finalUrl = (response.request?.res?.responseUrl as string | undefined) ?? parsed.toString();
        return { status: response.status, body: typeof response.data === "string" ? response.data : "", finalUrl };
    } catch (err) {
        // Errors thrown from our lookup/redirect hooks arrive wrapped (axios -> follow-redirects -> ours).
        let current: unknown = err;
        for (let depth = 0; current && depth < 5; depth++) {
            if (current instanceof UnsafeUrlError) throw current;
            current = (current as { cause?: unknown }).cause;
        }
        throw err;
    }
}
