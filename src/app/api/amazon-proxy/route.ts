import { NextResponse } from "next/server";
import { load } from "cheerio";
import { fetchAmazonHtml } from "@/lib/scraper";
import { isAllowedAmazonUrl } from "@/lib/amazon-url";

const AMAZON_HOST_PATTERN = /(^|\.)amazon\.[a-z.]{2,}$/i;

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get("url");

    if (!target) {
        return NextResponse.json({ error: "url query param is required" }, { status: 400 });
    }

    const parsedTarget = isAllowedAmazonUrl(target);
    if (!parsedTarget) {
        return NextResponse.json({ error: "Only amazon.* URLs are allowed" }, { status: 400 });
    }

    try {
        const html = await fetchAmazonHtml(parsedTarget.toString());
        const $ = load(html);
        const origin = parsedTarget.origin;

        if ($("head base").length === 0) {
            $("head").prepend(`<base href="${origin}/">`);
        }

        const rewriteToProxy = (absoluteUrl: string) => `/api/amazon-proxy?url=${encodeURIComponent(absoluteUrl)}`;

        $("a[href]").each((_, el) => {
            const href = $(el).attr("href");
            if (!href) return;
            try {
                const resolved = new URL(href, origin);
                if (AMAZON_HOST_PATTERN.test(resolved.hostname)) {
                    $(el).attr("href", rewriteToProxy(resolved.toString()));
                    $(el).removeAttr("target");
                }
            } catch {
                // ignore unparsable hrefs (mailto:, javascript:, etc.)
            }
        });

        $("form[action]").each((_, el) => {
            const action = $(el).attr("action");
            if (!action) return;
            try {
                const resolved = new URL(action, origin);
                if (AMAZON_HOST_PATTERN.test(resolved.hostname)) {
                    $(el).attr("action", rewriteToProxy(resolved.toString()));
                }
            } catch {
                // ignore unparsable actions
            }
        });

        return new NextResponse($.html(), {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
            },
        });
    } catch (error) {
        console.error("Amazon proxy error:", error);
        return NextResponse.json({ error: "Failed to load the requested Amazon page" }, { status: 502 });
    }
}
