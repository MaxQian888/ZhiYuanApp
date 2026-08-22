import { act, renderHook } from "@testing-library/react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTauriRuntime } from "@/hooks/use-tauri-runtime"
import { isTauri } from "@/lib/tauri"

jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => false) }))

describe("useIsMobile", () => {
  const listeners = new Set<() => void>()

  function mockViewport(width: number) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true })
    window.matchMedia = ((query: string) => ({
      matches: width < 768,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: (_: string, handler: () => void) => listeners.add(handler),
      removeEventListener: (_: string, handler: () => void) => listeners.delete(handler),
      dispatchEvent: jest.fn(),
    })) as unknown as typeof window.matchMedia
  }

  afterEach(() => listeners.clear())

  it("reports a desktop viewport as not mobile", () => {
    mockViewport(1280)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it("reports a narrow viewport as mobile", () => {
    mockViewport(375)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it("re-evaluates when the media query changes", () => {
    mockViewport(1280)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true })
    act(() => listeners.forEach((handler) => handler()))
    expect(result.current).toBe(true)
  })

  it("detaches its listener on unmount", () => {
    mockViewport(1280)
    const { unmount } = renderHook(() => useIsMobile())
    expect(listeners.size).toBe(1)
    unmount()
    expect(listeners.size).toBe(0)
  })
})

describe("useTauriRuntime", () => {
  it("mirrors the detected runtime", () => {
    ;(isTauri as jest.Mock).mockReturnValue(false)
    expect(renderHook(() => useTauriRuntime()).result.current).toBe(false)
    ;(isTauri as jest.Mock).mockReturnValue(true)
    expect(renderHook(() => useTauriRuntime()).result.current).toBe(true)
  })
})
