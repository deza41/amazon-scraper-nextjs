import axios from "axios";
import { load } from "cheerio";
import type { ScrapedProduct } from "./pocketbase";

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ScraperBlockedError extends Error {
    constructor(url: string, cause?: unknown, usedApiKey = true) {
        const causeMessage = cause instanceof Error ? cause.message : undefined;
        const parts = [
            `Amazon blocked scraping requests for ${url} after retrying${usedApiKey ? " with rendering enabled" : ""}.`,
        ];
        if (causeMessage) parts.push(`Last error: ${causeMessage}.`);
        if (!usedApiKey) {
            parts.push(
                "No SCRAPER_API key is configured, so requests were sent directly and are blocked more easily — set SCRAPER_API for better reliability."
            );
        }
        super(parts.join(" "));
        this.name = "ScraperBlockedError";
        this.cause = cause;
    }
}

// Generic CAPTCHA/block-page signals that apply to any Amazon page (product,
// homepage, search, etc.) — NOT a check for product-specific markup, since
// fetchAmazonHtml is shared with the amazon-proxy route which loads any page.
function looksBlocked(html: string) {
    if (!html || html.length < 2000) return true;
    const lower = html.toLowerCase();
    if (lower.includes("enter the characters you see below")) return true;
    if (lower.includes("robot check")) return true;
    if (lower.includes("api-services-support@amazon.com")) return true;
    if (lower.includes("awswaf.com") || lower.includes("awswafintegration")) return true;
    return false;
}

interface FetchOptions {
    render: boolean;
}

async function fetchViaScraperApi(url: string, apiKey: string, { render }: FetchOptions): Promise<string> {
    const params = new URLSearchParams({
        api_key: apiKey,
        url,
        keep_headers: "true",
    });
    if (render) {
        params.set("render", "true");
    }

    const response = await axios.get(`http://api.scraperapi.com?${params.toString()}`, {
        headers: { "User-Agent": randomUserAgent() },
        timeout: render ? 60000 : 30000,
    });

    return response.data as string;
}

function requiresPaidPlan(err: unknown): boolean {
    if (!axios.isAxiosError(err) || err.response?.status !== 403) return false;
    const data = err.response.data;
    const message = typeof data === "string" ? data : JSON.stringify(data ?? "");
    return message.toLowerCase().includes("paid plan");
}

async function fetchDirect(url: string): Promise<string> {
    const response = await axios.get(url, {
        headers: {
            "User-Agent": randomUserAgent(),
            "Accept-Language": "en-US,en;q=0.9",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
        timeout: 30000,
    });
    return response.data as string;
}

/**
 * Fetches an Amazon page's HTML, retrying with backoff. When SCRAPER_API is
 * configured, escalates to ScraperAPI's render=true (real headless browser)
 * tier if plain requests keep coming back blocked/CAPTCHA'd. Without a key,
 * falls back to fetching Amazon directly (free, but blocked more easily since
 * requests come from this server's own IP instead of a rotated proxy pool).
 */
export async function fetchAmazonHtml(url: string): Promise<string> {
    let apiKey = process.env.SCRAPER_API;
    const attempts: FetchOptions[] = apiKey
        ? [{ render: false }, { render: false }, { render: true }, { render: true }]
        : [{ render: false }, { render: false }, { render: false }, { render: false }];

    let lastError: unknown;
    for (let i = 0; i < attempts.length; i++) {
        try {
            const html = apiKey
                ? await fetchViaScraperApi(url, apiKey, attempts[i])
                : await fetchDirect(url);
            if (!looksBlocked(html)) {
                return html;
            }
            lastError = new Error("Response looked like a block/CAPTCHA page");
        } catch (err) {
            lastError = err;
            if (apiKey && requiresPaidPlan(err)) {
                console.warn(`SCRAPER_API key can't access ${url} (requires a paid plan) — falling back to direct requests`);
                apiKey = undefined;
            }
        }

        if (i < attempts.length - 1) {
            await sleep(500 * Math.pow(2, i) + Math.random() * 250);
        }
    }

    console.error(`Failed to fetch ${url}:`, lastError);
    throw new ScraperBlockedError(url, lastError, Boolean(apiKey));
}

function cleanPrice(text: string): number | null {
    const match = text.replace(/,/g, "").match(/[\d]+(\.\d+)?/);
    if (!match) return null;
    return parseFloat(match[0]);
}

function firstMatch(...values: (string | undefined | null)[]): string {
    for (const value of values) {
        if (value && value.trim()) return value.trim();
    }
    return "";
}

export function parseAmazonProduct(html: string, url: string): ScrapedProduct {
    const $ = load(html);

    const name = firstMatch(
        $("#productTitle").text(),
        $("h1#title span").text(),
        $("h1.a-size-large").first().text()
    );

    const priceText = firstMatch(
        $(".priceToPay .a-offscreen").first().text(),
        $(".a-price .a-offscreen").first().text(),
        $("#corePrice_feature_div .a-offscreen").first().text(),
        $(".a-price-whole").first().text()
    );
    const price = priceText ? cleanPrice(priceText) : null;

    const savingsMatch = $(".savingsPercentage").first().text().trim().match(/-?\d+%/);
    const savings_percentage = savingsMatch ? savingsMatch[0] : "";

    const image = firstMatch(
        $("#landingImage").attr("src"),
        $("#imgTagWrapperId img").attr("src"),
        $(".a-dynamic-image").first().attr("src")
    );

    const description = firstMatch(
        $("#productDescription").text(),
        $("#feature-bullets ul li").map((_, el) => $(el).text().trim()).get().join(" "),
        $('meta[name="description"]').attr("content")
    );

    const features: string[] = [];
    $("#feature-bullets ul li").each((_, el) => {
        const feature = $(el).text().trim();
        if (feature) features.push(feature);
    });

    const specifications: Record<string, string> = {};
    $("#productDetails_techSpec_section_1 tr").each((_, el) => {
        const key = $(el).find("th").text().trim();
        const value = $(el).find("td").text().trim();
        if (key && value) specifications[key] = value;
    });
    if (Object.keys(specifications).length === 0) {
        $("#detailBullets_feature_div li").each((_, el) => {
            const text = $(el).text().trim();
            const [key, ...rest] = text.split(":");
            if (key && rest.length) {
                specifications[key.trim()] = rest.join(":").trim();
            }
        });
    }

    const review_summary = $("#averageCustomerReviews span").text().trim();

    const ratingText = $(".a-icon-alt").first().text().trim();
    const ratingMatch = ratingText.match(/(\d+(\.\d+)?) out of 5 stars/);
    const rating = ratingMatch ? ratingMatch[1] : "";

    const totalReviewsText = $("#acrCustomerReviewText").first().text().trim();
    const totalReviewsMatch = totalReviewsText.replace(/,/g, "").match(/\d+/);
    const total_reviews = totalReviewsMatch ? parseInt(totalReviewsMatch[0], 10) : null;

    return {
        url,
        name,
        image,
        savings_percentage,
        price,
        description,
        features,
        specifications,
        review_summary,
        rating,
        total_reviews,
    };
}

export async function scrapeAmazonProduct(url: string): Promise<ScrapedProduct> {
    const html = await fetchAmazonHtml(url);
    return parseAmazonProduct(html, url);
}
