/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // The /api/extension route reads these files at request time, so make sure they ship to Vercel.
    outputFileTracingIncludes: {
        '/api/extension': ['./extension/**/*'],
    },
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                ],
            },
        ]
    },
};

export default nextConfig;
