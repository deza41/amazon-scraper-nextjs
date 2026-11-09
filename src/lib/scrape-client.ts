import type { ProductRecord } from "./pocketbase";
import { fetchViaExtension, getExtensionVersion, type FetchedPage } from "./extension-bridge";

// Browser-side scraping flow:
//   1. ask the server (/api/scrape) — fast, works for most stores
//   2. if the server reports the site blocked it, retry from the user's own machine, using
//      (a) the optional browser extension, or (b) the local helper process (local-fetcher/)
//   3. the downloaded HTML is sent to /api/scrape/html to be parsed and saved
// Browsers can't fetch Amazon & co. directly (CORS), which is why a helper is needed at all.
// Both helpers are optional: without either, a blocked scrape just reports the error.

const LOCAL_FETCHER_URL = (process.env.NEXT_PUBLIC_LOCAL_FETCHER_URL || "http://127.0.0.1:4545").replace(/\/+$/, "");
const HELPER_TIMEOUT_MS = 45_000;
const HELPER_RETRY_AFTER_MS = 60_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024; // matches the server's request body limit

class LocalHelperUnavailableError extends Error {}

/** A scrape was blocked and no way of retrying from the user's machine is set up. */
export class NoHelperError extends Error {
    readonly needsHelper = true;
}

const scrapeHeaders: Record<string, string> = { "Content-Type": "application/json" };
if (process.env.NEXT_PUBLIC_SCRAPE_SECRET) {
    scrapeHeaders["x-scrape-secret"] = process.env.NEXT_PUBLIC_SCRAPE_SECRET
}

// Local fetches run one at a time (so a bulk refresh doesn't hammer a store from the user's IP
// and each request gets its own timeout), and a missing local helper is remembered for a minute
// so a bulk refresh doesn't wait on a dead port for every product.
let localQueue: Promise<unknown> = Promise.resolve();
let helperUnavailableUntil = 0;

function runLocally<T>(task: () => Promise<T>): Promise<T> {
    const run = localQueue.then(task, task);
    localQueue = run.catch(() => undefined);
    return run;
}

async function fetchViaLocalHelper(url: string): Promise<FetchedPage> {
    if (Date.now() < helperUnavailableUntil) throw new LocalHelperUnavailableError();

    let response: Response;
    try {
        response = await fetch(`${LOCAL_FETCHER_URL}/fetch?url=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(HELPER_TIMEOUT_MS),
        });
    } catch (err) {
        // Network error = nothing listening (or the browser blocked access to localhost).
        if (err instanceof DOMException && err.name === "TimeoutError") {
            throw new Error("The local helper took too long to fetch that page.");
        }
        helperUnavailableUntil = Date.now() + HELPER_RETRY_AFTER_MS;
        throw new LocalHelperUnavailableError();
    }
    helperUnavailableUntil = 0;

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Local helper: ${data.error || `HTTP ${response.status}`}`);
    return { status: Number(data.status) || 0, url: String(data.url || url), html: typeof data.html === "string" ? data.html : "" };
}

async function postJson(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: scrapeHeaders, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

/** Fetches a page from the user's machine: the extension if installed, else the local helper. */
async function fetchLocally(url: string): Promise<{ page: FetchedPage; viaExtension: boolean }> {
    if (getExtensionVersion()) {
        return { page: await runLocally(() => fetchViaExtension(url, "auto")), viaExtension: true };
    }
    return { page: await runLocally(() => fetchViaLocalHelper(url)), viaExtension: false };
}

export interface ScrapeOutcome {
    product: ProductRecord;
    /** True when the server was blocked and the page was fetched from the user's own machine. */
    viaLocalHelper: boolean;
}

/** Scrapes a product URL, falling back to the user's own machine when the server is blocked. */
export async function scrapeProductUrl(url: string, fallbackError = "Failed to scrape the website"): Promise<ScrapeOutcome> {
    const { response, data } = await postJson("/api/scrape", { url });
    if (response.ok) return { product: data.product as ProductRecord, viaLocalHelper: false };

    const serverError: string = data.error || fallbackError;
    if (data.code !== "blocked") throw new Error(serverError);

    // The server was blocked: retry from this machine.
    let fetched: { page: FetchedPage; viaExtension: boolean };
    try {
        fetched = await fetchLocally(url);
    } catch (err) {
        if (err instanceof LocalHelperUnavailableError) {
            throw new NoHelperError(
                `${serverError} You can retry from your own machine by setting up the optional browser helper.`
            );
        }
        throw err;
    }
    let { page } = fetched;

    if (page.status === 404 || page.status === 410) {
        throw new Error(`That page wasn't found (HTTP ${page.status}).`);
    }
    if (!page.html) throw new Error("Your machine got an empty response from that site.");
    if (new Blob([page.html]).size > MAX_HTML_BYTES) throw new Error("That page is too large to import.");

    let imported = await postJson("/api/scrape/html", { url, html: page.html });

    // The extension's plain fetch may have been served a bot-check or an empty JavaScript shell;
    // a real rendered browser tab usually gets through, so give that one retry.
    if (!imported.response.ok && imported.response.status === 422 && fetched.viaExtension) {
        page = await runLocally(() => fetchViaExtension(url, "tab"));
        if (page.html && new Blob([page.html]).size <= MAX_HTML_BYTES) {
            imported = await postJson("/api/scrape/html", { url, html: page.html });
        }
    }

    if (!imported.response.ok) {
        const reason: string = imported.data.error || "Couldn't read the page";
        throw new Error(`The site blocked the server, and your own machine didn't get a usable page either (${reason})`);
    }
    return { product: imported.data.product as ProductRecord, viaLocalHelper: true };
}
