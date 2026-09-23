"use client"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

const SESSION_KEY = "next-ai-draw-io-supabase-session"
const DIAGRAM_IDS_KEY = "next-ai-draw-io-supabase-diagram-ids"
const BUCKET = "drawings"

type Session = {
    access_token: string
    refresh_token: string
    expires_at?: number
    user: { id: string }
}

type DiagramFile = {
    id: string
    diagram_id: string
    name: string
    storage_path: string
    mime_type: string | null
    size_bytes: number | null
    version: number
    created_at: string
    updated_at: string
}

function assertConfigured() {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        throw new Error(
            "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel.",
        )
    }
}

function headers(accessToken?: string): HeadersInit {
    return {
        apikey: SUPABASE_PUBLISHABLE_KEY as string,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    }
}

function readSession(): Session | null {
    if (typeof window === "undefined") return null
    try {
        const raw = localStorage.getItem(SESSION_KEY)
        return raw ? (JSON.parse(raw) as Session) : null
    } catch {
        return null
    }
}

function writeSession(session: Session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function isExpired(session: Session) {
    return Boolean(
        session.expires_at &&
            session.expires_at * 1000 < Date.now() + 30_000,
    )
}

async function refreshSession(session: Session): Promise<Session | null> {
    const response = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
            method: "POST",
            headers: {
                ...headers(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ refresh_token: session.refresh_token }),
        },
    )

    if (!response.ok) return null

    const data = (await response.json()) as Session
    writeSession(data)
    return data
}

/**
 * Supabase anonymous sign-in does not require the user to enter any PII.
 * It creates an authenticated Supabase user so RLS can isolate each user's files.
 */
async function ensureSession(): Promise<Session> {
    assertConfigured()

    let session = readSession()
    if (session && !isExpired(session)) return session

    if (session?.refresh_token) {
        const refreshed = await refreshSession(session)
        if (refreshed) return refreshed
    }

    const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: {
            ...headers(),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: {} }),
    })

    if (!response.ok) {
        const message = await response.text()
        throw new Error(
            `Supabase anonymous sign-in failed: ${message || response.statusText}`,
        )
    }

    session = (await response.json()) as Session
    if (!session.access_token || !session.user?.id) {
        throw new Error("Supabase did not return an anonymous session.")
    }

    writeSession(session)
    return session
}

async function supabaseFetch(
    path: string,
    init: RequestInit = {},
    accessToken: string,
) {
    const requestHeaders = new Headers(init.headers)
    requestHeaders.set("apikey", SUPABASE_PUBLISHABLE_KEY as string)
    requestHeaders.set("Authorization", `Bearer ${accessToken}`)
    return fetch(`${SUPABASE_URL}${path}`, {
        ...init,
        headers: requestHeaders,
    })
}

function getDiagramIds(): Record<string, string> {
    try {
        return JSON.parse(
            localStorage.getItem(DIAGRAM_IDS_KEY) || "{}",
        ) as Record<string, string>
    } catch {
        return {}
    }
}

function getOrCreateDiagramId(filename: string) {
    const ids = getDiagramIds()
    const key = filename.toLowerCase()
    if (!ids[key]) {
        ids[key] = crypto.randomUUID()
        localStorage.setItem(DIAGRAM_IDS_KEY, JSON.stringify(ids))
    }
    return ids[key]
}

function encodePath(path: string) {
    return path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")
}

async function getVersions(
    session: Session,
    diagramId: string,
): Promise<DiagramFile[]> {
    const query = new URLSearchParams({
        select: "*",
        diagram_id: `eq.${diagramId}`,
        order: "version.asc",
    })

    const response = await supabaseFetch(
        `/rest/v1/diagram_files?${query.toString()}`,
        {},
        session.access_token,
    )

    if (!response.ok) {
        throw new Error(
            `Could not read Supabase diagram versions: ${await response.text()}`,
        )
    }

    return (await response.json()) as DiagramFile[]
}

