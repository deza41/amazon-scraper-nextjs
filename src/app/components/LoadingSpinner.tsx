import { Loader2 } from "lucide-react"

export default function LoadingSpinner() {
    return (
        <div className="flex justify-center items-center h-full w-full py-4">
            <Loader2 className="h-16 w-16 animate-spin text-gray-700" />
        </div>
    )
}
