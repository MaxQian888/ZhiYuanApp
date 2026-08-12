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
  version?: string
  message: string
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { available: false, message: "Update service is not configured for web" }
  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    const update = await check()
    if (!update) return { available: false, message: "You are using the latest configured version" }
    return {
      available: true,
      version: update.version,
      message: `Version ${update.version} is available`,
    }
  } catch {
    return { available: false, message: "Update service is not configured" }
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