async function deleteStoredVersion(
    session: Session,
    version: DiagramFile,
) {
    const objectResponse = await supabaseFetch(
        `/storage/v1/object/${BUCKET}/${encodePath(version.storage_path)}`,
        { method: "DELETE" },
        session.access_token,
    )

    // A missing object should not prevent metadata cleanup.
    if (!objectResponse.ok && objectResponse.status !== 404) {
        console.warn(
            "Could not delete old Supabase Storage object:",
            await objectResponse.text(),
        )
    }

    const metadataResponse = await supabaseFetch(
        `/rest/v1/diagram_files?id=eq.${encodeURIComponent(version.id)}`,
        { method: "DELETE" },
        session.access_token,
    )

    if (!metadataResponse.ok && metadataResponse.status !== 404) {
        console.warn(
            "Could not delete old Supabase metadata:",
            await metadataResponse.text(),
        )
    }
}

export async function uploadToSupabase(
    filename: string,
    blob: Blob,
    mimeType: string,
): Promise<void> {
    const session = await ensureSession()
    const diagramId = getOrCreateDiagramId(filename)
    const existing = await getVersions(session, diagramId)
    const nextVersion =
        existing.length > 0
            ? Math.max(...existing.map((item) => item.version)) + 1
            : 1

    const storagePath = `${session.user.id}/${diagramId}/v${nextVersion}.drawio`

    const uploadResponse = await supabaseFetch(
        `/storage/v1/object/${BUCKET}/${encodePath(storagePath)}`,
        {
            method: "POST",
            headers: {
                "Content-Type": mimeType || "application/octet-stream",
                "x-upsert": "false",
            },
            body: blob,
        },
        session.access_token,
    )

    if (!uploadResponse.ok) {
        throw new Error(
            `Supabase Storage upload failed: ${await uploadResponse.text()}`,
        )
    }

    const metadataResponse = await supabaseFetch(
        "/rest/v1/diagram_files",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal",
            },
            body: JSON.stringify({
                user_id: session.user.id,
                diagram_id: diagramId,
                name: filename,
                storage_path: storagePath,
                mime_type: mimeType,
                size_bytes: blob.size,
                version: nextVersion,
            }),
        },
        session.access_token,
    )

    if (!metadataResponse.ok) {
        // Keep Storage and metadata consistent if the DB insert fails.
        await supabaseFetch(
            `/storage/v1/object/${BUCKET}/${encodePath(storagePath)}`,
            { method: "DELETE" },
            session.access_token,
        )
        throw new Error(
            `Supabase metadata save failed: ${await metadataResponse.text()}`,
        )
    }

    // Keep exactly the last three saved versions.
    const allVersions = await getVersions(session, diagramId)
    const versionsToRemove = allVersions.slice(0, Math.max(0, allVersions.length - 3))

    for (const oldVersion of versionsToRemove) {
        await deleteStoredVersion(session, oldVersion)
    }
}

export async function listSupabaseDiagrams(): Promise<DiagramFile[]> {
    const session = await ensureSession()
    const query = new URLSearchParams({
        select: "*",
        order: "updated_at.desc",
    })

    const response = await supabaseFetch(
        `/rest/v1/diagram_files?${query.toString()}`,
        {},
        session.access_token,
    )

    if (!response.ok) {
        throw new Error(
            `Could not list Supabase diagrams: ${await response.text()}`,
        )
    }

    return (await response.json()) as DiagramFile[]
}

export async function downloadSupabaseDiagram(
    storagePath: string,
): Promise<Blob> {
    const session = await ensureSession()
    const response = await supabaseFetch(
        `/storage/v1/object/${BUCKET}/${encodePath(storagePath)}`,
        {},
        session.access_token,
    )

    if (!response.ok) {
        throw new Error(
            `Supabase diagram download failed: ${await response.text()}`,
        )
    }

    return response.blob()
}

export function isSupabaseConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)
}
