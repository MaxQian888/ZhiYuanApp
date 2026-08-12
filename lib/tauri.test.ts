import { invoke } from "@tauri-apps/api/core"
import { getPlatformInfo, isTauri } from "./tauri"

jest.mock("@tauri-apps/api/core")

const mockedInvoke = invoke as jest.MockedFunction<typeof invoke>

describe("lib/tauri", () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
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
})
