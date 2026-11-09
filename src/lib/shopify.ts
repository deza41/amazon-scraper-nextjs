import { load } from "cheerio";
import type { ScrapedProduct } from "./pocketbase";
import {
    absoluteUrl,
    blockText,
    clean,
    emptyProduct,
    listItems,
    parsePrice,
    savingsPercentage,
    SiteScrapeError,
    truncate,
} from "./scrape-utils";

// Shopify stores publish every product as JSON at <product-page-url>.js —
// small, stable, and it includes sale ("compare at") prices and variants.

interface ShopifyVariant {
    id: number;
    title?: string;
    sku?: string;
    price: number | string;
    compare_at_price?: number | string | null;
    available?: boolean;
    featured_image?: { src?: string } | null;
}

export interface ShopifyProductJs {
    title: string;
    vendor?: string;
    type?: string;
    description?: string; // HTML
    featured_image?: string | null;
    images?: string[];
    variants?: ShopifyVariant[];
}

/** The .js endpoint returns prices in cents (integers); .json returns "129.99" strings. */
function shopifyMoney(value: number | string | null | undefined): number | null {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isInteger(value) ? value / 100 : value;
    return parsePrice(value);
}

/** `/products/<handle>` (optionally locale-prefixed) -> URL of the product JSON, else null. */
export function shopifyJsonUrl(pageUrl: string): string | null {
    try {
        const parsed = new URL(pageUrl);
        const match = parsed.pathname.match(/^(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/[^/]+)\/?$/i);
        return match ? `${parsed.origin}${match[1]}.js` : null;
    } catch {
        return null;
    }
}

export function parseShopifyJson(raw: string): ShopifyProductJs | null {
    try {
        const data = JSON.parse(raw) as ShopifyProductJs;
        return data && typeof data.title === "string" && Array.isArray(data.variants) ? data : null;
    } catch {
        return null;
    }
}

export function parseShopifyProduct(data: ShopifyProductJs, url: string): ScrapedProduct {
    const product = emptyProduct(url);
    const variants = data.variants ?? [];

    let wantedVariantId: number | null = null;
    try {
        const v = new URL(url).searchParams.get("variant");
        if (v) wantedVariantId = Number(v);
    } catch {
        // ignore
    }
    const variant =
        variants.find((v) => v.id === wantedVariantId) ?? variants.find((v) => v.available) ?? variants[0];

    const variantTitle = variant?.title && variant.title !== "Default Title" && variants.length > 1 ? variant.title : "";
    product.name = clean(variantTitle ? `${data.title} - ${variantTitle}` : data.title);
    product.image = absoluteUrl(variant?.featured_image?.src || data.featured_image || data.images?.[0], url);

    const price = shopifyMoney(variant?.price);
    product.price = price;
    product.savings_percentage = savingsPercentage(price, shopifyMoney(variant?.compare_at_price));

    if (data.description) {
        const $ = load(`<div id="root">${data.description}</div>`);
        const root = $("#root");
        product.features = listItems($, root);
        product.description = truncate(blockText(root));
        root.find("table tr").each((_, el) => {
            const cells = $(el).find("td, th");
            const key = clean(cells.eq(0).text());
            const value = clean(cells.eq(1).text());
            if (cells.length === 2 && key && value && !(key in product.specifications)) {
                product.specifications[key] = value;
            }
        });
    }

    const specs: Record<string, string> = {};
    if (variant && variant.available !== undefined) specs.Availability = variant.available ? "In stock" : "Out of stock";
    if (variant?.sku) specs.SKU = clean(variant.sku);
    if (data.vendor) specs.Brand = clean(data.vendor);
    product.specifications = { ...specs, ...product.specifications };

    if (!product.name) throw new SiteScrapeError("Couldn't read that Shopify product.");
    return product;
}

/**
 * Overlays Shopify's authoritative data (price, sale price, variant, stock) onto
 * what was extracted from the page HTML, keeping HTML-only extras like ratings.
 */
export function overlayShopify(base: ScrapedProduct, shop: ScrapedProduct): ScrapedProduct {
    return {
        ...base,
        name: shop.name || base.name,
        image: shop.image || base.image,
        price: shop.price ?? base.price,
        savings_percentage: shop.price != null ? shop.savings_percentage : base.savings_percentage,
        description: base.description.length >= shop.description.length ? base.description : shop.description,
        features: base.features.length ? base.features : shop.features,
        specifications: { ...base.specifications, ...shop.specifications },
    };
}
