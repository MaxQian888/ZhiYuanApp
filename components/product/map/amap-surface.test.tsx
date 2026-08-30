import { act, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import Script from "next/script"
import { AmapSurface } from "@/components/product/map/amap-surface"
import { toAmapPosition } from "@/lib/map/amap-provider"

let mockScriptProps: ComponentProps<typeof Script> | undefined

jest.mock("next/script", () => ({
  __esModule: true,
  default: (props: ComponentProps<typeof Script>) => {
    mockScriptProps = props
    return null
  },
}))

const mapApi = {
  add: jest.fn(),
  clearMap: jest.fn(),
  destroy: jest.fn(),
  setZoomAndCenter: jest.fn(),
}
const MapConstructor = jest.fn(() => mapApi)
const MarkerConstructor = jest.fn((options: unknown) => ({ kind: "marker", options }))
const PolylineConstructor = jest.fn((options: unknown) => ({ kind: "polyline", options }))
const sdk = {
  Map: MapConstructor,
  Marker: MarkerConstructor,
  Polyline: PolylineConstructor,
}
const load = jest.fn(() => Promise.resolve(sdk))

function installAmapSdk() {
  Object.defineProperty(window, "AMapLoader", {
    configurable: true,
    value: { load },
  })
}

const baseProps = {
  apiKey: "web-key",
  center: { latitude: 32.06, longitude: 118.78 },
  current: { latitude: 32.061, longitude: 118.781 },
  errorText: "高德地图加载失败",
  label: "UAV-01",
  loadingText: "正在加载高德地图…",
  track: [
    { latitude: 32.059, longitude: 118.779 },
    { latitude: 32.06, longitude: 118.78 },
  ],
  zoom: 9,
}

describe("AmapSurface", () => {
  beforeEach(() => {
    mockScriptProps = undefined
    delete window.AMapLoader
    delete window._AMapSecurityConfig
  })

  it("loads AMap 2.0, draws the flight path and destroys the map on unmount", async () => {
    installAmapSdk()
    const { unmount } = render(<AmapSurface {...baseProps} />)

    expect(mockScriptProps?.src).toBe("https://webapi.amap.com/loader.js")
    expect(screen.getByText("正在加载高德地图…")).toBeInTheDocument()

    act(() => mockScriptProps?.onReady?.())

    await waitFor(() => expect(MapConstructor).toHaveBeenCalledTimes(1))
    expect(load).toHaveBeenCalledWith({ key: "web-key", version: "2.0" })
    expect(MapConstructor).toHaveBeenCalledWith(expect.any(HTMLElement), {
      center: toAmapPosition(baseProps.center),
      viewMode: "2D",
      zoom: 9,
    })
    expect(PolylineConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        path: [
          toAmapPosition(baseProps.track[0]),
          toAmapPosition(baseProps.track[1]),
          toAmapPosition(baseProps.current),
        ],
      })
    )
    expect(MarkerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ position: toAmapPosition(baseProps.current), title: "UAV-01" })
    )

    unmount()
    expect(mapApi.destroy).toHaveBeenCalledTimes(1)
  })

  it("updates the real map when the operator changes zoom or centre", async () => {
    installAmapSdk()
    const { rerender } = render(<AmapSurface {...baseProps} />)
    act(() => mockScriptProps?.onReady?.())
    await waitFor(() => expect(MapConstructor).toHaveBeenCalledTimes(1))
    const overlayRenders = mapApi.clearMap.mock.calls.length

    rerender(<AmapSurface {...baseProps} center={{ latitude: 31.9, longitude: 118.6 }} zoom={11} />)

    expect(mapApi.setZoomAndCenter).toHaveBeenLastCalledWith(
      11,
      toAmapPosition({ latitude: 31.9, longitude: 118.6 })
    )
    expect(mapApi.clearMap).toHaveBeenCalledTimes(overlayRenders)
  })

  it("shows a declared failure state when the SDK cannot load", () => {
    render(<AmapSurface {...baseProps} />)

    act(() => mockScriptProps?.onError?.(new Error("offline")))

    expect(screen.getByRole("alert")).toHaveTextContent("高德地图加载失败")
  })

  it("sets the production service proxy before requesting the SDK", async () => {
    installAmapSdk()
    render(<AmapSurface {...baseProps} serviceHost="https://maps.example.com/_AMapService" />)

    act(() => mockScriptProps?.onReady?.())
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(window._AMapSecurityConfig).toEqual({
      serviceHost: "https://maps.example.com/_AMapService",
    })
  })
})
