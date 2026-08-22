import { getMapKey } from "@/lib/env"
import { amapProvider } from "@/lib/map/amap-provider"
import { testMapProvider } from "@/lib/map/test-provider"
import type { MapProvider } from "@/lib/map/provider"

export type { Coordinate } from "@/lib/map/coordinates"
export type { MapProvider, ScreenPoint, Viewport } from "@/lib/map/provider"

/**
 * Picks the provider from configuration.
 *
 * Falling back to the test provider rather than throwing is deliberate: a missing map key
 * should degrade the map, not take down the console that operators use to see where their
 * fleet is. The provider name is rendered on the map surface so it is never ambiguous which
 * one is in use.
 */
export function selectMapProvider(): MapProvider {
  return getMapKey() ? amapProvider : testMapProvider
}
