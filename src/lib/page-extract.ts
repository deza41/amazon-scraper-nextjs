import { load, type CheerioAPI } from "cheerio";
import type { ScrapedProduct } from "./pocketbase";
import {
    absoluteUrl,
    availabilityLabel,
    blockText,
    clean,
    emptyProduct,
    listItems,
    parsePrice,
    savingsPercentage,
    truncate,
} from "./scrape-utils";

// Generic product extractor for arbitrary store pages. It gathers candidates
// from every common source and merges them field by field, in priority order:
//   1. schema.org JSON-LD   (Shopify, WooCommerce, BigCommerce, Magento, ...)
//   2. schema.org microdata (custom stores such as PC Case Gear)
//   3. OpenGraph / product meta tags
//   4. Page markup heuristics (WooCommerce classes, spec tables, <h1>, ...)

type JsonObject = Record<string, unknown>;

/** What one source layer managed to find. Everything is optional. */
interface Candidate {
    name?: string;
    image?: string;
    descriptions?: string[];
    price?: number | null;
    wasPrice?: number | null;
    currency?: string;
    availability?: string;
    sku?: string;
    brand?: string;
    rating?: string;
    reviews?: number | null;
    specs?: Record<string, string>;
    features?: string[];
}

export interface ExtractResult {
    product: ScrapedProduct;
    currency: string;
    /** True when the page carries real product data (not just a generic page title). */
    isProductPage: boolean;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string {
    if (typeof value === "string") return clean(value);
    if (typeof value === "number") return String(value);
    return "";
}

// ---------- 1. JSON-LD ----------

function collectNodes(value: unknown, out: JsonObject[]) {
    if (Array.isArray(value)) {
        value.forEach((v) => collectNodes(v, out));
    } else if (value && typeof value === "object") {
        out.push(value as JsonObject);
        collectNodes((value as JsonObject)["@graph"], out);
    }
}

function nodeHasType(node: JsonObject, ...types: string[]): boolean {
    return asArray(node["@type"] as string | string[] | undefined).some((t) => types.includes(String(t)));
}

function offerDetails(offers: JsonObject[]): { price: number | null; currency: string; availability: string } {
    let price: number | null = null;
    let currency = "";
    let availability = "";
    const consider = (value: number | null, offerCurrency: string, offerAvailability: string) => {
        // Price, currency and stock status always come from the same (cheapest) offer.
        if (value != null && (price == null || value < price)) {
            price = value;
            currency = offerCurrency || currency;
            availability = offerAvailability;
        }
    };
    for (const offer of offers) {
        const nested = asArray(offer.offers as JsonObject | JsonObject[] | undefined);
        if (nested.length) {
            const inner = offerDetails(nested);
            consider(inner.price, inner.currency, inner.availability);
        }
        const spec = asArray(offer.priceSpecification as JsonObject | JsonObject[] | undefined)[0];
        consider(
            parsePrice(offer.price ?? offer.lowPrice ?? spec?.price),
            str(offer.priceCurrency ?? spec?.priceCurrency),
            availabilityLabel(offer.availability)
        );
        currency ||= str(offer.priceCurrency ?? spec?.priceCurrency);
    }
    return { price, currency, availability };
}

function fromJsonLd($: CheerioAPI, url: string): { candidate: Candidate; found: boolean } {
    const nodes: JsonObject[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            collectNodes(JSON.parse($(el).contents().text()), nodes);
        } catch {
            // ignore malformed blocks
        }
    });

    const products = nodes.filter((n) => nodeHasType(n, "Product", "ProductGroup", "IndividualProduct"));
    const node = products.find((n) => str(n.name)) ?? products[0];
    if (!node) return { candidate: {}, found: false };

    // ProductGroup (Shopify variants): offers live on the variants.
    const variants = asArray(node.hasVariant as JsonObject | JsonObject[] | undefined);
    const offers = [
        ...asArray(node.offers as JsonObject | JsonObject[] | undefined),
        ...variants.flatMap((v) => asArray(v.offers as JsonObject | JsonObject[] | undefined)),
    ];
    const { price, currency, availability } = offerDetails(offers);

    const image = asArray(node.image as unknown)[0];
    const brand = node.brand as string | JsonObject | undefined;
    const rating = node.aggregateRating as JsonObject | undefined;
    const ratingValue = rating ? parsePrice(rating.ratingValue) : null;
    const reviewCount = rating ? parsePrice(rating.reviewCount ?? rating.ratingCount) : null;

    return {
        found: true,
        candidate: {
            name: str(node.name),
            image: absoluteUrl(typeof image === "string" ? image : str((image as JsonObject | undefined)?.url), url),
            descriptions: [str(node.description)],
            price,
            currency,
            availability,
            sku: str(node.sku), // variant SKUs differ per option, so groups don't report one
            brand: typeof brand === "string" ? clean(brand) : str(brand?.name),
            rating: ratingValue != null ? String(ratingValue) : "",
            reviews: reviewCount != null ? Math.round(reviewCount) : null,
        },
    };
}

