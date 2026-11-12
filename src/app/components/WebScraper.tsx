'use client'

import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent } from "react"
import { toast } from "sonner"
import { Search, Trash2, RefreshCw, Link as LinkIcon, List, LayoutGrid, ExternalLink, PackageSearch, Puzzle } from "lucide-react"
import StarRating from "./StarRating"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { motion, AnimatePresence } from "framer-motion"
import DraggableModal from "./DraggableModal"
import { pb, PRODUCTS_COLLECTION, type ProductRecord } from "@/lib/pocketbase"
import { getSlowSiteName, storeNameFromUrl } from "@/lib/sites"
import { NoHelperError, scrapeProductUrl } from "@/lib/scrape-client"
import { getExtensionVersion } from "@/lib/extension-bridge"
import BrowserHelperDialog from "./BrowserHelperDialog"
import PriceTrendChart from "./PriceTrendChart"

const AMAZON_HOMEPAGE = "https://www.amazon.com.au/"

function storeLabel(url: string) {
    return storeNameFromUrl(url) || "store"
}

// Deterministic per-store accent so each shop is recognisable at a glance,
// without loading favicons from third parties.
function storeHue(name: string) {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360
    return hash
}

function StoreChip({ url, className = "" }: { url: string; className?: string }) {
    const name = storeLabel(url)
    const hue = storeHue(name)
    return (
        <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
            <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold uppercase"
                style={{ backgroundColor: `hsl(${hue} 70% 93%)`, color: `hsl(${hue} 60% 32%)` }}
            >
                {name.charAt(0)}
            </span>
            <span className="truncate text-xs font-medium text-muted-foreground">{name}</span>
        </span>
    )
}

/** The scraper stores the ISO currency code in specifications.Currency; older records default to "$". */
function productCurrency(product: ProductRecord | null) {
    const value = product?.specifications?.Currency
    return typeof value === "string" ? value : undefined
}

function formatPrice(price: number | null, currency?: string) {
    if (price == null) return null
    if (currency && /^[A-Z]{3}$/.test(currency)) {
        try {
            return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(price)
        } catch {
            // unknown currency code: fall through to the plain format
        }
    }
    return `$${price.toFixed(2)}`
}

