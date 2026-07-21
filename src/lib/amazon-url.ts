const AMAZON_HOST_PATTERN = /(^|\.)amazon\.[a-z.]{2,}$/i;

// Tracking/session params that don't identify the product — stripped so the
// same product doesn't create duplicate PocketBase records under different URLs.
const TRACKING_PARAMS = ["ref", "ref_", "tag", "linkCode", "camp", "creative", "creativeASIN", "psc", "th", "linkId", "pd_rd_r", "pd_rd_w", "pd_rd_wg", "pf_rd_p", "pf_rd_r", "pf_rd_s", "pf_rd_t", "pf_rd_i", "pf_rd_m", "qid", "sr", "smid", "spLa"];

export function isAllowedAmazonUrl(value: string): URL | null {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
        if (!AMAZON_HOST_PATTERN.test(parsed.hostname)) return null;
        return parsed;
    } catch {
        return null;
    }
}

// Keeps only the /dp/ASIN (or /gp/product/ASIN) path plus host, dropping
// tracking query params and any trailing path segments after the ASIN.
export function normalizeAmazonUrl(parsed: URL): string {
    const dpMatch = parsed.pathname.match(/\/(dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (dpMatch) {
        return `${parsed.origin}/dp/${dpMatch[2].toUpperCase()}`;
    }

    const normalized = new URL(parsed.toString());
    for (const param of TRACKING_PARAMS) {
        normalized.searchParams.delete(param);
    }
    normalized.search = normalized.searchParams.toString() ? `?${normalized.searchParams.toString()}` : "";
    return normalized.toString();
}
