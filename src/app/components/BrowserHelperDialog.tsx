'use client'

import { useEffect, useState } from "react"
import { CheckCircle2, Copy, Download, Loader2, Puzzle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EXTENSION_DOWNLOAD_URL, getExtensionVersion } from "@/lib/extension-bridge"

interface BrowserHelperDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Called whenever a check finds the extension's version (or lack of it). */
    onVersionChange: (version: string | null) => void
}

const EXTENSIONS_PAGE = "chrome://extensions"

function Step({ n, children }: { n: number; children: React.ReactNode }) {
    return (
        <li className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {n}
            </span>
            <div className="min-w-0 flex-1 space-y-2 text-sm">{children}</div>
        </li>
    )
}

export default function BrowserHelperDialog({ open, onOpenChange, onVersionChange }: BrowserHelperDialogProps) {
    const [version, setVersion] = useState<string | null>(null)
    // The dialog body only renders after the user opens it, i.e. always in the browser.
    const [isChromium] = useState(() => typeof navigator === "undefined" || /Chrome|Chromium|Edg\//.test(navigator.userAgent))

    // While the dialog is open, keep checking so the status flips as soon as the extension appears.
    useEffect(() => {
        if (!open) return
        const check = () => {
            const found = getExtensionVersion()
            setVersion(found)
            onVersionChange(found)
        }
        const first = window.setTimeout(check, 0)
        const timer = window.setInterval(check, 1500)
        return () => {
            window.clearTimeout(first)
            window.clearInterval(timer)
        }
    }, [open, onVersionChange])

    const installed = version !== null

    const copyExtensionsUrl = async () => {
        try {
            await navigator.clipboard.writeText(EXTENSIONS_PAGE)
            toast.success("Copied. Paste it into a new tab's address bar.")
        } catch {
            toast.error(`Couldn't copy. Type ${EXTENSIONS_PAGE} into a new tab.`)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
                <DialogHeader className="space-y-1.5 border-b px-6 py-4 pr-12 text-left">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Puzzle className="h-4 w-4 text-brand" />
                        Browser helper <span className="text-sm font-normal text-muted-foreground">(optional)</span>
                    </DialogTitle>
                    <DialogDescription>
                        Some stores, like Amazon, block this app&apos;s server. With the helper installed, those pages are
                        fetched through <strong>your own browser</strong> instead. Everything else works without it.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 px-6 py-5">
                    {installed ? (
                        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                            <div className="text-sm">
                                <p className="font-medium text-success">Installed and working (v{version})</p>
                                <p className="mt-1 text-muted-foreground">
                                    Blocked scrapes now retry through your browser automatically. Nothing else to do.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 rounded-xl border bg-muted/50 p-4 text-sm">
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                            <p className="text-muted-foreground">Not detected yet. This updates by itself once it&apos;s installed.</p>
                        </div>
                    )}

                    {!isChromium && !installed && (
                        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                            This extension needs a Chromium browser (Chrome, Edge, Brave or Arc). It can&apos;t be installed in this browser.
                        </p>
                    )}

                    <ol className={`space-y-4 ${installed ? "opacity-60" : ""}`}>
                        <Step n={1}>
                            <p>Download the extension. It&apos;s set up for this website, so you don&apos;t need to edit anything.</p>
                            <Button asChild size="sm" variant={installed ? "outline" : "brand"}>
                                <a href={EXTENSION_DOWNLOAD_URL} download>
                                    <Download />
                                    Download web-scraper-helper.zip
                                </a>
                            </Button>
                        </Step>
                        <Step n={2}>
                            <p>
                                Unzip it and keep the <code className="rounded bg-muted px-1 py-0.5 text-xs">web-scraper-helper</code> folder
                                somewhere permanent. Chrome loads the extension from that folder, so don&apos;t delete it.
                            </p>
                        </Step>
                        <Step n={3}>
                            <p>
                                Open <code className="rounded bg-muted px-1 py-0.5 text-xs">{EXTENSIONS_PAGE}</code> in a new tab and turn on{" "}
                                <strong>Developer mode</strong>{" "}(top right). Browsers don&apos;t allow websites to link there, so copy the address:
                            </p>
                            <Button type="button" size="sm" variant="outline" onClick={copyExtensionsUrl}>
                                <Copy />
                                Copy {EXTENSIONS_PAGE}
                            </Button>
                        </Step>
                        <Step n={4}>
                            <p>
                                Click <strong>Load unpacked</strong> and choose the unzipped <code className="rounded bg-muted px-1 py-0.5 text-xs">web-scraper-helper</code> folder.
                            </p>
                        </Step>
                        <Step n={5}>
                            <p>Come back to this tab. The status above turns green when it&apos;s working.</p>
                        </Step>
                    </ol>

                    <div className="space-y-2 rounded-xl border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
                        <p className="font-medium text-foreground">What you&apos;re allowing</p>
                        <p>
                            Chrome will say the extension can &quot;read and change data on all websites&quot;. It needs that because it can&apos;t know which
                            store you&apos;ll add next. It only acts when this app asks it to fetch a product page, and it won&apos;t respond to any
                            other website. It also refuses local and private network addresses.
                        </p>
                        <p>
                            Chrome may show a &quot;disable developer mode extensions&quot; notice at startup. You can dismiss it. Remove the extension
                            any time from {EXTENSIONS_PAGE}.
                        </p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
