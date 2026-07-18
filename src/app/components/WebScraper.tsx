'use client'

import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent } from "react"
import { toast } from "sonner"
import { Search, Trash2, RefreshCw, Link as LinkIcon } from "lucide-react"
import StarRating from "./StarRating"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { motion, AnimatePresence } from "framer-motion"
import { ListBulletIcon } from "@radix-ui/react-icons"
import Amazon from '../../public/amazon.svg'
import Image from "next/image"
import DraggableModal from "./DraggableModal"
import { pb, PRODUCTS_COLLECTION, type ProductRecord } from "@/lib/pocketbase"

const AMAZON_HOMEPAGE = "https://www.amazon.com.au/"

function formatPrice(price: number | null) {
    if (price == null) return null
    return `$${price.toFixed(2)}`
}

export default function WebScraper() {
    const [url, setUrl] = useState("")
    const [products, setProducts] = useState<ProductRecord[]>([])
    const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null)
    const [productToDelete, setProductToDelete] = useState<ProductRecord | null>(null)
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(false)
    const [initialLoading, setInitialLoading] = useState(true)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [listView, setListView] = useState(false)
    const [isUrlModalOpen, setIsUrlModalOpen] = useState(false)
    const modalRef = useRef<HTMLDivElement>(null)

    const closeModal = useCallback(() => setSelectedProduct(null), [])

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

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            const response = await fetch("/api/scrape", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url })
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data.error || "Failed to scrape the website")
            }

            setUrl("")
            toast.success("Product scraped successfully")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "An error occurred while scraping the website")
        } finally {
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
        try {
            const response = await fetch("/api/scrape", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: product.url })
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data.error || "Failed to refresh the product")
            }

            const { product: refreshed } = await response.json()
            setSelectedProduct(refreshed)
            toast.success("Product refreshed")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "An error occurred while refreshing the product")
        } finally {
            setLoading(false)
        }
    }

    const refreshAllProducts = async () => {
        if (products.length === 0) return
        setLoading(true)

        const concurrentFetches = 5
        const queue = [...products]
        let succeeded = 0
        let failed = 0

        const worker = async () => {
            while (queue.length > 0) {
                const product = queue.shift()
                if (!product) break
                try {
                    const response = await fetch("/api/scrape", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url: product.url }),
                    })
                    if (!response.ok) throw new Error()
                    succeeded += 1
                } catch {
                    failed += 1
                }
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(concurrentFetches, products.length) }, worker)
        )

        setLoading(false)
        if (failed === 0) {
            toast.success(`Refreshed ${succeeded} product${succeeded === 1 ? '' : 's'}`)
        } else {
            toast.warning(`Refreshed ${succeeded} product${succeeded === 1 ? '' : 's'}, ${failed} failed`)
        }
    }

    return (
        <TooltipProvider>
            <div className="min-h-screen bg-gray-100 p-4 sm:px-6 lg:px-8">
                <div className="max-w-6xl mx-auto">
                    <div className="flex items-center w-full justify-center mb-6">
                        <Image
                            src={Amazon}
                            alt={'Amazon'}
                            className="h-10 w-auto mt-3 mr-3"
                        />
                        <h1 className="text-2xl font-bold text-gray-900">
                            Web Scraper
                        </h1>
                    </div>
                    <form onSubmit={handleSubmit} className="mb-6">
                        <Label htmlFor="scrape-url" className="sr-only">Amazon product URL</Label>
                        <div className="flex items-center bg-white rounded-md border border-gray-300">
                            <Input
                                id="scrape-url"
                                type="url"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="Enter a URL to scrape..."
                                required
                                disabled={loading}
                                className="border-none shadow-none focus-visible:ring-0"
                            />
                            <div className="flex">
                                <Button type="submit" disabled={loading} className="rounded-r-none">
                                    <Search className="h-4 w-4" />
                                    {loading ? "Scraping..." : "Scrape"}
                                </Button>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            onClick={() => setIsUrlModalOpen(!isUrlModalOpen)}
                                            className="rounded-r-md rounded-l-none bg-gray-700 p-1"
                                        >
                                            <LinkIcon className={`h-4 w-4 ${isUrlModalOpen && "text-blue-300"}`} />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Open Amazon Browser</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                    </form>

                    {initialLoading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Card key={i} className="p-4">
                                    <Skeleton className="h-48 w-full mb-4" />
                                    <Skeleton className="h-5 w-3/4 mb-2" />
                                    <Skeleton className="h-4 w-1/2" />
                                </Card>
                            ))}
                        </div>
                    ) : products.length > 0 && (
                        <Card className="overflow-hidden">
                            <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
                                <h2 className="text-lg leading-6 font-medium text-gray-900">
                                    Scraped Products
                                </h2>
                            </div>
                            <div className="px-4 py-5 sm:px-6 justify-between items-center flex flex-wrap gap-3">
                                <Label htmlFor="search-products" className="sr-only">Search products</Label>
                                <Input
                                    id="search-products"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search..."
                                    className="bg-white rounded-full w-40 sm:max-w-64"
                                />
                                <div className="flex flex-wrap gap-1">
                                    <Button onClick={refreshAllProducts} disabled={loading}>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Refresh All
                                    </Button>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button onClick={() => setListView(!listView)}>
                                                <ListBulletIcon className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Toggle list view</TooltipContent>
                                    </Tooltip>
                                </div>
                            </div>

                            <Separator />

                            <div className={`grid grid-cols-1 ${listView ? "p-2 gap-2" : "sm:grid-cols-2 lg:grid-cols-3 p-4 gap-6"}`}>
                                <AnimatePresence>
                                    {activeProducts.length > 0 ? (
                                        activeProducts.map((product) => (
                                            <motion.div
                                                key={product.id}
                                                onClick={() => handleProductClick(product)}
                                                className="relative"
                                            >
                                                <Card
                                                    className={`group cursor-pointer transition-all duration-300 ease-in-out transform hover:-translate-y-1 hover:shadow-lg ${product.is_refreshed ? 'ring-2 ring-blue-500' : ''} ${listView ? "w-full flex flex-row items-center p-2 gap-2" : ""}`}
                                                >
                                                    <CardContent className={listView ? "flex items-center gap-3 p-0" : "p-4"}>
                                                        <div className={`flex mb-4 rounded-lg ${listView ? "mb-0" : "justify-center"}`}>
                                                            {product.image ? (
                                                                <div className={`${listView ? "h-14 w-14" : "h-48"} overflow-hidden`}>
                                                                    <img
                                                                        src={product.image}
                                                                        alt={product.name}
                                                                        className="w-full h-full object-contain transition-transform duration-300 ease-in-out transform group-hover:scale-110"
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <div className="bg-gray-200 h-48 w-full flex items-center justify-center text-gray-500">
                                                                    No Image
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className={listView ? "w-full" : ""}>
                                                            <h3 className={`text-lg font-semibold text-gray-800 mb-2 ${listView ? "w-fit line-clamp-1" : "line-clamp-2"}`}>
                                                                {product.name}
                                                            </h3>
                                                            <div className={listView ? "flex gap-3 items-center" : ""}>
                                                                {formatPrice(product.price) && (
                                                                    <p className="text-gray-700 mb-2 font-bold truncate">
                                                                        {!listView && "Price "}
                                                                        <span className="font-medium text-gray-900">
                                                                            {product.savings_percentage && (
                                                                                <Badge variant="destructive" className="mr-1">
                                                                                    {product.savings_percentage}
                                                                                </Badge>
                                                                            )}
                                                                            {formatPrice(product.price)}
                                                                        </span>
                                                                    </p>
                                                                )}

                                                                {product.rating && (
                                                                    <p className="flex gap-2 text-gray-700 mb-2 font-bold">
                                                                        {!listView && "Rating "}
                                                                        <StarRating rating={parseFloat(product.rating) || 0} />
                                                                    </p>
                                                                )}
                                                            </div>

                                                            {product.url && (
                                                                <a
                                                                    href={product.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className={`text-blue-600 hover:text-blue-500 w-fit h-fit block ${listView ? "text-xs sm:text-sm" : ""}`}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    View Product
                                                                </a>
                                                            )}
                                                        </div>
                                                    </CardContent>
                                                </Card>

                                                {product.is_refreshed && (
                                                    <Badge className="absolute top-2 right-2 bg-blue-500 hover:bg-blue-500">
                                                        Updated
                                                    </Badge>
                                                )}
                                            </motion.div>
                                        ))
                                    ) : (
                                        <div className="col-span-full text-center text-gray-500 py-8">
                                            No products found.
                                        </div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </Card>
                    )}

                    <Dialog open={selectedProduct !== null} onOpenChange={closeModal}>
                        <DialogContent className="sm:max-w-[625px] h-full sm:max-h-[95vh]" ref={modalRef}>
                            <DialogHeader>
                                <DialogTitle>{selectedProduct?.name}</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4 max-h-[80vh] overflow-auto">
                                <div className="flex justify-center mb-4">
                                    {selectedProduct?.image ? (
                                        <img
                                            src={selectedProduct.image}
                                            alt={selectedProduct.name}
                                            className="w-full max-w-xs object-contain h-48"
                                        />
                                    ) : (
                                        <div className="bg-gray-200 h-48 w-full flex items-center justify-center text-gray-500">
                                            No Image
                                        </div>
                                    )}
                                </div>

                                {formatPrice(selectedProduct?.price ?? null) && (
                                    <p className="text-sm text-gray-700 font-bold px-4 py-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                                        Price:{" "}
                                        <span className="font-medium text-gray-900">
                                            {selectedProduct?.savings_percentage && (
                                                <Badge variant="destructive" className="mr-1">
                                                    {selectedProduct.savings_percentage}
                                                </Badge>
                                            )}
                                            {formatPrice(selectedProduct?.price ?? null)}
                                        </span>
                                    </p>
                                )}

                                {selectedProduct?.rating && (
                                    <div className="bg-white px-4 py-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                                        <dt className="text-sm font-bold text-gray-500">Rating</dt>
                                        <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                                            <StarRating rating={parseFloat(selectedProduct.rating) || 0} />
                                            <span className="ml-2 text-gray-600">
                                                {selectedProduct.rating} out of 5 stars ({selectedProduct.total_reviews ?? 0})
                                            </span>
                                        </dd>
                                    </div>
                                )}

                                {selectedProduct?.description && (
                                    <div className="bg-white px-4 py-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                                        <dt className="text-sm font-bold text-gray-500">Description</dt>
                                        <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{selectedProduct.description}</dd>
                                    </div>
                                )}

                                {selectedProduct?.features && selectedProduct.features.length > 0 && (
                                    <div className="bg-white px-4 py-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                                        <dt className="text-sm font-bold text-gray-500">Features</dt>
                                        <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                                            <ul className="list-disc pl-5">
                                                {selectedProduct.features.map((feature, index) => (
                                                    <li key={index}>{feature}</li>
                                                ))}
                                            </ul>
                                        </dd>
                                    </div>
                                )}

                                {selectedProduct?.specifications && Object.keys(selectedProduct.specifications).length > 0 && (
                                    <div className="bg-white px-4 py-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                                        <dt className="text-sm font-bold text-gray-500">Specifications</dt>
                                        <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                                            <ul className="list-disc pl-5">
                                                {Object.entries(selectedProduct.specifications).map(([key, value]) => (
                                                    <li key={key}>
                                                        <strong>{key}:</strong> {value}
                                                    </li>
                                                ))}
                                            </ul>
                                        </dd>
                                    </div>
                                )}

                                {selectedProduct?.url && (
                                    <a
                                        href={selectedProduct.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-500 block mb-4"
                                    >
                                        View Product on Amazon
                                    </a>
                                )}
                            </div>
                            <DialogFooter>
                                <div className="flex justify-between w-full items-end">
                                    <Button onClick={() => selectedProduct && refreshProduct(selectedProduct)} disabled={loading}>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        Refresh
                                    </Button>
                                    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="destructive" onClick={() => selectedProduct && openDeleteDialog(selectedProduct)}>
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                Delete Product
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This action cannot be undone. This will permanently delete the product from your PocketBase database.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={deleteProduct}>
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
                <DraggableModal
                    isOpen={isUrlModalOpen}
                    onClose={() => setIsUrlModalOpen(false)}
                    initialUrl={AMAZON_HOMEPAGE}
                />
            </div>
        </TooltipProvider>
    )
}
