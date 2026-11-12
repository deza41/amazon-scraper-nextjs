import PocketBase, { type RecordModel } from "pocketbase";

const POCKETBASE_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL;
if (!POCKETBASE_URL) {
    throw new Error("NEXT_PUBLIC_POCKETBASE_URL is not set");
}

export const pb = new PocketBase(POCKETBASE_URL);

// Realtime subscriptions rely on auto-cancellation being off, otherwise
// PocketBase cancels the previous request when a new one of the same shape
// fires (e.g. two quick getFullList calls), which breaks the subscribe stream.
pb.autoCancellation(false);

export const PRODUCTS_COLLECTION = "shopping_scraper";
/** One row per product per day, holding the price at that point. Cascade-deleted with its product. */
export const TRACKER_COLLECTION = "shopping_tracker";

export interface ProductRecord extends RecordModel {
    url: string;
    name: string;
    image: string;
    savings_percentage: string;
    price: number | null;
    description: string;
    features: string[];
    specifications: Record<string, string>;
    review_summary: string;
    rating: string;
    total_reviews: number | null;
    is_refreshed: boolean;
}

export interface ScrapedProduct {
    url: string;
    name: string;
    image: string;
    savings_percentage: string;
    price: number | null;
    description: string;
    features: string[];
    specifications: Record<string, string>;
    review_summary: string;
    rating: string;
    total_reviews: number | null;
}

export interface PriceTrendPoint {
    id: string;
    price: number;
    savings_percentage: string;
    /** ISO-ish timestamp as stored by PocketBase ("YYYY-MM-DD HH:MM:SS.mmmZ"). */
    recorded_at: string;
}
