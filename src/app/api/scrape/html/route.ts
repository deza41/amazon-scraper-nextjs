import { NextResponse } from "next/server";
import { scrapeFromHtml, SiteScrapeError } from "@/lib/scrape-product";
import { upsertProduct } from "@/lib/save-product";
import { parseProductUrl, normalizeProductUrl } from "@/lib/sites";

// Accepts a product page's HTML that the browser fetched through the user's local helper
// (a site had blocked this server). Vercel caps request bodies at ~4.5 MB.
const MAX_HTML_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
    const secret = process.env.SCRAPE_SECRET;
    if (secret && req.headers.get("x-scrape-secret") !== secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
        const html = typeof body?.html === "string" ? body.html : "";

        if (!parseProductUrl(rawUrl)) {
            return NextResponse.json({ error: "Enter a valid http(s) product URL" }, { status: 400 });
        }
        if (!html) {
            return NextResponse.json({ error: "html is required" }, { status: 400 });
        }
        if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
            return NextResponse.json({ error: "That page is too large to import" }, { status: 413 });
        }

        const scraped = scrapeFromHtml(normalizeProductUrl(rawUrl), html);
        const record = await upsertProduct(scraped);
        return NextResponse.json({ product: record }, { status: 200 });
    } catch (error) {
        if (error instanceof SiteScrapeError) {
            return NextResponse.json({ error: error.message }, { status: 422 });
        }
        console.error("HTML import error:", error);
        return NextResponse.json({ error: "An error occurred while importing the page" }, { status: 500 });
    }
}
