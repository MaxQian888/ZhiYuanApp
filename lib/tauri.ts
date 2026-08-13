import { invoke } from "@tauri-apps/api/core"

/**
 * Detects whether the app is running inside a Tauri webview.
 * Use this to gate any code that calls `invoke` so the same component
 * works in both `pnpm dev` (web) and `pnpm tauri dev` (desktop).
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

// Type-safe wrappers for Rust commands defined in src-tauri/src/commands.rs.
// Keep this file as the SOLE caller of `invoke` — business code imports
// named functions from here, never `invoke` directly.

export type PlatformInfo = {
  platform: string
  architecture: string
  appVersion: string
}

export async function getPlatformInfo(): Promise<PlatformInfo | null> {
  if (!isTauri()) return null
  return invoke<PlatformInfo>("platform_info")
}

export type UpdateCheckResult = {
  available: boolean
  configured: boolean
  version?: string
  message: string
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isTauri())
    return {
      available: false,
      configured: false,
      message: "Update service is not configured for web",
    }
  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    const update = await check()
    if (!update)
      return {
        available: false,
        configured: true,
        message: "You are using the latest configured version",
      }
    try {
      return {
        available: true,
        configured: true,
        version: update.version,
        message: `Version ${update.version} is available`,
      }
    } finally {
      await update.close()
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const normalized = detail.trim().toLowerCase()
    const unconfigured = [
      "update service is not configured",
      "updater endpoint is not configured",
      "updater public key is not configured",
      "updater does not have any endpoints set.",
    ].includes(normalized)
    return {
      available: false,
      configured: !unconfigured,
      message: unconfigured ? "Update service is not configured" : `Update check failed: ${detail}`,
    }
  }
}

export type UpdateInstallResult = {
  installed: boolean
  version?: string
  message: string
}

export async function installAppUpdate(
  onProgress?: (downloadedBytes: number, totalBytes?: number) => void
): Promise<UpdateInstallResult> {
  if (!isTauri()) return { installed: false, message: "Update installation requires Tauri" }
  let update: Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>> = null
  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    update = await check()
    if (!update) return { installed: false, message: "No update is currently available" }
    let downloadedBytes = 0
    let totalBytes: number | undefined
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") totalBytes = event.data.contentLength
      if (event.event === "Progress") downloadedBytes += event.data.chunkLength
      onProgress?.(downloadedBytes, totalBytes)
    })
    return {
      installed: true,
      version: update.version,
      message: `Version ${update.version} was installed. Restart the app to finish updating.`,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { installed: false, message: `Update installation failed: ${detail}` }
  } finally {
    await update?.close().catch(() => undefined)
  }
}

export async function saveRefreshToken(token: string): Promise<void> {
  if (!isTauri()) return
  const { Stronghold } = await import("@tauri-apps/plugin-stronghold")
  const stronghold = await Stronghold.load("zhiyuan-vault.hold", "zhiyuan-stronghold-v1")
  const client = await stronghold.loadClient("auth").catch(() => stronghold.createClient("auth"))
  const store = client.getStore()
  await store.insert("refresh-token", Array.from(new TextEncoder().encode(token)))
  await stronghold.save()
}

export async function clearRefreshToken(): Promise<void> {
  if (!isTauri()) return
  const { Stronghold } = await import("@tauri-apps/plugin-stronghold")
  const stronghold = await Stronghold.load("zhiyuan-vault.hold", "zhiyuan-stronghold-v1")
  const client = await stronghold.loadClient("auth").catch(() => stronghold.createClient("auth"))
  await client.getStore().remove("refresh-token")
  await stronghold.save()
}

export async function loadRefreshToken(): Promise<string | null> {
  if (!isTauri()) return null
  const { Stronghold } = await import("@tauri-apps/plugin-stronghold")
  const stronghold = await Stronghold.load("zhiyuan-vault.hold", "zhiyuan-stronghold-v1")
  const client = await stronghold.loadClient("auth").catch(() => null)
  if (!client) return null
  const value = await client.getStore().get("refresh-token")
  return value ? new TextDecoder().decode(new Uint8Array(value)) : null
}
