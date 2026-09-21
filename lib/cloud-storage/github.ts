// Saves a file to a specific folder in a specific GitHub repository, using
// a user-supplied Personal Access Token (fine-grained, with "Contents"
// read/write on the target repo). The token and target repo/folder are
// stored in the browser's localStorage only (see lib/storage.ts) and sent
// directly to api.github.com from the browser — never to this app's own
// server. This mirrors the existing BYOK pattern used for AI provider keys.

import type { GitHubSaveConfig } from "./types"

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            // Strip the "data:<mime>;base64," prefix
            resolve(result.slice(result.indexOf(",") + 1))
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })
}

function buildContentsUrl(config: GitHubSaveConfig, filename: string): string {
    const folder = config.folder.replace(/^\/+|\/+$/g, "")
    const path = folder ? `${folder}/${filename}` : filename
    const encodedPath = path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")
    return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodedPath}`
}

export async function uploadToGitHub(
    config: GitHubSaveConfig,
    filename: string,
    content: Blob,
): Promise<void> {
    const url = buildContentsUrl(config, filename)
    const headers = {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
    }

    // Look up the existing file's blob SHA (required by the GitHub API to
    // update rather than create a file) — a 404 just means it's new.
    let sha: string | undefined
    const branchQuery = config.branch
        ? `?ref=${encodeURIComponent(config.branch)}`
        : ""
    const existing = await fetch(`${url}${branchQuery}`, { headers })
    if (existing.ok) {
        const data = await existing.json()
        sha = data?.sha
    } else if (existing.status !== 404) {
        const error = await existing.json().catch(() => null)
        throw new Error(
            error?.message || `GitHub lookup failed (${existing.status})`,
        )
    }

    const base64Content = await blobToBase64(content)
    const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
            message: `Save diagram: ${filename}`,
            content: base64Content,
            branch: config.branch || undefined,
            sha,
        }),
    })

    if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(
            error?.message || `GitHub save failed (${response.status})`,
        )
    }
}
