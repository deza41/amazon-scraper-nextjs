import { Loader2 } from "lucide-react"

export default function LoadingSpinner() {
    return (
        <div className="flex justify-center items-center h-full w-full py-4">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
    )
}
