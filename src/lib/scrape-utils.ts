import type { CheerioAPI } from "cheerio";
import type { ScrapedProduct } from "./pocketbase";

export class SiteScrapeError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = "SiteScrapeError";
        this.cause = cause;
    }
}

export const MAX_DESCRIPTION_LENGTH = 1500;
export const MAX_FEATURES = 15;

export function clean(text: string | undefined | null): string {
    return (text ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

export function truncate(text: string, max = MAX_DESCRIPTION_LENGTH): string {
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function parsePrice(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const match = value.replace(/,/g, "").match(/\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
}

export function savingsPercentage(price: number | null, was: number | null): string {
    if (price == null || was == null || was <= price || was <= 0) return "";
    return `-${Math.round(((was - price) / was) * 100)}%`;
}

export function absoluteUrl(value: string | undefined | null, base: string): string {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.startsWith("data:")) return "";
    try {
        const resolved = new URL(trimmed, base);
        return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : "";
    } catch {
        return "";
    }
}

export function emptyProduct(url: string): ScrapedProduct {
    return {
        url,
        name: "",
        image: "",
        savings_percentage: "",
        price: null,
        description: "",
        features: [],
        specifications: {},
        review_summary: "",
        rating: "",
        total_reviews: null,
    };
}

const BLOCK_SELECTOR = "br, p, li, tr, td, th, div, h1, h2, h3, h4, h5, h6";

/** An element's visible text with whitespace between block-level pieces. */
export function blockText(scope: ReturnType<CheerioAPI>): string {
    const copy = scope.clone();
    copy.find("script, style, iframe, noscript, svg").remove();
    copy.find(BLOCK_SELECTOR).after(" ");
    return clean(copy.text());
}

export function listItems($: CheerioAPI, scope: ReturnType<CheerioAPI>): string[] {
    const items: string[] = [];
    scope.find("li").each((_, el) => {
        const text = clean($(el).text());
        if (text && text.length < 400 && items.length < MAX_FEATURES) items.push(text);
    });
    return items;
}

const AVAILABILITY_LABELS: Record<string, string> = {
    instock: "In stock",
    instoreonly: "In store only",
    onlineonly: "Online only",
    limitedavailability: "Limited availability",
    outofstock: "Out of stock",
    soldout: "Sold out",
    discontinued: "Discontinued",
    preorder: "Pre-order",
    presale: "Pre-sale",
    backorder: "Back-order",
};

/** schema.org availability URL ("https://schema.org/InStock") -> readable label. */
export function availabilityLabel(value: unknown): string {
    if (typeof value !== "string") return "";
    const key = value.split("/").pop()?.replace(/[^a-z]/gi, "").toLowerCase() ?? "";
    return AVAILABILITY_LABELS[key] ?? "";
}
