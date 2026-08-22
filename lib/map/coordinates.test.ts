import { gcj02ToWgs84, outsideChina, wgs84ToGcj02, type Coordinate } from "@/lib/map/coordinates"

/** Metres between two nearby points, good enough to reason about a datum shift. */
function metresApart(a: Coordinate, b: Coordinate) {
  const latitudeMetres = (a.latitude - b.latitude) * 111_320
  const longitudeMetres =
    (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180)
  return Math.hypot(latitudeMetres, longitudeMetres)
}

const nanjing: Coordinate = { latitude: 32.0603, longitude: 118.7969 }
const beijing: Coordinate = { latitude: 39.90864, longitude: 116.39745 }

describe("outsideChina", () => {
  it("recognises points the shift applies to", () => {
    expect(outsideChina(nanjing)).toBe(false)
    expect(outsideChina(beijing)).toBe(false)
  })

  it("recognises points it does not", () => {
    expect(outsideChina({ latitude: 35.6812, longitude: 139.7671 })).toBe(true) // Tokyo
    expect(outsideChina({ latitude: 51.5007, longitude: -0.1246 })).toBe(true) // London
    expect(outsideChina({ latitude: 0, longitude: 0 })).toBe(true)
  })
})

describe("wgs84ToGcj02", () => {
  it("shifts a Chinese coordinate by the few hundred metres the datum differs by", () => {
    const shifted = wgs84ToGcj02(nanjing)

    expect(shifted).not.toEqual(nanjing)
    // The offset is a real, deliberate distortion — large enough to put a drone on the wrong
    // side of a street, small enough that it is never mistaken for a different city.
    const distance = metresApart(shifted, nanjing)
    expect(distance).toBeGreaterThan(100)
    expect(distance).toBeLessThan(1000)
  })

  it("leaves a coordinate outside China exactly where it was", () => {
    const tokyo: Coordinate = { latitude: 35.6812, longitude: 139.7671 }
    expect(wgs84ToGcj02(tokyo)).toEqual(tokyo)
  })

  it("returns a copy rather than the argument, so callers cannot alias a stored point", () => {
    const tokyo: Coordinate = { latitude: 35.6812, longitude: 139.7671 }
    expect(wgs84ToGcj02(tokyo)).not.toBe(tokyo)
  })
})

describe("gcj02ToWgs84", () => {
  it.each([
    ["Nanjing", nanjing],
    ["Beijing", beijing],
    ["a western border point", { latitude: 30.0, longitude: 80.0 }],
    ["a northern border point", { latitude: 50.0, longitude: 125.0 }],
  ])("round-trips %s to within a centimetre", (_name, point) => {
    const restored = gcj02ToWgs84(wgs84ToGcj02(point))
    expect(metresApart(restored, point)).toBeLessThan(0.01)
  })

  it("leaves a coordinate outside China exactly where it was", () => {
    const london: Coordinate = { latitude: 51.5007, longitude: -0.1246 }
    expect(gcj02ToWgs84(london)).toEqual(london)
  })

  it("is not the identity inside China", () => {
    // A guard against the inverse being stubbed out: converting a GCJ-02 reading as though
    // it were WGS-84 is the exact mistake this function exists to prevent.
    expect(gcj02ToWgs84(nanjing)).not.toEqual(nanjing)
  })
})
