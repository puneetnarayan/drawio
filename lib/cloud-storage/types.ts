export type SaveDestination = "device" | "google-drive" | "onedrive" | "github" | "supabase"

export interface GitHubSaveConfig {
    owner: string
    repo: string
    branch: string
    folder: string
    token: string
}

export function isGitHubSaveConfigComplete(
    config: Partial<GitHubSaveConfig> | null | undefined,
): config is GitHubSaveConfig {
    return Boolean(config?.owner && config?.repo && config?.token)
}
