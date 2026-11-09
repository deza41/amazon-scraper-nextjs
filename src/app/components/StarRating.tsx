import { Star, StarHalf } from "lucide-react"

interface StarRatingProps {
    rating: number
    className?: string
}

export default function StarRating({ rating, className = "w-4 h-4" }: StarRatingProps) {
    const fullStars = Math.floor(rating)
    const hasHalfStar = rating % 1 >= 0.1

    return (
        <div className="flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
            {Array(5)
                .fill(0)
                .map((_, index) => {
                    if (index < fullStars) {
                        return <Star key={index} className={`${className} text-amber-400 fill-current`} />
                    } else if (index === fullStars && hasHalfStar) {
                        return (
                            <span key={index} className="relative inline-flex">
                                <Star className={`${className} text-muted-foreground/30`} />
                                <StarHalf className={`${className} text-amber-400 fill-current absolute inset-0`} />
                            </span>
                        )
                    } else {
                        return <Star key={index} className={`${className} text-muted-foreground/30`} />
                    }
                })}
        </div>
    )
}
