import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core"
import type { StateFlags as WindowStateFlags } from "@tauri-apps/plugin-window-state"

/**
 * Detects whether the app is running inside a Tauri webview.
 * Use this to gate any code that calls `invoke` so the same component
 * works in both `pnpm dev` (web) and `pnpm tauri dev` (desktop).
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && isTauriRuntime()
}

// Type-safe wrappers for Rust commands defined in src-tauri/src/commands.rs.
// Keep this file as the SOLE caller of `invoke` — business code imports
// named functions from here, never `invoke` directly.

export type PlatformInfo = {
  platform: string
  architecture: string
  appVersion: string
  osType: string
  osVersion: string
  family: string
  locale: string | null
  executableExtension: string
}

export async function getPlatformInfo(): Promise<PlatformInfo | null> {
  if (!isTauri()) return null
  const [build, os] = await Promise.all([
    invoke<Pick<PlatformInfo, "platform" | "architecture" | "appVersion">>("platform_info"),
    import("@tauri-apps/plugin-os"),
  ])
  return {
    ...build,
    platform: os.platform(),
    architecture: os.arch(),
    osType: os.type(),
    osVersion: os.version(),
    family: os.family(),
    locale: await os.locale(),
    executableExtension: os.exeExtension(),
  }
}

export type AppWindowPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "left-center"
  | "center"
  | "right-center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"

export async function moveAppWindow(position: AppWindowPosition): Promise<boolean> {
  if (!isTauri()) return false
  const { moveWindow, Position } = await import("@tauri-apps/plugin-positioner")
  const positions = {
    "top-left": Position.TopLeft,
    "top-center": Position.TopCenter,
    "top-right": Position.TopRight,
    "left-center": Position.LeftCenter,
    center: Position.Center,
    "right-center": Position.RightCenter,
    "bottom-left": Position.BottomLeft,
    "bottom-center": Position.BottomCenter,
    "bottom-right": Position.BottomRight,
  }
  await moveWindow(positions[position])
  return true
}

export async function saveAppWindowState(): Promise<boolean> {
  if (!isTauri()) return false
  const { saveWindowState, StateFlags } = await import("@tauri-apps/plugin-window-state")
  const flags = (StateFlags.ALL & ~StateFlags.DECORATIONS) as WindowStateFlags
  await saveWindowState(flags)
  return true
}

export async function restoreAppWindowState(): Promise<boolean> {
  if (!isTauri()) return false
  const { restoreStateCurrent, StateFlags } = await import("@tauri-apps/plugin-window-state")
  const flags = (StateFlags.ALL & ~StateFlags.DECORATIONS) as WindowStateFlags
  await restoreStateCurrent(flags)
  return true
}

async function withCurrentWindow(
  action: (
    appWindow: ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>
  ) => Promise<void> | void
): Promise<boolean> {
  if (!isTauri()) return false
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  await action(getCurrentWindow())
  return true
}

export function minimizeAppWindow(): Promise<boolean> {
  return withCurrentWindow((appWindow) => appWindow.minimize())
}

export function toggleMaximizeAppWindow(): Promise<boolean> {
  return withCurrentWindow((appWindow) => appWindow.toggleMaximize())
}

export function closeAppWindow(): Promise<boolean> {
  return withCurrentWindow((appWindow) => appWindow.close())
}

export type SingleInstancePayload = {
  requestId: number
  args: string[]
  cwd: string
}

const appRouteRoots = [
  "/uavs",
  "/map",
  "/voice",
  "/alerts",
  "/logs",
  "/pods",
  "/users",
  "/goods",
  "/orders",
  "/tasks",
  "/settings",
] as const

export function extractSingleInstanceRoute(args: string[]): string | null {
  const route = args.find((arg) => arg.startsWith("--route="))?.slice("--route=".length)
  if (!route || !route.startsWith("/") || route.startsWith("//") || route.includes("\\")) {
    return null
  }
  try {
    const url = new URL(route, "https://zhiyuan.local")
    if (url.origin !== "https://zhiyuan.local") return null
    if (
      url.pathname !== "/" &&
      !appRouteRoots.some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`))
    ) {
      return null
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export async function listenForSecondInstance(
  callback: (payload: SingleInstancePayload) => void
): Promise<() => void> {
  if (!isTauri()) return () => undefined
  const { listen } = await import("@tauri-apps/api/event")
  const delivered = new Set<number>()
  const deliver = (payload: SingleInstancePayload) => {
    if (delivered.has(payload.requestId)) return
    delivered.add(payload.requestId)
    callback(payload)
  }
  const unlisten = await listen<SingleInstancePayload>("single-instance", (event) => {
    deliver(event.payload)
    void invoke("acknowledge_single_instance_launch", {
      requestId: event.payload.requestId,
    }).catch(() => undefined)
  })
  try {
    const pending = await invoke<SingleInstancePayload[]>("take_pending_single_instance_launches")
    pending.forEach(deliver)
    return unlisten
  } catch (error) {
    unlisten()
    throw error
  }
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
