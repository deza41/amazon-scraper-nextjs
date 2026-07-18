import { NextResponse } from "next/server";
import { ClientResponseError } from "pocketbase";
import { pb, PRODUCTS_COLLECTION, type ProductRecord } from "@/lib/pocketbase";
import { scrapeAmazonProduct, ScraperBlockedError, ScraperConfigError } from "@/lib/scraper";

export async function POST(req: Request) {
    try {
        const { url } = await req.json();
        if (!url) {
            return NextResponse.json({ error: "url is required" }, { status: 400 });
        }

        const scraped = await scrapeAmazonProduct(url);

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
        if (error instanceof ScraperConfigError) {
            console.error("Scraper misconfigured:", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        if (error instanceof ScraperBlockedError) {
            console.error("Scraping blocked:", error.message);
            return NextResponse.json({ error: error.message }, { status: 502 });
        }
        console.error("Scraping error:", error);
        return NextResponse.json({ error: "An error occurred while scraping the website" }, { status: 500 });
    }
}
