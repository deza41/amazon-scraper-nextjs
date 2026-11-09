import { NextResponse } from "next/server";
import { ScraperBlockedError } from "@/lib/scraper";
import { scrapeProduct, SiteBlockedError, SiteScrapeError } from "@/lib/scrape-product";
import { upsertProduct } from "@/lib/save-product";
import { parseProductUrl, normalizeProductUrl } from "@/lib/sites";
import { UnsafeUrlError } from "@/lib/safe-fetch";

// Protected stores can take ScraperAPI up to ~a minute; this is the Vercel function time limit.
export const maxDuration = 60;

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

        const scraped = await scrapeProduct(normalizeProductUrl(rawUrl));
        const record = await upsertProduct(scraped);

        return NextResponse.json({ product: record }, { status: 200 });
    } catch (error) {
        if (error instanceof UnsafeUrlError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error instanceof ScraperBlockedError || error instanceof SiteBlockedError) {
            // code: "blocked" tells the client it can retry from the user's own machine (local helper).
            console.error("Scraping blocked:", error.message);
            return NextResponse.json({ error: error.message, code: "blocked" }, { status: 502 });
        }
        if (error instanceof SiteScrapeError) {
            console.error("Scraping failed:", error.message);
            return NextResponse.json({ error: error.message }, { status: 502 });
        }
        console.error("Scraping error:", error);
        return NextResponse.json({ error: "An error occurred while scraping the website" }, { status: 500 });
    }
}
