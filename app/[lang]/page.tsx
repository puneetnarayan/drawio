"use client"
import { usePathname, useRouter } from "next/navigation"
import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { DrawIoEmbed } from "react-drawio"
import type { ImperativePanelHandle } from "react-resizable-panels"
import ChatPanel from "@/components/chat-panel"
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Switch } from "@/components/ui/switch"
import { useDiagram } from "@/contexts/diagram-context"
import useDictionary from "@/hooks/use-dictionary"
import { type DrawioTheme, isDrawioTheme } from "@/lib/drawio-themes"
import { i18n, type Locale } from "@/lib/i18n/config"
import { STORAGE_KEYS } from "@/lib/storage"

export default function Home() {
    const {
        drawioRef,
        handleDiagramExport,
        handleDiagramAutoSave,
        onDrawioLoad,
        resetDrawioReady,
    } = useDiagram()
    const router = useRouter()
    const pathname = usePathname()
    const dict = useDictionary()
    // Extract current language from pathname (e.g., "/zh/about" → "zh")
    const currentLang = (pathname.split("/")[1] || i18n.defaultLocale) as Locale
    const [isMobile, setIsMobile] = useState(false)
    const [isChatVisible, setIsChatVisible] = useState(true)
    // AI Assistant mode. Defaults to OFF: the editor must work as a normal
    // draw.io canvas with no AI calls until the user explicitly opts in.
    const [aiEnabled, setAiEnabled] = useState(false)
    const [drawioUi, setDrawioUi] = useState<DrawioTheme>("kennedy")
    const [darkMode, setDarkMode] = useState(false)
    const [isLoaded, setIsLoaded] = useState(false)
    const [isDrawioReady, setIsDrawioReady] = useState(false)
    const [isElectron, setIsElectron] = useState(false)
    const [drawioBaseUrl, setDrawioBaseUrl] = useState(
        process.env.NEXT_PUBLIC_DRAWIO_BASE_URL || "https://embed.diagrams.net",
    )

    const chatPanelRef = useRef<ImperativePanelHandle>(null)
    const isMobileRef = useRef(false)

    // Load preferences from localStorage after mount
    useEffect(() => {
        // Restore saved locale and redirect if needed
        const savedLocale = localStorage.getItem("next-ai-draw-io-locale")
        if (savedLocale && i18n.locales.includes(savedLocale as Locale)) {
            const pathParts = pathname.split("/").filter(Boolean)
            const currentLocale = pathParts[0]
            if (currentLocale !== savedLocale) {
                pathParts[0] = savedLocale
                router.replace(`/${pathParts.join("/")}`)
                return // Wait for redirect
            }
        }

        const savedUi = localStorage.getItem("drawio-theme")
        if (isDrawioTheme(savedUi)) {
            setDrawioUi(savedUi)
        }

        const savedAiEnabled = localStorage.getItem(STORAGE_KEYS.aiEnabled)
        if (savedAiEnabled !== null) {
            setAiEnabled(savedAiEnabled === "true")
        }

        const savedDarkMode = localStorage.getItem("next-ai-draw-io-dark-mode")
        if (savedDarkMode !== null) {
            const isDark = savedDarkMode === "true"
            setDarkMode(isDark)
            document.documentElement.classList.toggle("dark", isDark)
        } else {
            const prefersDark = window.matchMedia(
                "(prefers-color-scheme: dark)",
            ).matches
            setDarkMode(prefersDark)
            document.documentElement.classList.toggle("dark", prefersDark)
        }

        // Detect Electron and use bundled draw.io files for offline use
        // Note: react-drawio uses `new URL(baseUrl)` so we need absolute URL
        // Include /index.html because Next.js doesn't auto-serve index.html for directories
        const electronDetected =
            !process.env.NEXT_PUBLIC_DRAWIO_BASE_URL &&
            !!(window as unknown as { electronAPI?: unknown }).electronAPI
        if (electronDetected) {
            setIsElectron(true)
            setDrawioBaseUrl(`${window.location.origin}/drawio/index.html`)
        }

        setIsLoaded(true)
    }, [pathname, router])

    const handleDrawioLoad = useCallback(() => {
        setIsDrawioReady(true)
        onDrawioLoad()
    }, [onDrawioLoad])

    const handleDarkModeChange = () => {
        const newValue = !darkMode
        setDarkMode(newValue)
        localStorage.setItem("next-ai-draw-io-dark-mode", String(newValue))
        document.documentElement.classList.toggle("dark", newValue)
        setIsDrawioReady(false)
        resetDrawioReady()
    }

    const handleDrawioUiChange = (theme: DrawioTheme) => {
        localStorage.setItem("drawio-theme", theme)
        setDrawioUi(theme)
        setIsDrawioReady(false)
        resetDrawioReady()
    }

    // Check mobile - reset draw.io before crossing breakpoint
    const isInitialRenderRef = useRef(true)
    useEffect(() => {
        const checkMobile = () => {
            const newIsMobile = window.innerWidth < 768
            if (
                !isInitialRenderRef.current &&
                newIsMobile !== isMobileRef.current
            ) {
                setIsDrawioReady(false)
                resetDrawioReady()
            }
            isMobileRef.current = newIsMobile
            isInitialRenderRef.current = false
            setIsMobile(newIsMobile)
        }

        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [resetDrawioReady])

    const toggleChatPanel = () => {
        if (!aiEnabled) return
        const panel = chatPanelRef.current
        if (panel) {
            if (panel.isCollapsed()) {
                panel.expand()
                setIsChatVisible(true)
            } else {
                panel.collapse()
                setIsChatVisible(false)
            }
        }
    }

    const handleAiEnabledChange = (enabled: boolean) => {
        setAiEnabled(enabled)
        localStorage.setItem(STORAGE_KEYS.aiEnabled, String(enabled))
    }

    // Keep the AI panel's collapsed state in sync with the AI mode switch.
    // Turning AI off fully hides the panel (canvas takes the full width);
    // turning it on restores the panel without touching the drawio canvas,
    // so the current diagram is never reloaded or lost.
    useEffect(() => {
        const panel = chatPanelRef.current
        if (!panel) return
        if (aiEnabled) {
            if (panel.isCollapsed()) {
                panel.expand()
            }
            setIsChatVisible(true)
        } else {
            if (!panel.isCollapsed()) {
                panel.collapse()
            }
            setIsChatVisible(false)
        }
    }, [aiEnabled])

    // Keyboard shortcut for toggling chat panel
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "b") {
                event.preventDefault()
                toggleChatPanel()
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [])

    return (
        <div className="h-screen bg-background relative overflow-hidden flex flex-col">
            {/* Header: app title + AI mode switch. Visible at all times so the
                user can always tell, and change, whether AI is active. */}
            <header className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-border/30 shrink-0">
                <span className="text-sm font-semibold text-foreground">
                    next-ai-draw-io
                </span>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-xs font-medium text-muted-foreground">
                        {dict.aiMode.label}:{" "}
                        <span
                            className={
                                aiEnabled
                                    ? "text-primary font-semibold"
                                    : "font-semibold"
                            }
                        >
                            {aiEnabled ? dict.aiMode.on : dict.aiMode.off}
                        </span>
                    </span>
                    <Switch
                        id="ai-mode-switch"
                        checked={aiEnabled}
                        onCheckedChange={handleAiEnabledChange}
                        aria-label={
                            aiEnabled
                                ? dict.aiMode.toggleOff
                                : dict.aiMode.toggleOn
                        }
                    />
                </label>
            </header>
            <ResizablePanelGroup
                id="main-panel-group"
                direction={isMobile ? "vertical" : "horizontal"}
                className="flex-1 min-h-0"
            >
                <ResizablePanel
                    id="drawio-panel"
                    defaultSize={isMobile ? 50 : 67}
                    minSize={20}
                >
                    <div
                        className={`h-full relative ${
                            isMobile ? "p-1" : "p-2"
                        }`}
                    >
                        <div className="h-full rounded-xl overflow-hidden shadow-soft-lg border border-border/30 relative">
                            {isLoaded && (
                                <div
                                    className={`h-full w-full ${isDrawioReady ? "" : "invisible absolute inset-0"}`}
                                >
                                    <DrawIoEmbed
                                        key={`${drawioUi}-${darkMode}-${currentLang}-${isElectron}`}
                                        ref={drawioRef}
                                        autosave
                                        onAutoSave={handleDiagramAutoSave}
                                        onExport={handleDiagramExport}
                                        onLoad={handleDrawioLoad}
                                        baseUrl={drawioBaseUrl}
                                        urlParameters={{
                                            ui: drawioUi,
                                            spin: false,
                                            libraries: false,
                                            saveAndExit: false,
                                            noSaveBtn: true,
                                            noExitBtn: true,
                                            dark:
                                                darkMode || drawioUi === "dark",
                                            lang: currentLang,
                                            // Enable offline mode in Electron to disable external service calls
                                            ...(isElectron && {
                                                offline: true,
                                            }),
                                        }}
                                    />
                                </div>
                            )}
                            {(!isLoaded || !isDrawioReady) && (
                                <div className="h-full w-full bg-background flex items-center justify-center">
                                    <span className="text-muted-foreground">
                                        Draw.io panel is loading...
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </ResizablePanel>

                <ResizableHandle
                    withHandle={aiEnabled}
                    disabled={!aiEnabled}
                    className={
                        aiEnabled ? undefined : "w-0 pointer-events-none"
                    }
                />

                {/* AI Assistant Panel — fully collapsed and unmounted when AI
                    mode is off, so the canvas gets the full width and no AI
                    code runs or calls out. */}
                <ResizablePanel
                    key={isMobile ? "mobile" : "desktop"}
                    id="chat-panel"
                    ref={chatPanelRef}
                    defaultSize={aiEnabled ? (isMobile ? 50 : 33) : 0}
                    minSize={isMobile ? 20 : 15}
                    maxSize={isMobile ? 80 : 50}
                    collapsible
                    collapsedSize={!aiEnabled ? 0 : isMobile ? 0 : 3}
                    onCollapse={() => setIsChatVisible(false)}
                    onExpand={() => setIsChatVisible(true)}
                >
                    {aiEnabled && (
                        <div
                            className={`h-full ${isMobile ? "p-1" : "py-2 pr-2"}`}
                        >
                            <Suspense
                                fallback={
                                    <div className="h-full bg-card rounded-xl border border-border/30 flex items-center justify-center text-muted-foreground">
                                        Loading chat...
                                    </div>
                                }
                            >
                                <ChatPanel
                                    isVisible={isChatVisible}
                                    onToggleVisibility={toggleChatPanel}
                                    drawioUi={drawioUi}
                                    onDrawioUiChange={handleDrawioUiChange}
                                    darkMode={darkMode}
                                    onToggleDarkMode={handleDarkModeChange}
                                    isMobile={isMobile}
                                />
                            </Suspense>
                        </div>
                    )}
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    )
}
