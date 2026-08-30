import { getAmapServiceHost, getMapKey } from "@/lib/env"
import { amapProvider } from "@/lib/map/amap-provider"
import { testMapProvider } from "@/lib/map/test-provider"

export type { Coordinate } from "@/lib/map/coordinates"
export type { MapProvider, ScreenPoint, Viewport } from "@/lib/map/provider"

export type MapConfiguration =
  | {
      kind: "amap"
      apiKey: string
      provider: typeof amapProvider
      serviceHost: string | undefined
    }
  | { kind: "development"; provider: typeof testMapProvider }

/** Reads the map deployment settings once and returns a discriminated rendering choice. */
export function selectMapConfiguration(): MapConfiguration {
  const apiKey = getMapKey()
  return apiKey
    ? { kind: "amap", apiKey, provider: amapProvider, serviceHost: getAmapServiceHost() }
    : { kind: "development", provider: testMapProvider }
}
