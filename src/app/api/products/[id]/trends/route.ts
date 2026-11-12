import { NextResponse } from "next/server";
import { getPriceHistory } from "@/lib/price-history";

export const dynamic = "force-dynamic";

// GET /api/products/:id/trends -> { points: PriceTrendPoint[] } (oldest first)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    // PocketBase ids are 15 chars of [a-z0-9]; reject anything else before it reaches a filter.
    if (!/^[a-z0-9]{15}$/.test(id)) {
        return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
    }
    try {
        const points = await getPriceHistory(id);
        return NextResponse.json({ points });
    } catch (error) {
        console.error(`Failed to load trends for ${id}:`, error);
        return NextResponse.json({ error: "Failed to load price trends" }, { status: 500 });
    }
}
