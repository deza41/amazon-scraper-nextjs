import { isAllowedAmazonUrl } from "./amazon-url";

// Client-safe URL helpers (no server-only imports), shared by the API routes
// and the UI. Any public http(s) product page is accepted; Amazon gets its own
// dedicated parser, everything else goes through the generic scraper.

export function parseProductUrl(value: string): URL | null {
    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
        if (!parsed.hostname.includes(".")) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function isAmazonUrl(value: string): boolean {
    return isAllowedAmazonUrl(value) !== null;
}

/** Human-friendly store name for UI: the hostname without "www." */
export function storeNameFromUrl(value: string): string {
    const parsed = parseProductUrl(value);
    return parsed ? parsed.hostname.replace(/^www\./i, "") : "";
}

// Params that only carry tracking/session info (never identify the product).
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|gbraid|wbraid|msclkid|dclid|yclid|mc_[a-z]+|_ga|_gl|_hsenc|_hsmi|igshid|srsltid|ref|ref_|referrer|source|_pos|_sid|_ss|_psq|_v|_fid|cmpid|affid|aff|campaign|sscid)$/i;

/**
 * Strips tracking junk so the same product pasted twice maps to one record.
 * Amazon URLs are left untouched (existing records are keyed by the pasted URL).
 * Other query params are kept because many stores identify products with them
 * (?p=123, ?product_id=9, ?variant=...).
 */
export function normalizeProductUrl(value: string): string {
    const parsed = parseProductUrl(value);
    if (!parsed || isAmazonUrl(value)) return value.trim();

    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
        if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
}
