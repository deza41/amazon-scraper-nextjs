import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { createZip, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXTENSION_DIR = path.join(process.cwd(), "extension");
const ZIP_FOLDER = "web-scraper-helper";

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...(await listFiles(path.join(dir, entry.name), relative)));
        else files.push(relative);
    }
    return files;
}

/**
 * Serves the browser extension as a zip, with its manifest locked to the site it was downloaded
 * from — so the helper only ever talks to *this* app, and the user never edits a file.
 */
export async function GET(req: Request) {
    // The origin must match the address-bar URL exactly (127.0.0.1 and localhost are different
    // origins), so build it from the Host header the browser used rather than the framework's URL.
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const isLocal = host ? /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) : false;
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? (isLocal ? "http" : "https");
    const origin = host ? `${proto}://${host}` : new URL(req.url).origin;

    try {
        const files = await listFiles(EXTENSION_DIR);
        const entries: ZipEntry[] = [];
        for (const relative of files.sort()) {
            let data = await fs.readFile(path.join(EXTENSION_DIR, relative));
            if (relative === "manifest.json") {
                const manifest = JSON.parse(data.toString("utf8"));
                manifest.content_scripts[0].matches = [`${origin}/*`];
                data = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
            }
            entries.push({ path: `${ZIP_FOLDER}/${relative}`, data });
        }

        const zip = createZip(entries);
        return new NextResponse(new Uint8Array(zip), {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${ZIP_FOLDER}.zip"`,
                "Content-Length": String(zip.length),
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        console.error("Extension download failed:", error);
        return NextResponse.json({ error: "The extension files aren't available on this deployment" }, { status: 500 });
    }
}
