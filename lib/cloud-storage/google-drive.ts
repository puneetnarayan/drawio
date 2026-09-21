// Uploads a file to the signed-in user's Google Drive using Google Identity
// Services (GIS) for a client-side-only OAuth token, then the Drive v3 REST
// API for the upload. No server round-trip and no refresh-token storage:
// the user re-consents (usually silently, via the account picker) on each
// save. Requires NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID to be configured with an
// OAuth 2.0 Web client ID from Google Cloud Console (APIs & Services >
// Credentials), with this app's origin allowed under "Authorized JavaScript
// origins". Verify current setup steps against Google's docs, since OAuth
// consent-screen requirements change over time.

declare global {
    interface Window {
        google?: {
            accounts: {
                oauth2: {
                    initTokenClient: (config: {
                        client_id: string
                        scope: string
                        callback: (response: {
                            access_token?: string
                            error?: string
                        }) => void
                    }) => { requestAccessToken: () => void }
                }
            }
        }
    }
}

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client"
const DRIVE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/drive.file"

let gisScriptPromise: Promise<void> | null = null

function loadGisScript(): Promise<void> {
    if (typeof window === "undefined") {
        return Promise.reject(
            new Error("Google Drive save is only available in the browser"),
        )
    }
    if (window.google?.accounts?.oauth2) {
        return Promise.resolve()
    }
    if (gisScriptPromise) {
        return gisScriptPromise
    }
    gisScriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(
            `script[src="${GIS_SCRIPT_SRC}"]`,
        )
        if (existing) {
            existing.addEventListener("load", () => resolve())
            existing.addEventListener("error", () =>
                reject(new Error("Failed to load Google Identity Services")),
            )
            return
        }
        const script = document.createElement("script")
        script.src = GIS_SCRIPT_SRC
        script.async = true
        script.onload = () => resolve()
        script.onerror = () =>
            reject(new Error("Failed to load Google Identity Services"))
        document.head.appendChild(script)
    })
    return gisScriptPromise
}

function requestAccessToken(clientId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) {
            reject(new Error("Google Identity Services failed to initialize"))
            return
        }
        const client = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: DRIVE_UPLOAD_SCOPE,
            callback: (response) => {
                if (response.error || !response.access_token) {
                    reject(
                        new Error(
                            response.error || "Google sign-in was cancelled",
                        ),
                    )
                    return
                }
                resolve(response.access_token)
            },
        })
        client.requestAccessToken()
    })
}

export function isGoogleDriveConfigured(): boolean {
    return Boolean(process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID)
}

export async function uploadToGoogleDrive(
    filename: string,
    content: Blob,
): Promise<void> {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID
    if (!clientId) {
        throw new Error(
            "Google Drive is not configured. Set NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID.",
        )
    }

    await loadGisScript()
    const accessToken = await requestAccessToken(clientId)

    const metadata = { name: filename }
    const form = new FormData()
    form.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    )
    form.append("file", content, filename)

    const response = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form,
        },
    )

    if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(
            error?.error?.message ||
                `Google Drive upload failed (${response.status})`,
        )
    }
}
