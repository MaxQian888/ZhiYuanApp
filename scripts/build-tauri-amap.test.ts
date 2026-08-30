import { createAmapCsp, httpsOrigin } from "./build-tauri-amap.mjs"
import { forwardedBuildArgs } from "./tauri-build-utils.mjs"
import { readFileSync } from "node:fs"

const baseCsp = (
  JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
    app: { security: { csp: string } }
  }
).app.security.csp

describe("AMap desktop CSP", () => {
  it("allows only the fixed AMap endpoints and configured deployment origins", () => {
    const csp = createAmapCsp(baseCsp, {
      apiUrl: "https://api.example.com/v1",
      serviceHost: "https://maps.example.com/_AMapService",
    })

    expect(csp).toContain("script-src 'self' https://webapi.amap.com")
    expect(csp).toContain("https://*.amap.com https://*.autonavi.com")
    expect(csp).toContain("https://maps.example.com")
    expect(csp).toContain("https://api.example.com")
    expect(csp).not.toContain("/_AMapService")
    for (const directive of baseCsp.split(";")) {
      const [name, ...sources] = directive.trim().split(/\s+/)
      expect(csp).toContain(`${name} ${sources.join(" ")}`)
    }
  })

  it("rejects an insecure or credential-bearing deployment URL", () => {
    expect(() => httpsOrigin("http://maps.example.com", "service host")).toThrow(/HTTPS/)
    expect(() => httpsOrigin("https://user:pass@maps.example.com", "service host")).toThrow(
      /credentials/
    )
  })

  it("removes pnpm's argument separator before forwarding Tauri build flags", () => {
    expect(forwardedBuildArgs(["--", "--bundles", "app"])).toEqual(["--bundles", "app"])
    expect(forwardedBuildArgs(["--debug"])).toEqual(["--debug"])
  })
})
