const AMAZON_HOST_PATTERN = /(^|\.)amazon\.[a-z.]{2,}$/i;

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
