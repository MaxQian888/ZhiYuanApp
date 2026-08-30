import {
  assertTagVersion,
  azureSignCommand,
  createReleaseOverlay,
  createDesktopCsp,
  createUpdateManifest,
  missingSigningConfiguration,
  versionMismatches,
  validatePromotableManifest,
} from "./desktop-release.mjs"

describe("desktop release contract", () => {
  const baseCsp = "default-src 'self'; connect-src 'self' ipc:; script-src 'self'; img-src 'self'"
  it("reports every version source that drifted from package.json", () => {
    expect(
      versionMismatches("1.4.0", {
        cargo: "1.3.9",
        server: "1.4.0",
        tauri: "1.4.1",
      })
    ).toEqual(["cargo=1.3.9", "tauri=1.4.1"])
  })

  it("rejects a release tag that differs from the canonical version", () => {
    expect(() => assertTagVersion("1.4.0", "v1.4.1")).toThrow(/tag.*1\.4\.0/i)
    expect(assertTagVersion("1.4.0", "v1.4.0")).toBe("1.4.0")
  })

  it("builds an Azure HSM sign command only from constrained identifiers", () => {
    expect(
      azureSignCommand({
        endpoint: "https://wus2.codesigning.azure.net",
        account: "zhiyuan-prod",
        profile: "desktop-release",
      })
    ).toContain("artifact-signing-cli -e https://wus2.codesigning.azure.net")
    expect(() =>
      azureSignCommand({
        endpoint: "https://evil.example",
        account: "prod && whoami",
        profile: "desktop-release",
      })
    ).toThrow(/Azure Artifact Signing/i)
  })

  it("fails closed when formal platform signing values are incomplete", () => {
    expect(missingSigningConfiguration("darwin", {})).toContain("APPLE_SIGNING_IDENTITY")
    expect(
      missingSigningConfiguration("win32", {
        AZURE_ARTIFACT_SIGNING_ENDPOINT: "https://wus2.codesigning.azure.net",
      })
    ).toContain("AZURE_CLIENT_ID")
  })

  it("creates a signed updater overlay for an HTTPS pilot channel", () => {
    expect(
      createReleaseOverlay({
        channel: "pilot",
        publicKey: "trusted updater public key",
        updateBaseUrl: "https://updates.zhiyuan.example",
      })
    ).toEqual({
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          active: true,
          endpoints: ["https://updates.zhiyuan.example/latest.json"],
          pubkey: "trusted updater public key",
        },
      },
    })
    expect(() =>
      createReleaseOverlay({
        channel: "stable",
        publicKey: "trusted updater public key",
        updateBaseUrl: "https://updates.zhiyuan.example",
      })
    ).toThrow(/stable/i)
    expect(
      createReleaseOverlay({
        channel: "internal",
        publicKey: "trusted updater public key",
        updateBaseUrl: "https://updates.zhiyuan.example",
        frontendPrebuilt: true,
      })
    ).toHaveProperty("build.beforeBuildCommand", "")
  })

  it("adds only the configured API and ASR origins to the desktop CSP", () => {
    const csp = createDesktopCsp(baseCsp, {
      apiUrl: "https://api.zhiyuan.example/v1",
      asrWebsocketUrl: "wss://api.zhiyuan.example/api/v1/asr/ws",
    })
    expect(csp).toContain(
      "connect-src 'self' ipc: https://api.zhiyuan.example wss://api.zhiyuan.example"
    )
    expect(() => createDesktopCsp(baseCsp, { apiUrl: "http://api.test" })).toThrow(/HTTPS/)
  })

  it("embeds updater signatures in the static channel manifest", () => {
    expect(
      createUpdateManifest({
        version: "1.4.0",
        notes: "Pilot reliability fixes",
        publishedAt: "2026-08-31T00:00:00Z",
        platforms: [
          {
            target: "darwin-aarch64",
            url: "https://downloads.test/ZhiYuan.app.tar.gz",
            signature: "mac-signature",
          },
          {
            target: "windows-x86_64",
            url: "https://downloads.test/ZhiYuan-setup.exe",
            signature: "windows-signature",
          },
        ],
      })
    ).toEqual({
      version: "1.4.0",
      notes: "Pilot reliability fixes",
      pub_date: "2026-08-31T00:00:00Z",
      platforms: {
        "darwin-aarch64": {
          url: "https://downloads.test/ZhiYuan.app.tar.gz",
          signature: "mac-signature",
        },
        "windows-x86_64": {
          url: "https://downloads.test/ZhiYuan-setup.exe",
          signature: "windows-signature",
        },
      },
    })
  })

  it("requires every formal desktop target before stable promotion", () => {
    expect(() =>
      validatePromotableManifest({
        version: "1.4.0",
        pub_date: "2026-08-31T00:00:00Z",
        platforms: {},
      })
    ).toThrow(/exactly/)
  })
})
