import axios from "axios";
import type { ScrapedProduct } from "./pocketbase";
import { extractProduct, looksJsRendered, looksLikeShopify, type ExtractResult } from "./page-extract";
import { safeGet, UnsafeUrlError, type SafeResponse } from "./safe-fetch";
import { overlayShopify, parseShopifyJson, parseShopifyProduct, shopifyJsonUrl } from "./shopify";
import { SiteBlockedError, SiteScrapeError } from "./scrape-utils";

// Generic product scraper for any public store:
//   1. fetch the page directly (free, SSRF-protected)
//   2. if the site blocks that (Cloudflare etc.) or the page needs JavaScript,
//      escalate through ScraperAPI (SCRAPER_API) when configured: plain proxy
//      first, headless-rendered second
//   3. extract product data from structured data + page markup
//   4. on Shopify stores, overlay the store's product JSON for exact prices

const BLOCKED_STATUSES = new Set([401, 403, 429, 503]);
const BLOCK_TITLE = /just a moment|attention required|access denied|are you a (human|robot)|robot check|captcha|verify you are human|security check|pardon our interruption/i;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlocked(response: Pick<SafeResponse, "status" | "body">): boolean {
    if (BLOCKED_STATUSES.has(response.status)) return true;
    const title = response.body.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "";
    if (BLOCK_TITLE.test(title)) return true;
    return response.body.length < 5000 && /captcha|robot/i.test(response.body);
}

function evaluate(html: string, url: string): ExtractResult | null {
    const result = extractProduct(html, url);
    return result.isProductPage && result.product.name ? result : null;
}

/** Direct GET, retrying briefly when a site rate-limits (HTTP 429). */
async function directFetch(url: string): Promise<SafeResponse | null> {
    let last: SafeResponse | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            last = await safeGet(url);
        } catch (err) {
            if (err instanceof UnsafeUrlError) throw err;
            const code = (err as { code?: string }).code;
            if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
                throw new SiteScrapeError("Couldn't find that website. Check the link for typos.", err);
            }
            return null; // timeouts / resets: let the caller decide on a fallback
        }
        if (last.status !== 429) return last;
        await sleep(1000 * Math.pow(2, attempt) + Math.random() * 300);
    }
    return last;
}

async function fetchShopifyJson(pageUrl: string) {
    const jsonUrl = shopifyJsonUrl(pageUrl);
    if (!jsonUrl) return null;
    try {
        const response = await safeGet(jsonUrl, { accept: "application/json,text/javascript,*/*;q=0.8", timeout: 15000 });
        if (response.status !== 200) return null;
        const data = parseShopifyJson(response.body);
        return data ? parseShopifyProduct(data, pageUrl) : null;
    } catch {
        return null;
    }
}

interface Provider {
    name: string;
    run: (url: string) => Promise<string>;
}

async function getText(requestUrl: string, headers: Record<string, string>, timeout: number): Promise<string> {
    const response = await axios.get<string>(requestUrl, { headers, timeout, responseType: "text", transformResponse: (d) => d });
    return response.data;
}

/** Configured escalation tiers, cheapest first. Empty when no provider is configured. */
function configuredProviders(): Provider[] {
    const providers: Provider[] = [];
    const scraperApiKey = process.env.SCRAPER_API;

    if (scraperApiKey) {
        for (const render of [false, true]) {
            providers.push({
                name: render ? "ScraperAPI (rendered)" : "ScraperAPI",
                run: (url) => {
                    const params = new URLSearchParams({ api_key: scraperApiKey, url, keep_headers: "true" });
                    if (render) params.set("render", "true");
                    return getText(`http://api.scraperapi.com?${params.toString()}`, {}, render ? 60000 : 30000);
                },
            });
        }
    }
    return providers;
}

function isProviderRejection(err: unknown): boolean {
    if (!axios.isAxiosError(err)) return false;
    const status = err.response?.status;
    return status === 401 || status === 402 || status === 403;
}

async function viaProviders(
    url: string,
    providers: Provider[]
): Promise<{ result: ExtractResult | null; error?: unknown; loadedPage: boolean }> {
    let lastError: unknown;
    let loadedPage = false;
    const rejected = new Set<string>();
    for (const provider of providers) {
        // "ScraperAPI" and "ScraperAPI (rendered)" share one key/plan.
        const family = provider.name.split(" (")[0];
        if (rejected.has(family)) continue;
        try {
            const html = await provider.run(url);
            loadedPage = true;
            const result = evaluate(html, url);
            if (result) return { result, loadedPage };
            lastError = new Error(`${provider.name} returned a page without product data`);
        } catch (err) {
            lastError = err;
            if (isProviderRejection(err)) rejected.add(family); // key/plan can't access this site
        }
    }
    return { result: null, error: lastError, loadedPage };
}

export async function scrapeWebProduct(url: string): Promise<ScrapedProduct> {
    const providers = configuredProviders();
    const direct = await directFetch(url);

    if (direct && (direct.status === 404 || direct.status === 410)) {
        throw new SiteScrapeError(`That page wasn't found (HTTP ${direct.status}). It may have been removed.`);
    }

    const directBlocked = !direct || isBlocked(direct);
    let extracted: ExtractResult | null = null;
    let html = "";
    // Paid fallbacks only make sense when the site blocked us, or the page is an empty
    // JavaScript shell that a headless browser could fill in. A normal page that simply isn't
    // a product (homepage, category, error page) won't improve when rendered.
    let worthEscalating = directBlocked;

    if (direct && !directBlocked && direct.status < 400) {
        html = direct.body;
        extracted = evaluate(html, url);
        if (!extracted) worthEscalating = looksJsRendered(html);
    }

    // Shopify stores can often be read from their JSON even when the page itself is rate-limited/blocked.
    if (!extracted) {
        const shop = await fetchShopifyJson(url);
        if (shop) return shop;
    }

    let usedApi = false;
    let apiError: unknown;
    let providerLoadedPage = false;
    if (!extracted && worthEscalating && providers.length > 0) {
        usedApi = true;
        const viaApi = await viaProviders(url, providers);
        extracted = viaApi.result;
        apiError = viaApi.error;
        providerLoadedPage = viaApi.loadedPage;
        if (extracted) html = ""; // rendered HTML isn't kept; Shopify enrichment below fetches JSON directly
    }

    if (!extracted) {
        const host = new URL(url).hostname.replace(/^www\./, "");
        if (directBlocked && !providerLoadedPage) {
            if (providers.length === 0) {
                throw new SiteBlockedError(
                    `${host} blocked the request (bot protection). Set SCRAPER_API to route blocked sites through ScraperAPI.`
                );
            }
            throw new SiteBlockedError(
                `${host} blocked the request, even through your configured scraping providers${apiError instanceof Error ? ` (${apiError.message})` : ""}. Your plan may not cover this site.`,
                apiError
            );
        }
        throw new SiteScrapeError(
            usedApi
                ? "Couldn't find product details on that page, even after rendering it. Make sure the link goes to a single product page."
                : worthEscalating
                ? "That page needs JavaScript to load its content. Set SCRAPER_API so it can be rendered."
                : "Couldn't find product details on that page. Make sure the link goes to a single product page."
        );
    }

    let product = extracted.product;
    if ((html && looksLikeShopify(html)) || (!html && shopifyJsonUrl(url))) {
        const shop = await fetchShopifyJson(url);
        if (shop) product = overlayShopify(product, shop);
    }
    return product;
}
