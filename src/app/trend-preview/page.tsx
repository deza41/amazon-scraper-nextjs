import { notFound } from "next/navigation"
import TrendPreview from "./TrendPreview"

// Dev-only demo of PriceTrendChart with fake data. 404s in production.
export default function Page() {
    if (process.env.NODE_ENV === "production") notFound()
    return <TrendPreview />
}