export default function WebScraper() {
    const [url, setUrl] = useState("")
    const [products, setProducts] = useState<ProductRecord[]>([])
    const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null)
    const [productToDelete, setProductToDelete] = useState<ProductRecord | null>(null)
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(false)
    const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null)
    const [initialLoading, setInitialLoading] = useState(true)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [listView, setListView] = useState(false)
    const [isUrlModalOpen, setIsUrlModalOpen] = useState(false)
    const [helperVersion, setHelperVersion] = useState<string | null>(null)
    const [helperDialogOpen, setHelperDialogOpen] = useState(false)
    const modalRef = useRef<HTMLDivElement>(null)

    const closeModal = useCallback(() => setSelectedProduct(null), [])

    // Optional browser extension: detect it on load and whenever the user returns to this tab
    // (e.g. after installing it from chrome://extensions).
    useEffect(() => {
        const check = () => setHelperVersion(getExtensionVersion())
        check()
        window.addEventListener("focus", check)
        return () => window.removeEventListener("focus", check)
    }, [])

    // A blocked scrape with no helper set up gets a "Set up" shortcut. Nothing else nags about it.
    const reportError = (err: unknown, fallback: string) => {
        const message = err instanceof Error ? err.message : fallback
        if (err instanceof NoHelperError) {
            toast.error(message, {
                duration: 12000,
                action: { label: "Set up", onClick: () => setHelperDialogOpen(true) },
            })
        } else {
            toast.error(message)
        }
    }

    useEffect(() => {
        async function loadProducts() {
            try {
                setInitialLoading(true)
                const records = await pb
                    .collection(PRODUCTS_COLLECTION)
                    .getFullList<ProductRecord>({ sort: '-created' })
                setProducts(records)
            } catch (err) {
                console.error('Error loading products:', err)
                toast.error('Failed to load products from PocketBase')
            } finally {
                setInitialLoading(false)
            }
        }
        loadProducts()
    }, [])

    useEffect(() => {
        const collection = pb.collection(PRODUCTS_COLLECTION)
        let active = true

        collection.subscribe<ProductRecord>('*', (event) => {
            if (!active) return
            setProducts((prev) => {
                if (event.action === 'create') {
                    if (prev.some((p) => p.id === event.record.id)) {
                        return prev.map((p) => (p.id === event.record.id ? event.record : p))
                    }
                    return [event.record, ...prev]
                }
                if (event.action === 'update') {
                    return prev.map((p) => (p.id === event.record.id ? event.record : p))
                }
                if (event.action === 'delete') {
                    return prev.filter((p) => p.id !== event.record.id)
                }
                return prev
            })
            setSelectedProduct((prev) => {
                if (!prev || prev.id !== event.record.id) return prev
                return event.action === 'delete' ? null : event.record
            })
        })

        return () => {
            active = false
            collection.unsubscribe('*')
        }
    }, [])

    const activeProducts = useMemo(() => {
        const term = search.toLowerCase().trim()
        if (!term) return products
        return products.filter((product) =>
            Object.values(product).some((value) => String(value).toLowerCase().includes(term))
        )
    }, [products, search])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node) && !isDeleteDialogOpen) {
                closeModal()
            }
        }

        if (selectedProduct) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [selectedProduct, isDeleteDialogOpen, closeModal])

    // Heavily protected stores (Harvey Norman, Bing Lee) can take up to a minute, so say so rather
    // than looking frozen. Returns a function that dismisses the notice.
    const warnIfSlow = (urls: string[]) => {
        const names = [...new Set(urls.map(getSlowSiteName).filter((name): name is string => Boolean(name)))]
        if (names.length === 0) return () => {}
        const id = toast.loading(
            `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} heavily protected, so this can take up to a minute. Please keep this tab open.`
        )
        return () => toast.dismiss(id)
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setLoading(true)
        const dismissWarning = warnIfSlow([url])

        try {
            const { viaLocalHelper } = await scrapeProductUrl(url, "Failed to scrape the website")

            setUrl("")
            toast.success(viaLocalHelper ? "Product scraped using your own machine" : "Product scraped successfully")
        } catch (err) {
            reportError(err, "An error occurred while scraping the website")
        } finally {
            dismissWarning()
            setLoading(false)
        }
    }

    const handleProductClick = async (product: ProductRecord) => {
        setSelectedProduct(product)
        if (product.is_refreshed) {
            try {
                await pb.collection(PRODUCTS_COLLECTION).update(product.id, { is_refreshed: false })
            } catch (err) {
                console.error('Error clearing is_refreshed flag:', err)
            }
        }
    }

    const openDeleteDialog = (product: ProductRecord) => {
        setProductToDelete(product)
        setIsDeleteDialogOpen(true)
    }

    const deleteProduct = async () => {
        if (!productToDelete) return
        try {
            await pb.collection(PRODUCTS_COLLECTION).delete(productToDelete.id)
            toast.success("Product deleted")
        } catch (err) {
            console.error('Error deleting product:', err)
            toast.error("An error occurred while deleting the product")
        } finally {
            setIsDeleteDialogOpen(false)
            setProductToDelete(null)
            closeModal()
        }
    }

    const refreshProduct = async (product: ProductRecord) => {
        setLoading(true)
        const dismissWarning = warnIfSlow([product.url])
        try {
            const { product: refreshed, viaLocalHelper } = await scrapeProductUrl(product.url, "Failed to refresh the product")
            setSelectedProduct(refreshed)
            toast.success(viaLocalHelper ? "Product refreshed using your own machine" : "Product refreshed")
        } catch (err) {
            reportError(err, "An error occurred while refreshing the product")
        } finally {
            dismissWarning()
            setLoading(false)
        }
    }

    const refreshAllProducts = async () => {
        if (products.length === 0) return
        setLoading(true)
        const dismissWarning = warnIfSlow(products.map((product) => product.url))

        const total = products.length
        const concurrentFetches = 5
        const queue = [...products]
        let succeeded = 0
        let failed = 0
        const progressText = () => `Refreshing ${succeeded + failed} of ${total} products${failed ? ` (${failed} failed)` : ""}`
        const progressToast = toast.loading(progressText())
        setRefreshProgress({ done: 0, total })

        const worker = async () => {
            while (queue.length > 0) {
                const product = queue.shift()
                if (!product) break
                try {
                    await scrapeProductUrl(product.url)
                    succeeded += 1
                } catch {
                    failed += 1
                }
                setRefreshProgress({ done: succeeded + failed, total })
                toast.loading(progressText(), { id: progressToast })
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(concurrentFetches, total) }, worker)
        )

        dismissWarning()
        toast.dismiss(progressToast)
        setRefreshProgress(null)
        setLoading(false)
        if (failed === 0) {
            toast.success(`Refreshed ${succeeded} product${succeeded === 1 ? '' : 's'}`)
        } else {
            toast.warning(`Refreshed ${succeeded} of ${total} products, ${failed} failed`)
        }
    }


    const detailRow = "grid gap-1 sm:grid-cols-3 sm:gap-4 py-4 first:pt-0"
    const detailLabel = "text-xs font-medium uppercase tracking-wide text-muted-foreground"
    const detailValue = "text-sm text-foreground sm:col-span-2"
    const selectedCurrency = productCurrency(selectedProduct)
    const visibleSpecs = Object.entries(selectedProduct?.specifications ?? {}).filter(([key]) => key !== "Currency")

    return (
        <TooltipProvider>
            <div className="page-glow min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
                <div className="max-w-6xl mx-auto">
                    <header className="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-violet-500 text-brand-foreground shadow-lg shadow-brand/25">
                            <PackageSearch className="h-6 w-6" />
                        </span>
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                                Shopping Scraper
                            </h1>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Track prices and details from any online store. Just paste a product link.
                            </p>
                        </div>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="sm:ml-auto"
                                    onClick={() => setHelperDialogOpen(true)}
                                >
                                    <Puzzle />
                                    Browser helper
                                    {helperVersion && <span aria-label="Installed" className="h-2 w-2 rounded-full bg-success" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {helperVersion
                                    ? "Installed. Blocked sites are fetched through your browser."
                                    : "Optional: fetch sites that block our server through your own browser"}
                            </TooltipContent>
                        </Tooltip>
                    </header>

                    <form onSubmit={handleSubmit} className="mb-10">
                        <Label htmlFor="scrape-url" className="sr-only">Product URL</Label>
                        <div className="flex items-center gap-2 rounded-2xl border bg-card p-2 shadow-md shadow-brand/5 transition-shadow focus-within:shadow-lg focus-within:shadow-brand/10 focus-within:ring-2 focus-within:ring-ring/30">
                            <Input
                                id="scrape-url"
                                type="url"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://store.com/products/..."
                                required
                                disabled={loading}
                                className="h-11 border-none bg-transparent shadow-none focus-visible:ring-0"
                            />
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        variant={isUrlModalOpen ? "secondary" : "ghost"}
                                        size="icon"
                                        className="h-11 w-11 shrink-0"
                                        aria-label="Open Amazon Browser"
                                        onClick={() => setIsUrlModalOpen(!isUrlModalOpen)}
                                    >
                                        <LinkIcon className={isUrlModalOpen ? "text-brand" : ""} />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open Amazon Browser</TooltipContent>
                            </Tooltip>
                            <Button type="submit" variant="brand" disabled={loading} className="h-11 px-5 shrink-0">
                                <Search />
                                {loading ? "Scraping..." : "Scrape"}
                            </Button>
                        </div>
                    </form>

                    {initialLoading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Card key={i} className="p-4">
                                    <Skeleton className="h-48 w-full mb-4" />
                                    <Skeleton className="h-5 w-3/4 mb-2" />
                                    <Skeleton className="h-4 w-1/2" />
                                </Card>
                            ))}
                        </div>
                    ) : products.length > 0 ? (
                        <section>
                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-baseline gap-2">
                                    <h2 className="text-lg font-semibold tracking-tight">Scraped Products</h2>
                                    <span className="text-sm text-muted-foreground">
                                        {activeProducts.length === products.length
                                            ? products.length
                                            : `${activeProducts.length} of ${products.length}`}
                                    </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Label htmlFor="search-products" className="sr-only">Search products</Label>
                                    <Input
                                        id="search-products"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Search..."
                                        className="w-40 sm:w-56"
                                    />
                                    <Button variant="outline" onClick={refreshAllProducts} disabled={loading} className="h-10">
                                        <RefreshCw className={loading ? "animate-spin" : ""} />
                                        {refreshProgress ? `Refreshing ${refreshProgress.done}/${refreshProgress.total}` : "Refresh All"}
                                    </Button>
                                    <div className="flex rounded-lg border bg-card p-0.5 shadow-sm" role="group" aria-label="View mode">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant={listView ? "ghost" : "secondary"}
                                                    size="icon"
                                                    className="h-9 w-9"
                                                    aria-label="Grid view"
                                                    aria-pressed={!listView}
                                                    onClick={() => setListView(false)}
                                                >
                                                    <LayoutGrid />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Grid view</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant={listView ? "secondary" : "ghost"}
                                                    size="icon"
                                                    className="h-9 w-9"
                                                    aria-label="List view"
                                                    aria-pressed={listView}
                                                    onClick={() => setListView(true)}
                                                >
                                                    <List />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>List view</TooltipContent>
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>

                            <div className={`grid grid-cols-1 ${listView ? "gap-3" : "sm:grid-cols-2 lg:grid-cols-3 gap-5"}`}>
                                <AnimatePresence>
                                    {activeProducts.length > 0 ? (
                                        activeProducts.map((product) => (
                                            <motion.div
                                                key={product.id}
                                                onClick={() => handleProductClick(product)}
                                                className="relative"
                                            >
                                                <Card
                                                    className={`group h-full cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-foreground/20 ${product.is_refreshed ? 'ring-2 ring-brand' : ''}`}
                                                >
                                                    <CardContent className={listView ? "flex items-center gap-4 p-3" : "flex h-full flex-col p-4"}>
                                                        <div
                                                            className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ${listView ? "h-20 w-20" : "mb-4 h-48 w-full"}`}
                                                        >
                                                            {product.image ? (
                                                                // eslint-disable-next-line @next/next/no-img-element
                                                                <img
                                                                    src={product.image}
                                                                    alt={product.name}
                                                                    className="h-full w-full object-contain p-2 transition-transform duration-300 ease-out group-hover:scale-105"
                                                                />
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground">No image</span>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1 flex flex-col gap-2">
                                                            <StoreChip url={product.url} />
                                                            <h3 className={`text-sm font-medium leading-snug ${listView ? "line-clamp-1" : "line-clamp-2"}`}>
                                                                {product.name}
                                                            </h3>
                                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                                {formatPrice(product.price, productCurrency(product)) && (
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-lg font-semibold tracking-tight">
                                                                            {formatPrice(product.price, productCurrency(product))}
                                                                        </span>
                                                                        {product.savings_percentage && (
                                                                            <Badge variant="destructive">
                                                                                {product.savings_percentage}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {product.rating && (
                                                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                                        <StarRating rating={parseFloat(product.rating) || 0} />
                                                                        <span>{product.rating}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {product.url && (
                                                                <a
                                                                    href={product.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className={`inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors ${listView ? "" : "mt-auto pt-1"}`}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    Open product page
                                                                    <ExternalLink className="h-3 w-3" />
                                                                </a>
                                                            )}
                                                        </div>
                                                    </CardContent>
                                                </Card>

                                                {product.is_refreshed && (
                                                    <Badge variant="brand" className="absolute top-3 right-3 shadow-sm">
                                                        Updated
                                                    </Badge>
                                                )}
                                            </motion.div>
                                        ))
                                    ) : (
                                        <div className="col-span-full flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                                            <PackageSearch className="h-8 w-8" />
                                            <p className="text-sm">No products match your search.</p>
                                        </div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </section>
                    ) : (
                        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/50 py-16 text-center">
                            <PackageSearch className="h-10 w-10 text-muted-foreground" />
                            <div>
                                <p className="font-medium">No products yet</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Paste a product link from any online store above to start tracking it.
                                </p>
                            </div>
                        </div>
                    )}

                    <Dialog open={selectedProduct !== null} onOpenChange={closeModal}>
                        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[640px]" ref={modalRef}>
                            <DialogHeader className="space-y-2 border-b px-6 py-4 pr-12 text-left">
                                {selectedProduct?.url && <StoreChip url={selectedProduct.url} />}
                                <DialogTitle className="line-clamp-2 text-base font-semibold leading-snug">
                                    {selectedProduct?.name}
                                </DialogTitle>
                            </DialogHeader>
                            <div className="flex-1 overflow-auto px-6 py-5">
                                <div className="mb-6 flex h-52 items-center justify-center rounded-xl bg-white">
                                    {selectedProduct?.image ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={selectedProduct.image}
                                            alt={selectedProduct.name}
                                            className="h-full w-full object-contain p-3"
                                        />
                                    ) : (
                                        <span className="text-sm text-muted-foreground">No image</span>
                                    )}
                                </div>

                                {selectedProduct && (
                                    <section className="mb-6 border-b pb-6">
                                        <h3 className={`${detailLabel} mb-3`}>Price trend</h3>
                                        <PriceTrendChart
                                            productId={selectedProduct.id}
                                            refreshKey={selectedProduct.updated}
                                            formatPrice={(price) => formatPrice(price, selectedCurrency) ?? ""}
                                        />
                                    </section>
                                )}

                                <div className="divide-y">
                                    {formatPrice(selectedProduct?.price ?? null, selectedCurrency) && (
                                        <div className={detailRow}>
                                            <dt className={detailLabel}>Price</dt>
                                            <dd className={`${detailValue} flex items-center gap-2`}>
                                                <span className="text-lg font-semibold tracking-tight">
                                                    {formatPrice(selectedProduct?.price ?? null, selectedCurrency)}
                                                </span>
                                                {selectedProduct?.savings_percentage && (
                                                    <Badge variant="destructive">
                                                        {selectedProduct.savings_percentage}
                                                    </Badge>
                                                )}
                                            </dd>
                                        </div>
                                    )}

                                    {selectedProduct?.rating && (
                                        <div className={detailRow}>
                                            <dt className={detailLabel}>Rating</dt>
                                            <dd className={`${detailValue} flex flex-wrap items-center gap-2`}>
                                                <StarRating rating={parseFloat(selectedProduct.rating) || 0} />
                                                <span className="text-muted-foreground">
                                                    {selectedProduct.rating} out of 5 ({selectedProduct.total_reviews ?? 0})
                                                </span>
                                            </dd>
                                        </div>
                                    )}

                                    {selectedProduct?.description && (
                                        <div className={detailRow}>
                                            <dt className={detailLabel}>Description</dt>
                                            <dd className={detailValue}>{selectedProduct.description}</dd>
                                        </div>
                                    )}

                                    {selectedProduct?.features && selectedProduct.features.length > 0 && (
                                        <div className={detailRow}>
                                            <dt className={detailLabel}>Features</dt>
                                            <dd className={detailValue}>
                                                <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
                                                    {selectedProduct.features.map((feature, index) => (
                                                        <li key={index}>{feature}</li>
                                                    ))}
                                                </ul>
                                            </dd>
                                        </div>
                                    )}

                                    {visibleSpecs.length > 0 && (
                                        <div className={detailRow}>
                                            <dt className={detailLabel}>Specifications</dt>
                                            <dd className={detailValue}>
                                                <ul className="space-y-1">
                                                    {visibleSpecs.map(([key, value]) => (
                                                        <li key={key}>
                                                            <span className="font-medium">{key}:</span>{" "}
                                                            <span className="text-muted-foreground">{value}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </dd>
                                        </div>
                                    )}
                                </div>

                                {selectedProduct?.url && (
                                    <a
                                        href={selectedProduct.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium hover:underline underline-offset-4"
                                    >
                                        View on {storeLabel(selectedProduct.url)}
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                )}
                            </div>
                            <DialogFooter className="border-t px-6 py-4">
                                <div className="flex w-full items-center justify-between">
                                    <Button variant="outline" onClick={() => selectedProduct && refreshProduct(selectedProduct)} disabled={loading}>
                                        <RefreshCw className={loading ? "animate-spin" : ""} />
                                        Refresh
                                    </Button>
                                    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="destructive" onClick={() => selectedProduct && openDeleteDialog(selectedProduct)}>
                                                <Trash2 />
                                                Delete
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This action cannot be undone. This will permanently delete the product and its price history from your PocketBase database.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={deleteProduct}
                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                >
                                                    Yes, delete product
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
                <BrowserHelperDialog
                    open={helperDialogOpen}
                    onOpenChange={setHelperDialogOpen}
                    onVersionChange={setHelperVersion}
                />
                <DraggableModal
                    isOpen={isUrlModalOpen}
                    onClose={() => setIsUrlModalOpen(false)}
                    initialUrl={AMAZON_HOMEPAGE}
                />
            </div>
        </TooltipProvider>
    )
}
