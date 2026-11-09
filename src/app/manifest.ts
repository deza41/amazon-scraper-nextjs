import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Web Scraper",
        short_name: "Scraper",
        description: "Track prices and details from any online store.",
        start_url: "/",
        display: "standalone",
        background_color: "#f5f6fa",
        theme_color: "#4f46e5",
        icons: [
            {
                src: "/icons/icon-192.png",
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "/icons/icon-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "/icons/icon-maskable-192.png",
                sizes: "192x192",
                type: "image/png",
                purpose: "maskable",
            },
            {
                src: "/icons/icon-maskable-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
            },
        ],
    };
}
