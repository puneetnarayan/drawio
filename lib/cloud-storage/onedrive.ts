// Uploads a file to the signed-in user's OneDrive via Microsoft Graph.
// Uses the official @azure/msal-browser SDK (rather than a hand-rolled
// implicit-flow redirect, which Microsoft has been deprecating for SPAs) to
// get a short-lived access token via a popup, with no server round-trip and
// no refresh-token persistence. Requires NEXT_PUBLIC_ONEDRIVE_CLIENT_ID to be
// configured from an app registration in the Azure Portal (Entra ID > App
// registrations), as a "Single-page application" platform with this app's
// origin as a redirect URI, and the delegated Graph permission
// "Files.ReadWrite". Verify current setup steps against Microsoft's docs,
// since Entra app-registration requirements change over time.

import type { AccountInfo, PublicClientApplication } from "@azure/msal-browser"

const GRAPH_SCOPES = ["Files.ReadWrite"]

let msalInstancePromise: Promise<PublicClientApplication> | null = null

async function getMsalInstance(
    clientId: string,
): Promise<PublicClientApplication> {
    if (!msalInstancePromise) {
        msalInstancePromise = (async () => {
            const { PublicClientApplication } = await import(
                "@azure/msal-browser"
            )
            const instance = new PublicClientApplication({
                auth: {
                    clientId,
                    authority: "https://login.microsoftonline.com/common",
                    redirectUri: window.location.origin,
                },
                cache: { cacheLocation: "sessionStorage" },
            })
            await instance.initialize()
            return instance
        })()
    }
    return msalInstancePromise
}

async function acquireAccessToken(clientId: string): Promise<string> {
    const msal = await getMsalInstance(clientId)

    let account: AccountInfo | undefined = msal.getAllAccounts()[0]
    if (!account) {
        const loginResult = await msal.loginPopup({ scopes: GRAPH_SCOPES })
        account = loginResult.account ?? undefined
    }
    if (!account) {
        throw new Error("Microsoft sign-in did not return an account")
    }

    try {
        const result = await msal.acquireTokenSilent({
            scopes: GRAPH_SCOPES,
            account,
        })
        return result.accessToken
    } catch {
        const result = await msal.acquireTokenPopup({
            scopes: GRAPH_SCOPES,
            account,
        })
        return result.accessToken
    }
}

export function isOneDriveConfigured(): boolean {
    return Boolean(process.env.NEXT_PUBLIC_ONEDRIVE_CLIENT_ID)
}

export async function uploadToOneDrive(
    filename: string,
    content: Blob,
    mimeType: string,
): Promise<void> {
    const clientId = process.env.NEXT_PUBLIC_ONEDRIVE_CLIENT_ID
    if (!clientId) {
        throw new Error(
            "OneDrive is not configured. Set NEXT_PUBLIC_ONEDRIVE_CLIENT_ID.",
        )
    }

    const accessToken = await acquireAccessToken(clientId)
    const uploadPath = `/me/drive/root:/${encodeURIComponent(filename)}:/content`

    const response = await fetch(
        `https://graph.microsoft.com/v1.0${uploadPath}`,
        {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": mimeType,
            },
            body: content,
        },
    )

    if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(
            error?.error?.message ||
                `OneDrive upload failed (${response.status})`,
        )
    }
}
