import { ClientResponseError } from "pocketbase";
import { pb, PRODUCTS_COLLECTION, type ProductRecord, type ScrapedProduct } from "./pocketbase";

/** Creates the product, or updates it (flagged as refreshed) if its URL is already tracked. */
export async function upsertProduct(scraped: ScrapedProduct): Promise<ProductRecord> {
    const collection = pb.collection(PRODUCTS_COLLECTION);
    try {
        const existing = await collection.getFirstListItem<ProductRecord>(pb.filter("url = {:url}", { url: scraped.url }));
        return await collection.update<ProductRecord>(existing.id, { ...scraped, is_refreshed: true });
    } catch (err) {
        if (err instanceof ClientResponseError && err.status === 404) {
            return await collection.create<ProductRecord>({ ...scraped, is_refreshed: true });
        }
        throw err;
    }
}