// ---------- 2. Microdata ----------

function fromMicrodata($: CheerioAPI, url: string): { candidate: Candidate; found: boolean } {
    const scope = $('[itemscope][itemtype$="schema.org/Product"]').first();
    if (scope.length === 0) return { candidate: {}, found: false };

    const value = (el: ReturnType<CheerioAPI>) =>
        clean(el.attr("content") || el.attr("href") || el.attr("src") || el.text());
    // Only properties that belong to the product itself, not nested Brand/Offer scopes.
    const own = (prop: string) =>
        scope.find(`[itemprop="${prop}"]`).filter((_, el) => $(el).closest("[itemscope]")[0] === scope[0]).first();

    const offers = scope.find('[itemprop="offers"]').first().length
        ? scope.find('[itemprop="offers"]').first()
        : $('[itemprop="offers"]').first();
    const brandScope = scope.find('[itemprop="brand"]').first();
    const priceEl = offers.find('[itemprop="price"]').first();

    return {
        found: true,
        candidate: {
            name: value(own("name")),
            image: absoluteUrl(value(own("image")), url),
            descriptions: [value(own("description"))],
            price: parsePrice(priceEl.attr("content") ?? priceEl.text()),
            currency: value(offers.find('[itemprop="priceCurrency"]').first()),
            availability: availabilityLabel(value(offers.find('[itemprop="availability"]').first())),
            sku: value(own("sku")),
            brand: brandScope.attr("content") || value(brandScope.find('[itemprop="name"]').first()) || value(brandScope),
            rating: str(parsePrice(value(scope.find('[itemprop="ratingValue"]').first()))),
            reviews: parsePrice(value(scope.find('[itemprop="reviewCount"], [itemprop="ratingCount"]').first())),
        },
    };
}

// ---------- 3. Meta tags ----------

