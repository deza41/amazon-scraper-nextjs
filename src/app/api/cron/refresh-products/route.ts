import { NextResponse } from "next/server";
import { pb, PRODUCTS_COLLECTION, type ProductRecord } from "@/lib/pocketbase";
import { scrapeAmazonProduct } from "@/lib/scraper";

// Vercel Hobby plan caps function duration at 60s and cron jobs at one run/day
// (vercel.json schedules this daily). Products are processed oldest-`updated`-first
// and capped by a time budget, so a catalog too big for one run just rotates
// across days instead of starving later products forever.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONCURRENCY = 5;
const TIME_BUDGET_MS = 50_000;

async function refreshProduct(product: ProductRecord) {
    const scraped = await scrapeAmazonProduct(product.url);
    await pb.collection(PRODUCTS_COLLECTION).update<ProductRecord>(product.id, {
        ...scraped,
        is_refreshed: true,
    });
}

async function runPool(products: ProductRecord[], concurrency: number, deadline: number) {
    const results: { url: string; ok: boolean; error?: string }[] = [];
    let index = 0;

    async function worker() {
        while (index < products.length && Date.now() < deadline) {
            const product = products[index++];
            try {
                await refreshProduct(product);
                results.push({ url: product.url, ok: true });
            } catch (error) {
                console.error(`Failed to refresh ${product.url}:`, error);
                results.push({
                    url: product.url,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const products = await pb.collection(PRODUCTS_COLLECTION).getFullList<ProductRecord>({ sort: "updated" });
    const deadline = Date.now() + TIME_BUDGET_MS;
    const results = await runPool(products, CONCURRENCY, deadline);
    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({
        total: products.length,
        attempted: results.length,
        succeeded,
        failed: failed.length,
        errors: failed,
    });
}
