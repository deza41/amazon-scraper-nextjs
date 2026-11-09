const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const svgPath = path.resolve(__dirname, "icon.svg");
const outDir = path.resolve(__dirname, "../public/icons");

fs.mkdirSync(outDir, { recursive: true });

async function makeIcon({ size, outName, padRatio, background, dir = outDir }) {
    const logoWidth = Math.round(size * (1 - padRatio * 2));
    const logoBuffer = await sharp(svgPath, { density: 300 })
        .resize({ width: logoWidth, fit: "inside" })
        .png()
        .toBuffer();

    const logoMeta = await sharp(logoBuffer).metadata();

    await sharp({
        create: {
            width: size,
            height: size,
            channels: 4,
            background,
        },
    })
        .composite([
            {
                input: logoBuffer,
                left: Math.round((size - (logoMeta.width || logoWidth)) / 2),
                top: Math.round((size - (logoMeta.height || logoWidth)) / 2),
            },
        ])
        .png()
        .toFile(path.join(dir, outName));

    console.log("wrote", outName);
}

// Browser tab icon: rounded indigo tile with the white glyph, packed as a multi-size .ico
// (PNG-compressed entries, supported by all modern browsers). Served by Next from src/app/favicon.ico.
async function makeFavicon(background) {
    const sizes = [16, 32, 48];
    const pngs = [];
    for (const size of sizes) {
        const glyphWidth = Math.round(size * 0.76);
        const glyph = await sharp(svgPath, { density: 400 }).resize({ width: glyphWidth, fit: "inside" }).png().toBuffer();
        const meta = await sharp(glyph).metadata();
        const mask = Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.24}" fill="#fff"/></svg>`
        );
        const png = await sharp({ create: { width: size, height: size, channels: 4, background } })
            .composite([
                {
                    input: glyph,
                    left: Math.round((size - (meta.width || glyphWidth)) / 2),
                    top: Math.round((size - (meta.height || glyphWidth)) / 2),
                },
                { input: mask, blend: "dest-in" },
            ])
            .png()
            .toBuffer();
        pngs.push({ size, png });
    }

    // ICO container: 6-byte header, 16-byte directory entry per image, then the PNG payloads.
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(pngs.length, 4);
    let offset = 6 + 16 * pngs.length;
    const entries = pngs.map(({ size, png }) => {
        const entry = Buffer.alloc(16);
        entry.writeUInt8(size, 0); // width
        entry.writeUInt8(size, 1); // height
        entry.writeUInt16LE(1, 4); // color planes
        entry.writeUInt16LE(32, 6); // bits per pixel
        entry.writeUInt32LE(png.length, 8);
        entry.writeUInt32LE(offset, 12);
        offset += png.length;
        return entry;
    });
    fs.writeFileSync(
        path.resolve(__dirname, "../src/app/favicon.ico"),
        Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)])
    );
    console.log("wrote src/app/favicon.ico");
}

async function main() {
    const white = { r: 79, g: 70, b: 229, alpha: 1 }; // brand indigo (#4f46e5), glyph is white

    await makeFavicon(white);

    // Browser extension icons (extension/manifest.json)
    const extIconDir = path.resolve(__dirname, "../extension/icons");
    fs.mkdirSync(extIconDir, { recursive: true });
    for (const size of [16, 32, 48, 128]) {
        await makeIcon({ size, outName: `icon-${size}.png`, padRatio: 0.12, background: white, dir: extIconDir });
    }

    // "any" purpose icons: minimal padding, logo fills most of the canvas
    await makeIcon({ size: 192, outName: "icon-192.png", padRatio: 0.1, background: white });
    await makeIcon({ size: 512, outName: "icon-512.png", padRatio: 0.1, background: white });

    // "maskable" purpose icons: logo must stay within the ~80% safe-zone circle,
    // so use more padding to survive OS icon masking (circle/squircle/etc).
    await makeIcon({ size: 192, outName: "icon-maskable-192.png", padRatio: 0.22, background: white });
    await makeIcon({ size: 512, outName: "icon-maskable-512.png", padRatio: 0.22, background: white });

    // Apple touch icon: opaque background required, no transparency.
    await makeIcon({ size: 180, outName: "apple-touch-icon.png", padRatio: 0.14, background: white });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
