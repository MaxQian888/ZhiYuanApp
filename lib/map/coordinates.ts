/**
 * WGS-84 ⇄ GCJ-02 conversion.
 *
 * The platform stores, transmits and reasons about WGS-84 only — that is the rule in
 * CONTEXT.md, and it exists because a coordinate that has been shifted once is
 * indistinguishable from one that has not. Shift it twice and the drone is 500 metres from
 * where the map says it is, with nothing in the data to show why.
 *
 * So conversion happens in exactly one place: the AMap provider, at the moment a coordinate
 * is handed to the map SDK, and again the moment one comes back. Nothing else in the
 * codebase may import from this module. `lib/map/provider.ts` is the seam that enforces it.
 */

const SEMI_MAJOR_AXIS = 6378245
const ECCENTRICITY_SQUARED = 0.006693421622965943

/** A point in whichever datum the caller is holding. Units are degrees. */
export interface Coordinate {
  latitude: number
  longitude: number
}

/**
 * The GCJ-02 shift is only defined over China. Outside it the two datums coincide, and
 * applying the polynomial anyway would move a coordinate that should not move.
 *
 * The box is deliberately generous: it is the one the shift algorithm itself is specified
 * against, not a political boundary, and it over-covers rather than clipping the border.
 */
export function outsideChina({ latitude, longitude }: Coordinate) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271
}

function latitudeOffset(x: number, y: number) {
  let offset = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  offset += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  offset += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
  offset += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3
  return offset
}

function longitudeOffset(x: number, y: number) {
  let offset = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  offset += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  offset += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
  offset += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3
  return offset
}

/** Converts a WGS-84 point to GCJ-02, the datum Chinese map providers render in. */
export function wgs84ToGcj02(point: Coordinate): Coordinate {
  if (outsideChina(point)) return { ...point }
  const { latitude, longitude } = point
  const x = longitude - 105
  const y = latitude - 35
  const radians = (latitude / 180) * Math.PI
  const magic = 1 - ECCENTRICITY_SQUARED * Math.sin(radians) * Math.sin(radians)
  const root = Math.sqrt(magic)
  const deltaLatitude =
    (latitudeOffset(x, y) * 180) /
    (((SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * root)) * Math.PI)
  const deltaLongitude =
    (longitudeOffset(x, y) * 180) / ((SEMI_MAJOR_AXIS / root) * Math.cos(radians) * Math.PI)
  return { latitude: latitude + deltaLatitude, longitude: longitude + deltaLongitude }
}

/**
 * Converts a GCJ-02 point back to WGS-84.
 *
 * The forward shift has no closed-form inverse, so this refines a guess until it stops
 * moving: shift the guess forward, measure how far it lands from the target, and subtract
 * that error. It converges quadratically — four rounds is already below a millimetre, and
 * the loop exits early once the correction is smaller than the tolerance.
 *
 * We need this direction because an operator clicking the map is pointing at a GCJ-02
 * pixel, and what we persist must be WGS-84.
 */
export function gcj02ToWgs84(point: Coordinate): Coordinate {
  if (outsideChina(point)) return { ...point }
  const TOLERANCE = 1e-9
  let guess = { ...point }
  for (let round = 0; round < 8; round++) {
    const shifted = wgs84ToGcj02(guess)
    const latitudeError = shifted.latitude - point.latitude
    const longitudeError = shifted.longitude - point.longitude
    guess = {
      latitude: guess.latitude - latitudeError,
      longitude: guess.longitude - longitudeError,
    }
    if (Math.abs(latitudeError) < TOLERANCE && Math.abs(longitudeError) < TOLERANCE) break
  }
  return guess
}
