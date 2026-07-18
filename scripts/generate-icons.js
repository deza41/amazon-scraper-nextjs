const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const svgPath = path.resolve(__dirname, "../src/public/amazon.svg");
const outDir = path.resolve(__dirname, "../public/icons");

fs.mkdirSync(outDir, { recursive: true });

async function makeIcon({ size, outName, padRatio, background }) {
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
        .toFile(path.join(outDir, outName));

    console.log("wrote", outName);
}

async function main() {
    const white = { r: 255, g: 255, b: 255, alpha: 1 };

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
