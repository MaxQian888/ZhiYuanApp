import manifest, { dynamic } from "./manifest"

describe("web app manifest", () => {
  it("is statically exported so the Tauri build can inline it", () => {
    expect(dynamic).toBe("force-static")
  })

  it("describes the installable operations console", () => {
    const value = manifest()
    expect(value).toMatchObject({
      name: "智鸢运营平台",
      short_name: "智鸢",
      start_url: "/",
      display: "standalone",
    })
    expect(value.icons?.map((icon) => icon.sizes)).toEqual(["192x192", "512x512", "any"])
  })
})
