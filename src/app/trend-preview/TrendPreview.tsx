'use client'

import PriceTrendChart from "../components/PriceTrendChart"

const DAY = 86_400_000
const pbDate = (t: number) => new Date(t).toISOString().replace("T", " ")

// 30 days of made-up prices: a sale dip, then a partial recovery.
function demoPoints(days: number) {
    const now = Date.now()
    return Array.from({ length: days }, (_, i) => {
        const price = i < 12 ? 99.95 : i < 20 ? 79.99 : i < 24 ? 84.5 : 89.0
        return {
            id: `demo${i}`,
            price: days === 1 ? 80.16 : price,
            savings_percentage: price < 90 && days > 1 ? `${Math.round((1 - price / 99.95) * 100)}% off` : "",
            recorded_at: pbDate(now - (days - 1 - i) * DAY),
        }
    })
}

const FIXTURES: Record<string, { points: ReturnType<typeof demoPoints>; delay?: number }> = {
    demo_many: { points: demoPoints(30) },
    demo_one: { points: demoPoints(1) },
    demo_loading: { points: demoPoints(1), delay: 60_000 },
}

// Answer the chart's trends request with the fixtures above instead of hitting PocketBase.
if (typeof window !== "undefined") {
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const match = url.match(/\/api\/products\/(demo_\w+)\/trends/)
        if (!match) return realFetch(input, init)
        const fixture = FIXTURES[match[1]]
        if (fixture.delay) await new Promise((r) => setTimeout(r, fixture.delay))
        return new Response(JSON.stringify({ points: fixture.points }), { headers: { "Content-Type": "application/json" } })
    }
}

const money = (n: number) => `$${n.toFixed(2)}`

export default function TrendPreview() {
    return (
        <div className="mx-auto max-w-[640px] space-y-10 px-6 py-10">
            {[
                ["30 days of history", "demo_many"],
                ["Only one day (what production shows now)", "demo_one"],
                ["Loading", "demo_loading"],
            ].map(([title, id]) => (
                <section key={id} className="rounded-xl border bg-card p-5">
                    <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
                    <PriceTrendChart productId={id} refreshKey="x" formatPrice={money} />
                </section>
            ))}
        </div>
    )
}
