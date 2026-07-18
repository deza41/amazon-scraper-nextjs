import PocketBase, { type RecordModel } from "pocketbase";

const POCKETBASE_URL =
    process.env.NEXT_PUBLIC_POCKETBASE_URL || "https://straight-gass.pockethost.io";

export const pb = new PocketBase(POCKETBASE_URL);

// Realtime subscriptions rely on auto-cancellation being off, otherwise
// PocketBase cancels the previous request when a new one of the same shape
// fires (e.g. two quick getFullList calls), which breaks the subscribe stream.
pb.autoCancellation(false);

export const PRODUCTS_COLLECTION = "amazon_scraper";

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
