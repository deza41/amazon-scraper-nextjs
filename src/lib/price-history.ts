import { pb, TRACKER_COLLECTION, type PriceTrendPoint, type ProductRecord } from "./pocketbase";

// PocketBase stores dates as "YYYY-MM-DD HH:MM:SS.mmmZ" (UTC).
const toPbDate = (date: Date) => date.toISOString().replace("T", " ");
const MAX_POINTS = 365;

/**
 * Records the product's current price in shopping_tracker: one point per product per (UTC) day.
 * Scraping again on the same day overwrites that day's point rather than adding noise, so the
 * daily cron plus any manual refreshes still produce one clean point per day.
 *
 * Never throws: price history is secondary, and a tracker hiccup must not fail the scrape itself.
 */
export async function recordPricePoint(product: Pick<ProductRecord, "id" | "price" | "savings_percentage">): Promise<void> {
    if (product.price == null) return;
    try {
        const now = new Date();
        const startOfDay = `${now.toISOString().slice(0, 10)} 00:00:00.000Z`;
        const collection = pb.collection(TRACKER_COLLECTION);
        const data = {
            price: product.price,
            savings_percentage: product.savings_percentage ?? "",
            recorded_at: toPbDate(now),
        };

        const today = await collection.getList(1, 1, {
            filter: pb.filter("product = {:id} && recorded_at >= {:start}", { id: product.id, start: startOfDay }),
            sort: "-recorded_at",
            fields: "id",
        });

        if (today.items[0]) {
            await collection.update(today.items[0].id, data);
        } else {
            await collection.create({ product: product.id, ...data });
        }
    } catch (err) {
        console.error(`Failed to record price point for product ${product.id}:`, err);
    }
}

/** The product's price history, oldest first (most recent MAX_POINTS days). */
export async function getPriceHistory(productId: string): Promise<PriceTrendPoint[]> {
    const result = await pb.collection(TRACKER_COLLECTION).getList<PriceTrendPoint>(1, MAX_POINTS, {
        filter: pb.filter("product = {:id}", { id: productId }),
        sort: "-recorded_at",
        fields: "id,price,savings_percentage,recorded_at",
    });
    return result.items.reverse();
}
