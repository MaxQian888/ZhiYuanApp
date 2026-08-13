import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import * as os from "@tauri-apps/plugin-os"
import { moveWindow, Position } from "@tauri-apps/plugin-positioner"
import { check } from "@tauri-apps/plugin-updater"
import {
  checkForAppUpdate,
  closeAppWindow,
  extractSingleInstanceRoute,
  getPlatformInfo,
  installAppUpdate,
  isTauri,
  listenForSecondInstance,
  minimizeAppWindow,
  moveAppWindow,
  restoreAppWindowState,
  saveAppWindowState,
  toggleMaximizeAppWindow,
} from "./tauri"
import { restoreStateCurrent, saveWindowState, StateFlags } from "@tauri-apps/plugin-window-state"

jest.mock("@tauri-apps/api/core")
jest.mock("@tauri-apps/api/event")
jest.mock("@tauri-apps/api/window")
jest.mock("@tauri-apps/plugin-os")
jest.mock("@tauri-apps/plugin-positioner")
jest.mock("@tauri-apps/plugin-updater", () => ({ check: jest.fn() }))
jest.mock("@tauri-apps/plugin-window-state")

const mockedInvoke = invoke as jest.MockedFunction<typeof invoke>
const mockedIsTauri = isTauriRuntime as jest.MockedFunction<typeof isTauriRuntime>
const mockedCheck = check as jest.MockedFunction<typeof check>
const mockedListen = listen as jest.MockedFunction<typeof listen>
const mockedGetCurrentWindow = getCurrentWindow as jest.MockedFunction<typeof getCurrentWindow>
const mockedMoveWindow = moveWindow as jest.MockedFunction<typeof moveWindow>
const mockedRestoreState = restoreStateCurrent as jest.MockedFunction<typeof restoreStateCurrent>
const mockedSaveState = saveWindowState as jest.MockedFunction<typeof saveWindowState>

const setTauriMarker = () => {
  mockedIsTauri.mockReturnValue(true)
}

const clearTauriMarker = () => {
  mockedIsTauri.mockReturnValue(false)
}

