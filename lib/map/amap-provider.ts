import { gcj02ToWgs84, wgs84ToGcj02, type Coordinate } from "@/lib/map/coordinates"
import {
  projectLinear,
  unprojectLinear,
  type MapProvider,
  type ScreenPoint,
  type Viewport,
} from "@/lib/map/provider"

/**
 * The AMap (高德) provider.
 *
 * AMap renders in GCJ-02. This adapter is the only code in the repository allowed to know
 * that: it shifts WGS-84 into GCJ-02 on the way to the map and shifts it back on the way
 * out, so every coordinate crossing the {@link MapProvider} boundary is WGS-84 in both
 * directions.
 *
 * Note that the viewport is converted too, not just the point. Converting a point into a
 * viewport whose centre is still WGS-84 would subtract most of the shift back out again and
 * leave a small, plausible-looking, entirely wrong offset — the worst kind, because it looks
 * like GPS noise rather than a bug.
 */
export const amapProvider: MapProvider = {
  name: "AMAP",

  project(point: Coordinate, viewport: Viewport): ScreenPoint {
    return projectLinear(wgs84ToGcj02(point), shiftViewport(viewport))
  },

  unproject(point: ScreenPoint, viewport: Viewport): Coordinate {
    return gcj02ToWgs84(unprojectLinear(point, shiftViewport(viewport)))
  },
}

function shiftViewport(viewport: Viewport): Viewport {
  return { ...viewport, center: wgs84ToGcj02(viewport.center) }
}
