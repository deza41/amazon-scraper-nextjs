import type { ScrapedProduct } from "./pocketbase";
import { isAmazonUrl, parseProductUrl } from "./sites";
import { scrapeAmazonProduct } from "./scraper";
import { scrapeWebProduct } from "./web-scraper";
import { SiteScrapeError } from "./scrape-utils";

export { SiteScrapeError };

/** Scrapes a product page from any public store. Amazon has a dedicated parser; everything else is generic. */
export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
    if (!parseProductUrl(url)) throw new SiteScrapeError("That doesn't look like a valid product URL.");
    return isAmazonUrl(url) ? scrapeAmazonProduct(url) : scrapeWebProduct(url);
}
