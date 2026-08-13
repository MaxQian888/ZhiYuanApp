import { invoke } from "@tauri-apps/api/core"
import { check } from "@tauri-apps/plugin-updater"
import { checkForAppUpdate, getPlatformInfo, installAppUpdate, isTauri } from "./tauri"

jest.mock("@tauri-apps/api/core")
jest.mock("@tauri-apps/plugin-updater", () => ({ check: jest.fn() }))

const mockedInvoke = invoke as jest.MockedFunction<typeof invoke>
const mockedCheck = check as jest.MockedFunction<typeof check>

describe("lib/tauri", () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
    mockedCheck.mockReset()
  })

  describe("isTauri", () => {
    it("returns false in jsdom (no Tauri marker)", () => {
      expect(isTauri()).toBe(false)
    })

    it("returns true when __TAURI_INTERNALS__ is on window", () => {
      ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      expect(isTauri()).toBe(true)
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    })
  })

  describe("getPlatformInfo", () => {
    it("returns null outside Tauri", async () => {
      await expect(getPlatformInfo()).resolves.toBeNull()
      expect(mockedInvoke).not.toHaveBeenCalled()
    })

    it("invokes the native platform command inside Tauri", async () => {
      ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      mockedInvoke.mockResolvedValue({
        platform: "macos",
        architecture: "aarch64",
        appVersion: "0.1.0",
      })
      await expect(getPlatformInfo()).resolves.toEqual({
        platform: "macos",
        architecture: "aarch64",
        appVersion: "0.1.0",
      })
      expect(mockedInvoke).toHaveBeenCalledWith("platform_info")
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    })
  })

  describe("updater", () => {
    it("does not claim the web build is up to date", async () => {
      await expect(checkForAppUpdate()).resolves.toEqual({
        available: false,
        configured: false,
        message: "Update service is not configured for web",
      })
      expect(mockedCheck).not.toHaveBeenCalled()
    })

    it("downloads and installs an available desktop update", async () => {
      ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      const downloadAndInstall = jest.fn().mockResolvedValue(undefined)
      const close = jest.fn().mockResolvedValue(undefined)
      mockedCheck.mockResolvedValue({
        version: "0.2.0",
        downloadAndInstall,
        close,
      } as unknown as Awaited<ReturnType<typeof check>>)

      await expect(installAppUpdate()).resolves.toEqual({
        installed: true,
        version: "0.2.0",
        message: "Version 0.2.0 was installed. Restart the app to finish updating.",
      })
      expect(downloadAndInstall).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalledTimes(1)
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    })

    it("preserves configured status for network and integrity failures", async () => {
      ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      mockedCheck.mockRejectedValue(new Error("endpoint returned empty response"))

      await expect(checkForAppUpdate()).resolves.toEqual({
        available: false,
        configured: true,
        message: "Update check failed: endpoint returned empty response",
      })
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    })

    it("recognizes the updater's empty-endpoints configuration error", async () => {
      ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      mockedCheck.mockRejectedValue(new Error("Updater does not have any endpoints set."))

      await expect(checkForAppUpdate()).resolves.toEqual({
        available: false,
        configured: false,
        message: "Update service is not configured",
      })
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    })
  })
})
