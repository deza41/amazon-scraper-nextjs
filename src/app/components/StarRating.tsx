import { Star, StarHalf } from "lucide-react"

interface StarRatingProps {
    rating: number
}

export default function StarRating({ rating }: StarRatingProps) {
    const fullStars = Math.floor(rating)
    const hasHalfStar = rating % 1 >= 0.1

    return (
        <div className="flex">
            {Array(5)
                .fill(0)
                .map((_, index) => {
                    if (index < fullStars) {
                        return <Star key={index} className="w-5 h-5 text-yellow-500 fill-current" />
                    } else if (index === fullStars && hasHalfStar) {
                        return <StarHalf key={index} className="w-5 h-5 text-yellow-500 fill-current" />
                    } else {
                        return <Star key={index} className="w-5 h-5 text-gray-300" />
                    }
                })}
        </div>
    )
}