describe("lib/tauri", () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
    mockedIsTauri.mockReset()
    mockedCheck.mockReset()
    mockedListen.mockReset()
    mockedGetCurrentWindow.mockReset()
    mockedMoveWindow.mockReset()
    mockedRestoreState.mockReset()
    mockedSaveState.mockReset()
    clearTauriMarker()
  })

  describe("isTauri", () => {
    it("returns false in jsdom (no Tauri marker)", () => {
      expect(isTauri()).toBe(false)
    })

    it("uses the official Tauri runtime detector", () => {
      setTauriMarker()
      expect(isTauri()).toBe(true)
      expect(mockedIsTauri).toHaveBeenCalledTimes(1)
    })
  })

  describe("getPlatformInfo", () => {
    it("returns null outside Tauri", async () => {
      await expect(getPlatformInfo()).resolves.toBeNull()
      expect(mockedInvoke).not.toHaveBeenCalled()
    })

    it("invokes the native platform command inside Tauri", async () => {
      setTauriMarker()
      mockedInvoke.mockResolvedValue({
        platform: "macos",
        architecture: "aarch64",
        appVersion: "0.1.0",
      })
      jest.mocked(os.platform).mockReturnValue("macos")
      jest.mocked(os.arch).mockReturnValue("aarch64")
      jest.mocked(os.type).mockReturnValue("macos")
      jest.mocked(os.family).mockReturnValue("unix")
      jest.mocked(os.version).mockReturnValue("15.6")
      jest.mocked(os.locale).mockResolvedValue("zh-CN")
      jest.mocked(os.exeExtension).mockReturnValue("")
      await expect(getPlatformInfo()).resolves.toEqual({
        platform: "macos",
        architecture: "aarch64",
        appVersion: "0.1.0",
        osType: "macos",
        osVersion: "15.6",
        family: "unix",
        locale: "zh-CN",
        executableExtension: "",
      })
      expect(mockedInvoke).toHaveBeenCalledWith("platform_info")
    })
  })

  describe("desktop window integration", () => {
    it("maps named positions to the positioner plugin", async () => {
      setTauriMarker()
      mockedMoveWindow.mockResolvedValue(undefined)

      await expect(moveAppWindow("top-right")).resolves.toBe(true)

      expect(mockedMoveWindow).toHaveBeenCalledWith(Position.TopRight)
    })

    it("manually saves and restores all window state", async () => {
      setTauriMarker()

      await expect(saveAppWindowState()).resolves.toBe(true)
      await expect(restoreAppWindowState()).resolves.toBe(true)

      const framelessFlags = StateFlags.ALL & ~StateFlags.DECORATIONS
      expect(mockedSaveState).toHaveBeenCalledWith(framelessFlags)
      expect(mockedRestoreState).toHaveBeenCalledWith(framelessFlags)
    })

    it("controls the current custom window", async () => {
      setTauriMarker()
      const appWindow = {
        minimize: jest.fn().mockResolvedValue(undefined),
        toggleMaximize: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      }
      mockedGetCurrentWindow.mockReturnValue(appWindow as never)

      await minimizeAppWindow()
      await toggleMaximizeAppWindow()
      await closeAppWindow()

      expect(appWindow.minimize).toHaveBeenCalledTimes(1)
      expect(appWindow.toggleMaximize).toHaveBeenCalledTimes(1)
      expect(appWindow.close).toHaveBeenCalledTimes(1)
    })

    it("forwards a validated route from a second instance", async () => {
      setTauriMarker()
      const callback = jest.fn()
      const unlisten = jest.fn()
      const payload = {
        requestId: 7,
        args: ["zhiyuan", "--route=/orders/detail?id=8"],
        cwd: "/tmp",
      }
      mockedInvoke.mockImplementation(async (command) =>
        command === "take_pending_single_instance_launches" ? [payload] : undefined
      )
      mockedListen.mockImplementation(async (_event, handler) => {
        handler({ payload } as never)
        return unlisten
      })

      await expect(listenForSecondInstance(callback)).resolves.toBe(unlisten)
      expect(callback).toHaveBeenCalledWith({
        requestId: 7,
        args: ["zhiyuan", "--route=/orders/detail?id=8"],
        cwd: "/tmp",
      })
      expect(callback).toHaveBeenCalledTimes(1)
      expect(mockedInvoke).toHaveBeenCalledWith("take_pending_single_instance_launches")
      expect(mockedInvoke).toHaveBeenCalledWith("acknowledge_single_instance_launch", {
        requestId: 7,
      })
      expect(extractSingleInstanceRoute(callback.mock.calls[0][0].args)).toBe("/orders/detail?id=8")
      expect(extractSingleInstanceRoute(["--route=https://example.com"])).toBeNull()
      expect(extractSingleInstanceRoute(["--route=//example.com/orders"])).toBeNull()
      expect(extractSingleInstanceRoute(["--route=/unknown"])).toBeNull()
    })

    it("removes the event listener when pending-launch recovery fails", async () => {
      setTauriMarker()
      const unlisten = jest.fn()
      mockedListen.mockResolvedValue(unlisten)
      mockedInvoke.mockRejectedValue(new Error("pending queue unavailable"))

      await expect(listenForSecondInstance(jest.fn())).rejects.toThrow("pending queue unavailable")
      expect(unlisten).toHaveBeenCalledTimes(1)
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
      setTauriMarker()
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
    })

    it("preserves configured status for network and integrity failures", async () => {
      setTauriMarker()
      mockedCheck.mockRejectedValue(new Error("endpoint returned empty response"))

      await expect(checkForAppUpdate()).resolves.toEqual({
        available: false,
        configured: true,
        message: "Update check failed: endpoint returned empty response",
      })
    })

    it("recognizes the updater's empty-endpoints configuration error", async () => {
      setTauriMarker()
      mockedCheck.mockRejectedValue(new Error("Updater does not have any endpoints set."))

      await expect(checkForAppUpdate()).resolves.toEqual({
        available: false,
        configured: false,
        message: "Update service is not configured",
      })
    })
  })
})
