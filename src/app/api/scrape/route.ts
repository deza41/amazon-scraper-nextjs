import { NextResponse } from "next/server";
import { ClientResponseError } from "pocketbase";
import { pb, PRODUCTS_COLLECTION, type ProductRecord } from "@/lib/pocketbase";
import { ScraperBlockedError } from "@/lib/scraper";
import { scrapeProduct, SiteScrapeError } from "@/lib/scrape-product";
import { parseProductUrl, normalizeProductUrl } from "@/lib/sites";
import { UnsafeUrlError } from "@/lib/safe-fetch";

export async function POST(req: Request) {
    const secret = process.env.SCRAPE_SECRET;
    if (secret && req.headers.get("x-scrape-secret") !== secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
        if (!rawUrl) {
            return NextResponse.json({ error: "url is required" }, { status: 400 });
        }

        if (!parseProductUrl(rawUrl)) {
            return NextResponse.json({ error: "Enter a valid http(s) product URL" }, { status: 400 });
        }

        const url = normalizeProductUrl(rawUrl);
        const scraped = await scrapeProduct(url);

        let record: ProductRecord;
        try {
            const existing = await pb
                .collection(PRODUCTS_COLLECTION)
                .getFirstListItem<ProductRecord>(pb.filter("url = {:url}", { url }));
            record = await pb
                .collection(PRODUCTS_COLLECTION)
                .update<ProductRecord>(existing.id, { ...scraped, is_refreshed: true });
        } catch (err) {
            if (err instanceof ClientResponseError && err.status === 404) {
                record = await pb
                    .collection(PRODUCTS_COLLECTION)
                    .create<ProductRecord>({ ...scraped, is_refreshed: true });
            } else {
                throw err;
            }
        }

        return NextResponse.json({ product: record }, { status: 200 });
    } catch (error) {
        if (error instanceof UnsafeUrlError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error instanceof ScraperBlockedError || error instanceof SiteScrapeError) {
            console.error("Scraping failed:", error.message);
            return NextResponse.json({ error: error.message }, { status: 502 });
        }
        console.error("Scraping error:", error);
        return NextResponse.json({ error: "An error occurred while scraping the website" }, { status: 500 });
    }
}
