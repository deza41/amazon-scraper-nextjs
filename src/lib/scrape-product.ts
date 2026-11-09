import type { ScrapedProduct } from "./pocketbase";
import { isAmazonUrl, parseProductUrl } from "./sites";
import { parseAmazonProduct, scrapeAmazonProduct } from "./scraper";
import { extractProduct } from "./page-extract";
import { scrapeWebProduct } from "./web-scraper";
import { SiteBlockedError, SiteScrapeError } from "./scrape-utils";

export { SiteBlockedError, SiteScrapeError };

/** Scrapes a product page from any public store. Amazon has a dedicated parser; everything else is generic. */
export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
    if (!parseProductUrl(url)) throw new SiteScrapeError("That doesn't look like a valid product URL.");
    return isAmazonUrl(url) ? scrapeAmazonProduct(url) : scrapeWebProduct(url);
}

/**
 * Parses a product page whose HTML was fetched elsewhere (the user's own machine, via the local
 * helper). The HTML comes from an untrusted client, so it must actually parse as a product page.
 */
export function scrapeFromHtml(url: string, html: string): ScrapedProduct {
    if (isAmazonUrl(url)) {
        const product = parseAmazonProduct(html, url);
        if (!product.name) {
            throw new SiteScrapeError(
                "That page didn't contain a product (Amazon probably showed a CAPTCHA or block page to your machine too)."
            );
        }
        return product;
    }
    const { product, isProductPage } = extractProduct(html, url);
    if (!isProductPage || !product.name) {
        throw new SiteScrapeError("That page didn't contain product details.");
    }
    return product;
}
