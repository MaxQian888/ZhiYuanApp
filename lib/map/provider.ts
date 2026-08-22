import type { Coordinate } from "@/lib/map/coordinates"

/** The slice of the world the map is showing, always expressed in WGS-84. */
export interface Viewport {
  center: Coordinate
  latitudeSpan: number
  longitudeSpan: number
}

/** A position inside the map surface, in percent of its width and height. */
export interface ScreenPoint {
  x: number
  y: number
}

/**
 * The seam between the platform and whatever renders the map.
 *
 * Everything on the platform side of this interface is WGS-84 — arguments in, return values
 * out, no exceptions. A provider that renders in a different datum converts on both edges of
 * its own implementation and nowhere else. That is the whole point of the interface: it
 * gives the datum rule a single place to be enforced instead of a convention to be
 * remembered.
 */
export interface MapProvider {
  readonly name: string
  /** WGS-84 → screen. */
  project(point: Coordinate, viewport: Viewport): ScreenPoint
  /** Screen → WGS-84, for turning a click into something we can persist. */
  unproject(point: ScreenPoint, viewport: Viewport): Coordinate
}

/**
 * Linear equirectangular projection over the viewport.
 *
 * Shared by both providers: over a viewport a few kilometres across, the difference between
 * this and a true Mercator is well under a pixel, and the providers differ in datum, not in
 * arithmetic. Keeping the arithmetic in one place means a projection bug cannot appear in
 * one provider and not the other.
 */
export function projectLinear(point: Coordinate, viewport: Viewport): ScreenPoint {
  return {
    x: 50 + ((point.longitude - viewport.center.longitude) / viewport.longitudeSpan) * 84,
    y: 30 - ((point.latitude - viewport.center.latitude) / viewport.latitudeSpan) * 48,
  }
}

/** The exact inverse of {@link projectLinear}. */
export function unprojectLinear(point: ScreenPoint, viewport: Viewport): Coordinate {
  return {
    latitude: viewport.center.latitude + ((30 - point.y) / 48) * viewport.latitudeSpan,
    longitude: viewport.center.longitude + ((point.x - 50) / 84) * viewport.longitudeSpan,
  }
}
