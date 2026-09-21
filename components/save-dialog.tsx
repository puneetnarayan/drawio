"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useDictionary } from "@/hooks/use-dictionary"
import { isGoogleDriveConfigured } from "@/lib/cloud-storage/google-drive"
import { isOneDriveConfigured } from "@/lib/cloud-storage/onedrive"
import {
    isGitHubSaveConfigComplete,
    type SaveDestination,
} from "@/lib/cloud-storage/types"
import { STORAGE_KEYS } from "@/lib/storage"

export type ExportFormat = "drawio" | "png" | "svg" | "xmlsvg"

interface SaveDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSave: (
        filename: string,
        format: ExportFormat,
        destination: SaveDestination,
    ) => void
    defaultFilename: string
    onOpenSettings?: () => void
}

export function SaveDialog({
    open,
    onOpenChange,
    onSave,
    defaultFilename,
    onOpenSettings,
}: SaveDialogProps) {
    const dict = useDictionary()
    const [filename, setFilename] = useState(defaultFilename)
    const [format, setFormat] = useState<ExportFormat>("drawio")
    const [destination, setDestination] = useState<SaveDestination>("device")
    const [isGitHubConfigured, setIsGitHubConfigured] = useState(false)

    useEffect(() => {
        if (open) {
            setFilename(defaultFilename)
            const raw = localStorage.getItem(STORAGE_KEYS.githubSaveConfig)
            setIsGitHubConfigured(
                isGitHubSaveConfigComplete(raw ? JSON.parse(raw) : null),
            )
            const lastDestination = localStorage.getItem(
                STORAGE_KEYS.lastSaveDestination,
            ) as SaveDestination | null
            setDestination(lastDestination || "device")
        }
    }, [open, defaultFilename])

    const DESTINATION_OPTIONS: {
        value: SaveDestination
        label: string
        available: boolean
    }[] = [
        {
            value: "device",
            label: dict.save.destinations.device,
            available: true,
        },
        {
            value: "google-drive",
            label: dict.save.destinations.googleDrive,
            available: isGoogleDriveConfigured(),
        },
        {
            value: "onedrive",
            label: dict.save.destinations.oneDrive,
            available: isOneDriveConfigured(),
        },
        {
            value: "github",
            label: dict.save.destinations.github,
            available: isGitHubConfigured,
        },
    ]
    const currentDestination = DESTINATION_OPTIONS.find(
        (d) => d.value === destination,
    )

    const handleSave = () => {
        const finalFilename = filename.trim() || defaultFilename
        localStorage.setItem(STORAGE_KEYS.lastSaveDestination, destination)
        onSave(finalFilename, format, destination)
        onOpenChange(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            handleSave()
        }
    }

    const FORMAT_OPTIONS = [
        {
            value: "drawio" as const,
            label: dict.save.formats.drawio,
            extension: ".drawio",
        },
        {
            value: "png" as const,
            label: dict.save.formats.png,
            extension: ".png",
        },
        {
            value: "svg" as const,
            label: dict.save.formats.svg,
            extension: ".svg",
        },
        {
            value: "xmlsvg" as const,
            label: dict.save.formats.xmlsvg,
            extension: ".drawio.svg",
        },
    ]

    const currentFormat = FORMAT_OPTIONS.find((f) => f.value === format)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{dict.save.title}</DialogTitle>
                    <DialogDescription>
                        {dict.save.description}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">
                            {dict.save.destination}
                        </label>
                        <Select
                            value={destination}
                            onValueChange={(v) =>
                                setDestination(v as SaveDestination)
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DESTINATION_OPTIONS.map((opt) => (
                                    <SelectItem
                                        key={opt.value}
                                        value={opt.value}
                                    >
                                        {opt.label}
                                        {!opt.available &&
                                            ` (${dict.save.notConfigured})`}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {currentDestination &&
                            !currentDestination.available && (
                                <p className="text-xs text-muted-foreground">
                                    {dict.save.configureInSettings}
                                    {onOpenSettings && (
                                        <button
                                            type="button"
                                            className="ml-1 underline underline-offset-2 hover:text-foreground"
                                            onClick={() => {
                                                onOpenChange(false)
                                                onOpenSettings()
                                            }}
                                        >
                                            {dict.settings.title}
                                        </button>
                                    )}
                                </p>
                            )}
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">
                            {dict.save.format}
                        </label>
                        <Select
                            value={format}
                            onValueChange={(v) => setFormat(v as ExportFormat)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {FORMAT_OPTIONS.map((opt) => (
                                    <SelectItem
                                        key={opt.value}
                                        value={opt.value}
                                    >
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">
                            {dict.save.filename}
                        </label>
                        <div className="flex items-stretch">
                            <Input
                                value={filename}
                                onChange={(e) => setFilename(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={dict.save.filenamePlaceholder}
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                className="rounded-r-none border-r-0 focus-visible:z-10"
                            />
                            <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-input bg-muted text-sm text-muted-foreground font-mono">
                                {currentFormat?.extension || ".drawio"}
                            </span>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {dict.common.cancel}
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!currentDestination?.available}
                    >
                        {dict.common.save}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
