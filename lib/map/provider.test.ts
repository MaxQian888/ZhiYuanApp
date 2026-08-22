import { wgs84ToGcj02, type Coordinate } from "@/lib/map/coordinates"
import { amapProvider } from "@/lib/map/amap-provider"
import { selectMapProvider } from "@/lib/map"
import { testMapProvider } from "@/lib/map/test-provider"
import type { MapProvider, Viewport } from "@/lib/map/provider"

const viewport: Viewport = {
  center: { latitude: 32.06, longitude: 118.78 },
  latitudeSpan: 0.1,
  longitudeSpan: 0.1,
}

describe.each([
  ["test", testMapProvider],
  ["amap", amapProvider],
])("%s provider", (_name, provider: MapProvider) => {
  it("puts the viewport centre in the middle of the surface", () => {
    const point = provider.project(viewport.center, viewport)
    expect(point.x).toBeCloseTo(50, 6)
    expect(point.y).toBeCloseTo(30, 6)
  })

  it("projects north as up and east as right", () => {
    const north = provider.project({ latitude: 32.09, longitude: 118.78 }, viewport)
    const east = provider.project({ latitude: 32.06, longitude: 118.81 }, viewport)
    expect(north.y).toBeLessThan(30)
    expect(east.x).toBeGreaterThan(50)
  })

  it("round-trips a point through the screen and back to the same WGS-84 coordinate", () => {
    const point: Coordinate = { latitude: 32.071, longitude: 118.802 }
    const restored = provider.unproject(provider.project(point, viewport), viewport)
    expect(restored.latitude).toBeCloseTo(point.latitude, 7)
    expect(restored.longitude).toBeCloseTo(point.longitude, 7)
  })
})

describe("datum handling", () => {
  it("the test provider plots the platform's own coordinates untouched", () => {
    // Both providers place the centre at (50, 30), so the centre proves nothing. An offset
    // point does: under the test provider the offset is the raw WGS-84 difference.
    const point: Coordinate = { latitude: 32.08, longitude: 118.8 }
    const plotted = testMapProvider.project(point, viewport)
    expect(plotted.x).toBeCloseTo(50 + ((118.8 - 118.78) / 0.1) * 84, 9)
    expect(plotted.y).toBeCloseTo(30 - ((32.08 - 32.06) / 0.1) * 48, 9)
  })

  it("the AMap provider shifts the point and its viewport together", () => {
    // Converting the point but not the centre would cancel most of the shift and leave a
    // small plausible error — the failure this test exists to catch.
    const point: Coordinate = { latitude: 32.08, longitude: 118.8 }
    const shiftedPoint = wgs84ToGcj02(point)
    const shiftedCentre = wgs84ToGcj02(viewport.center)
    const plotted = amapProvider.project(point, viewport)
    expect(plotted.x).toBeCloseTo(
      50 + ((shiftedPoint.longitude - shiftedCentre.longitude) / 0.1) * 84,
      9
    )
    expect(plotted.y).toBeCloseTo(
      30 - ((shiftedPoint.latitude - shiftedCentre.latitude) / 0.1) * 48,
      9
    )
  })

  it("the two providers disagree, because one of them applies the shift", () => {
    const point: Coordinate = { latitude: 32.08, longitude: 118.8 }
    expect(amapProvider.project(point, viewport)).not.toEqual(
      testMapProvider.project(point, viewport)
    )
  })
})

describe("selectMapProvider", () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
  })

  it("falls back to the test provider when no key is configured", () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_AMAP_KEY: "" }
    expect(selectMapProvider()).toBe(testMapProvider)
  })

  it("uses AMap once a key is configured", () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_AMAP_KEY: "test-key" }
    expect(selectMapProvider()).toBe(amapProvider)
  })
})
