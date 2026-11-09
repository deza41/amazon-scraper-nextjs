import nextConfig from "eslint-config-next";

export default [
    ...nextConfig,
    // Plain-JS tools that run outside the Next.js app (browser extension, local helper, scripts).
    { ignores: ["extension/**", "local-fetcher/**", "scripts/**"] },
];