function fromMeta($: CheerioAPI, url: string): Candidate & { productType: boolean } {
    const meta = (name: string) => clean($(`meta[property="${name}"], meta[name="${name}"]`).first().attr("content"));
    let title = meta("og:title") || clean($("title").first().text());
    const siteName = meta("og:site_name");
    if (siteName) {
        title = title.replace(new RegExp(`\\s*[|\\-–—:]\\s*${siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
    }
    return {
        productType: /^(og:)?product/i.test(meta("og:type")),
        name: title,
        image: absoluteUrl(meta("og:image") || meta("twitter:image"), url),
        descriptions: [meta("og:description") || meta("description")],
        price: parsePrice(meta("product:price:amount") || meta("og:price:amount")),
        wasPrice: parsePrice(meta("product:original_price:amount")),
        currency: meta("product:price:currency") || meta("og:price:currency"),
    };
}

// ---------- 4. Page markup heuristics ----------

const DESCRIPTION_SELECTORS = [
    "#overview",
    "#tab-description",
    ".woocommerce-Tabs-panel--description",
    ".woocommerce-product-details__short-description",
    ".product__description",
    ".product-description",
    ".product-single__description",
    "#product-description",
    "#description",
    '[itemprop="description"]',
];

const SPEC_TABLE_SELECTORS = [
    "table.specs-table",
    "table.shop_attributes",
    "table.woocommerce-product-attributes",
    "table.product-specs",
    "table.specifications",
    'table[class*="spec"]',
    "#specs table",
    "#specifications table",
    "#tab-specification table",
    "#tab-additional_information table",
    ".specs table",
    ".specifications table",
    '[class*="specification"] table',
    '[id*="spec"] table',
].join(", ");

const PRICE_CONTAINERS = [
    ".summary .price",
    ".product__price",
    ".product-price",
    ".price-box",
    '[itemprop="offers"]',
    ".price",
];

const WAS_PRICE_SELECTOR = "del, s, strike, .was-price, .price-was, .old-price, .compare-at-price, .rrp, .price--compare";

function fromMarkup($: CheerioAPI): Candidate {
    const candidate: Candidate = {};

    candidate.name =
        clean($("h1.product_title, h1.product-title, h1.product__title, h1[itemprop='name']").first().text()) ||
        clean($("h1").first().text());

    // Price: take the first price container that actually holds a number.
    const priceScope = PRICE_CONTAINERS.map((sel) => $(sel).first()).find((el) => el.length && parsePrice(clean(el.text())) != null);
    if (priceScope) {
        const current = priceScope.find("ins .amount, ins").first();
        const text = clean((current.length ? current : priceScope.find(".amount, .money").first()).text()) || clean(priceScope.text());
        candidate.price = parsePrice(text);
        let was: number | null = null;
        priceScope.find(WAS_PRICE_SELECTOR).each((_, el) => {
            const v = parsePrice(clean($(el).text()));
            if (v != null && (was == null || v > was)) was = v;
        });
        candidate.wasPrice = was;
    }

    const rating = parsePrice(clean($(".woocommerce-product-rating .rating, .star-rating .rating").first().text()));
    if (rating != null) candidate.rating = String(rating);
    candidate.reviews = parsePrice(clean($(".woocommerce-review-link .count").first().text()));

    // Description candidates + feature bullets from the first container that has <li>s.
    candidate.descriptions = [];
    for (const selector of DESCRIPTION_SELECTORS) {
        const el = $(selector).first();
        if (!el.length) continue;
        const text = el.is("meta") ? clean(el.attr("content")) : blockText(el);
        if (text) candidate.descriptions.push(text);
        if (!candidate.features?.length) {
            const items = listItems($, el);
            if (items.length) candidate.features = items;
        }
    }

    // Specification tables / definition lists.
    const specs: Record<string, string> = {};
    const seen = new Set<unknown>();
    $(SPEC_TABLE_SELECTORS).each((_, table) => {
        if (seen.has(table)) return;
        seen.add(table);
        $(table).find("tr").each((__, row) => {
            const cells = $(row).find("th, td");
            if (cells.length !== 2) return;
            const key = clean(cells.eq(0).text());
            const value = clean(cells.eq(1).text());
            if (key && value && key.length < 80 && !(key in specs)) specs[key] = value;
        });
    });
    $('[class*="spec"] dl, [id*="spec"] dl').each((_, dl) => {
        $(dl).find("dt").each((__, dt) => {
            const key = clean($(dt).text());
            const value = clean($(dt).next("dd").text());
            if (key && value && key.length < 80 && !(key in specs)) specs[key] = value;
        });
    });
    candidate.specs = specs;

    if (!candidate.image) {
        candidate.image = clean(
            $('[itemprop="image"], .product__media img, .woocommerce-product-gallery img, .product-gallery img').first().attr("src")
        );
    }
    return candidate;
}

// ---------- merge ----------

function firstOf<T>(values: (T | undefined | null)[], isEmpty: (v: T) => boolean = (v) => !v): T | undefined {
    for (const value of values) {
        if (value != null && !isEmpty(value)) return value;
    }
    return undefined;
}

export function extractProduct(html: string, url: string): ExtractResult {
    const $ = load(html);
    const ld = fromJsonLd($, url);
    const micro = fromMicrodata($, url);
    const meta = fromMeta($, url);
    const markup = fromMarkup($);
    const layers: Candidate[] = [ld.candidate, micro.candidate, markup, meta];

    const pick = <K extends keyof Candidate>(key: K, order: Candidate[] = layers) =>
        firstOf(order.map((c) => c[key] as Candidate[K]), (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0));

    // Name: structured data first, then the visible <h1>, then the (often noisy) page title.
    const name = clean(pick("name", [ld.candidate, micro.candidate, markup, meta]) as string | undefined);

    const price = (firstOf(layers.map((c) => c.price), (v) => v == null) as number | undefined) ?? null;

    // Description: the most informative source wins (microdata/OG blurbs are often boilerplate).
    const descriptions = layers.flatMap((c) => c.descriptions ?? []).map(clean).filter(Boolean);
    const description = truncate(descriptions.sort((a, b) => b.length - a.length)[0] ?? "");

    // Sale price: from markup/meta if present, else a "normally $599" style note opening the description
    // (some stores only state the discount in text).
    let wasPrice = (firstOf(layers.map((c) => c.wasPrice), (v) => v == null) as number | undefined) ?? null;
    if (wasPrice == null && price != null) {
        const note = description.slice(0, 160).match(/\b(?:normally|usually|was|rrp|regularly|reg\.?)\s*:?\s*(?:aud|usd|nzd|au|us)?\$\s*([\d,]+(?:\.\d+)?)/i);
        const noted = note ? parsePrice(note[1]) : null;
        if (noted != null && noted > price) wasPrice = noted;
    }

    const specs: Record<string, string> = {};
    const brand = pick("brand") as string | undefined;
    const sku = pick("sku") as string | undefined;
    const availability = pick("availability") as string | undefined;
    if (brand) specs.Brand = brand;
    if (sku) specs.SKU = sku;
    if (availability) specs.Availability = availability;
    for (const [key, value] of Object.entries(markup.specs ?? {})) {
        if (!(key in specs)) specs[key] = value;
    }
    const currency = ((pick("currency") as string | undefined) ?? "").toUpperCase();
    if (currency) specs.Currency = currency;

    const product = emptyProduct(url);
    product.name = name;
    product.image = (pick("image") as string | undefined) ?? "";
    product.price = price;
    product.savings_percentage = savingsPercentage(price, wasPrice);
    product.description = description;
    product.features = markup.features ?? [];
    product.specifications = specs;
    product.rating = (pick("rating") as string | undefined) ?? "";
    const reviews = (firstOf(layers.map((c) => c.reviews), (v) => v == null) as number | undefined) ?? null;
    product.total_reviews = reviews;
    if (product.rating && reviews != null) product.review_summary = `${product.rating} out of 5 (${reviews} reviews)`;

    // Evidence this is a product page. Structured data or a price declared in meta tags is trusted;
    // a price guessed from page markup only counts alongside an add-to-cart control, because
    // error pages and category pages often carry promo prices and even site-wide og:type=product.
    const hasAddToCart = ADD_TO_CART.test(html);
    const isProductPage =
        Boolean(name) &&
        (ld.found || micro.found || meta.price != null || (markup.price != null && hasAddToCart));
    return { product, currency, isProductPage };
}

const ADD_TO_CART = /add[\s_-]*to[\s_-]*(cart|bag|basket|trolley)|buy[\s_-]*now|name=["']add-to-cart["']/i;

/** True for a near-empty HTML shell that needs JavaScript to render its content (SPA). */
export function looksJsRendered(html: string): boolean {
    const scripts = (html.match(/<script\b/gi) ?? []).length;
    const visible = html
        .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const hasRootMarker = /id=["'](__next|root|app|__nuxt)["']|ng-app|data-reactroot|window\.__NUXT__/i.test(html);
    return (scripts >= 2 && visible.length < 1500) || (hasRootMarker && visible.length < 4000);
}

export function looksLikeShopify(html: string): boolean {
    return /cdn\.shopify\.com|Shopify\.theme|shopify-digital-wallet/i.test(html);
}
