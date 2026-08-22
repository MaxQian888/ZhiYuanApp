import type { Coordinate } from "@/lib/map/coordinates"
import {
  projectLinear,
  unprojectLinear,
  type MapProvider,
  type ScreenPoint,
  type Viewport,
} from "@/lib/map/provider"

/**
 * The provider used when no map key is configured — in tests, in CI, and on a developer
 * machine that has never seen an AMap console.
 *
 * It draws a grid and plots points on it. Deliberately no tiles and no network: the console
 * must stay usable, and its tests must stay runnable, without a third-party account.
 *
 * It performs no datum conversion, because it renders the platform's own coordinates
 * directly. A point plotted here is exactly the WGS-84 point that was stored.
 */
export const testMapProvider: MapProvider = {
  name: "TEST MAP PROVIDER",
  project: (point: Coordinate, viewport: Viewport) => projectLinear(point, viewport),
  unproject: (point: ScreenPoint, viewport: Viewport) => unprojectLinear(point, viewport),
}
