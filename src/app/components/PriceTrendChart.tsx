'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { TrendingDown, TrendingUp, Minus } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { PriceTrendPoint } from "@/lib/pocketbase"

interface Props {
    productId: string
    /** Changes whenever the product is re-scraped, so the chart reloads with the new point. */
    refreshKey: string
    formatPrice: (price: number) => string
}

const HEIGHT = 190
const MARGIN = { top: 12, right: 12, bottom: 24, left: 56 }

// PocketBase dates look like "2026-11-12 03:04:05.000Z"
const parseDate = (value: string) => new Date(value.replace(" ", "T"))
const shortDate = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" })
const longDate = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" })

function useWidth() {
    const ref = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
        observer.observe(el)
        setWidth(el.getBoundingClientRect().width)
        return () => observer.disconnect()
    }, [])
    return [ref, width] as const
}

/** Round the domain outwards to tidy tick values. */
function niceDomain(min: number, max: number) {
    if (min === max) {
        const pad = Math.max(Math.abs(min) * 0.05, 1)
        return [min - pad, max + pad]
    }
    const pad = (max - min) * 0.1
    return [Math.max(0, min - pad), max + pad]
}

export default function PriceTrendChart({ productId, refreshKey, formatPrice }: Props) {
    // Results are tagged with the product they belong to, so switching products never shows stale data.
    const [result, setResult] = useState<{ id: string; points: PriceTrendPoint[] | null } | null>(null)
    const [hover, setHover] = useState<number | null>(null)
    const [containerRef, width] = useWidth()

    useEffect(() => {
        const controller = new AbortController()
        fetch(`/api/products/${productId}/trends`, { signal: controller.signal })
            .then((res) => {
                if (!res.ok) throw new Error(String(res.status))
                return res.json() as Promise<{ points: PriceTrendPoint[] }>
            })
            .then((data) => setResult({ id: productId, points: data.points }))
            .catch((err) => {
                if (err.name !== "AbortError") setResult({ id: productId, points: null })
            })
        return () => controller.abort()
    }, [productId, refreshKey])

    const current = result?.id === productId ? result : null
    const points = current?.points ?? null
    const error = current !== null && current.points === null

    const layout = useMemo(() => {
        if (!points || points.length < 2 || width === 0) return null
        const times = points.map((p) => parseDate(p.recorded_at).getTime())
        const prices = points.map((p) => p.price)
        const [yMin, yMax] = niceDomain(Math.min(...prices), Math.max(...prices))
        const innerW = width - MARGIN.left - MARGIN.right
        const innerH = HEIGHT - MARGIN.top - MARGIN.bottom
        const t0 = times[0]
        const tSpan = times[times.length - 1] - t0 || 1
        const x = (t: number) => MARGIN.left + ((t - t0) / tSpan) * innerW
        const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * innerH
        const coords = points.map((p, i) => ({ x: x(times[i]), y: y(p.price) }))
        const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")
        const baseline = MARGIN.top + innerH
        const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${baseline} L${coords[0].x.toFixed(1)},${baseline} Z`
        const ticks = [0, 0.5, 1].map((f) => yMin + (yMax - yMin) * f)
        return { coords, line, area, ticks, y, baseline, innerW }
    }, [points, width])

    if (error) {
        return <p className="text-sm text-muted-foreground">Couldn&apos;t load the price history.</p>
    }
    if (points === null) {
        return <Skeleton className="h-[190px] w-full" />
    }
    if (points.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                No price history yet. A point is added each time the product is scraped or refreshed.
            </p>
        )
    }

    const first = points[0]
    const last = points[points.length - 1]
    const prices = points.map((p) => p.price)
    const low = Math.min(...prices)
    const high = Math.max(...prices)
    const change = last.price - first.price
    const changePct = first.price ? (change / first.price) * 100 : 0
    const TrendIcon = change < 0 ? TrendingDown : change > 0 ? TrendingUp : Minus
    const changeLabel =
        change === 0
            ? "No change"
            : `${change < 0 ? "Down" : "Up"} ${formatPrice(Math.abs(change))} (${Math.abs(changePct).toFixed(1)}%)`

    const handleMove = (event: PointerEvent<SVGSVGElement>) => {
        if (!layout) return
        const rect = event.currentTarget.getBoundingClientRect()
        const px = event.clientX - rect.left
        let nearest = 0
        for (let i = 1; i < layout.coords.length; i++) {
            if (Math.abs(layout.coords[i].x - px) < Math.abs(layout.coords[nearest].x - px)) nearest = i
        }
        setHover(nearest)
    }

    const hovered = hover !== null && layout && hover < points!.length ? { point: points[hover], coord: layout.coords[hover] } : null

    return (
        <div>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium">
                    <TrendIcon className="h-4 w-4" aria-hidden />
                    {points.length > 1 ? changeLabel : "Tracking started"}
                </span>
                <span className="text-muted-foreground">Lowest {formatPrice(low)}</span>
                <span className="text-muted-foreground">Highest {formatPrice(high)}</span>
            </div>

            <div ref={containerRef} className="relative w-full">
                {layout ? (
                    <>
                        <svg
                            width={width}
                            height={HEIGHT}
                            role="img"
                            aria-label={`Price history over ${points.length} days: ${changeLabel}. Lowest ${formatPrice(low)}, highest ${formatPrice(high)}.`}
                            onPointerMove={handleMove}
                            onPointerLeave={() => setHover(null)}
                            className="touch-pan-y"
                        >
                            {layout.ticks.map((tick) => (
                                <g key={tick}>
                                    <line
                                        x1={MARGIN.left}
                                        x2={width - MARGIN.right}
                                        y1={layout.y(tick)}
                                        y2={layout.y(tick)}
                                        stroke="hsl(var(--border))"
                                        strokeWidth={1}
                                    />
                                    <text
                                        x={MARGIN.left - 8}
                                        y={layout.y(tick)}
                                        textAnchor="end"
                                        dominantBaseline="middle"
                                        className="fill-muted-foreground text-[11px]"
                                    >
                                        {formatPrice(tick)}
                                    </text>
                                </g>
                            ))}
                            <text x={MARGIN.left} y={HEIGHT - 6} className="fill-muted-foreground text-[11px]">
                                {shortDate.format(parseDate(first.recorded_at))}
                            </text>
                            <text x={width - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">
                                {shortDate.format(parseDate(last.recorded_at))}
                            </text>

                            <path d={layout.area} fill="hsl(var(--brand))" fillOpacity={0.1} />
                            <path d={layout.line} fill="none" stroke="hsl(var(--brand))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

                            {/* latest value is always marked; the rest appear on hover */}
                            <circle
                                cx={layout.coords[layout.coords.length - 1].x}
                                cy={layout.coords[layout.coords.length - 1].y}
                                r={4}
                                fill="hsl(var(--brand))"
                                stroke="hsl(var(--card))"
                                strokeWidth={2}
                            />
                            {hovered && (
                                <g pointerEvents="none">
                                    <line x1={hovered.coord.x} x2={hovered.coord.x} y1={MARGIN.top} y2={layout.baseline} stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="3 3" />
                                    <circle cx={hovered.coord.x} cy={hovered.coord.y} r={5} fill="hsl(var(--brand))" stroke="hsl(var(--card))" strokeWidth={2} />
                                </g>
                            )}
                        </svg>
                        {hovered && (
                            <div
                                className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
                                style={{
                                    left: Math.min(Math.max(hovered.coord.x, 70), width - 70),
                                    top: Math.max(hovered.coord.y - 8, 0),
                                    transform: "translate(-50%, -100%)",
                                }}
                            >
                                <div className="text-muted-foreground">{longDate.format(parseDate(hovered.point.recorded_at))}</div>
                                <div className="font-semibold">
                                    {formatPrice(hovered.point.price)}
                                    {hovered.point.savings_percentage && (
                                        <span className="ml-1.5 font-normal text-muted-foreground">{hovered.point.savings_percentage}</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    points.length < 2 && (
                        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                            {formatPrice(last.price)} recorded on {longDate.format(parseDate(last.recorded_at))}. The chart appears once there are two or more days of data.
                        </p>
                    )
                )}
            </div>

            <table className="sr-only">
                <caption>Price history</caption>
                <thead>
                    <tr><th>Date</th><th>Price</th></tr>
                </thead>
                <tbody>
                    {points.map((p) => (
                        <tr key={p.id}>
                            <td>{longDate.format(parseDate(p.recorded_at))}</td>
                            <td>{formatPrice(p.price)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
