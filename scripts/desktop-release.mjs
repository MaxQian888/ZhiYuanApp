import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { createAmapCsp } from "./build-tauri-amap.mjs"
import {
  addCspSources,
  httpsOrigin,
  httpsUrl,
  mergeConfig,
  runTauriBuild,
} from "./tauri-build-utils.mjs"

const CHANNELS = new Set(["internal", "pilot"])
const UPDATE_TARGETS = new Set(["darwin-aarch64", "darwin-x86_64", "windows-x86_64"])

export function versionMismatches(canonical, versions) {
  return Object.entries(versions)
    .filter(([, version]) => version !== canonical)
    .map(([source, version]) => `${source}=${version}`)
}

function readVersions(projectRoot) {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"))
  const tauri = JSON.parse(readFileSync(resolve(projectRoot, "src-tauri/tauri.conf.json"), "utf8"))
  const cargo = readFileSync(resolve(projectRoot, "src-tauri/Cargo.toml"), "utf8")
  const server = readFileSync(
    resolve(projectRoot, "server/src/main/resources/application.yml"),
    "utf8"
  )
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  const serverVersion = server.match(/version:\s*\$\{APP_VERSION:([^}]+)}/)?.[1]
  if (!packageJson.version || !cargoVersion || !tauri.version || !serverVersion) {
    throw new Error("Could not read every desktop version source")
  }
  return {
    canonical: packageJson.version,
    versions: { cargo: cargoVersion, server: serverVersion, tauri: tauri.version },
  }
}

export function assertVersionSync(projectRoot) {
  const { canonical, versions } = readVersions(projectRoot)
  const mismatches = versionMismatches(canonical, versions)
  if (mismatches.length) {
    throw new Error(`Version drift from package.json=${canonical}: ${mismatches.join(", ")}`)
  }
  return canonical
}

export function assertTagVersion(canonical, tag) {
  if (tag !== `v${canonical}`) {
    throw new Error(`Release tag ${tag} does not match package.json=${canonical}`)
  }
  return canonical
}

export function azureSignCommand({ endpoint, account, profile }) {
  const url = httpsUrl(endpoint, "Azure Artifact Signing endpoint")
  const identifier = /^[A-Za-z0-9._-]+$/
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".codesigning.azure.net") ||
    !identifier.test(account) ||
    !identifier.test(profile)
  ) {
    throw new Error("Azure Artifact Signing configuration is invalid")
  }
  return `artifact-signing-cli -e ${url.origin} -a ${account} -c ${profile} -d ZhiYuan %1`
}

export function missingSigningConfiguration(platform, environment) {
  const common = [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_UPDATER_PUBLIC_KEY",
    "UPDATE_BASE_URL",
    "NEXT_PUBLIC_API_URL",
  ]
  const macos = [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "KEYCHAIN_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  ]
  const windows = [
    "AZURE_ARTIFACT_SIGNING_ENDPOINT",
    "AZURE_ARTIFACT_SIGNING_ACCOUNT",
    "AZURE_ARTIFACT_SIGNING_PROFILE",
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "AZURE_TENANT_ID",
  ]
  const required = [
    ...common,
    ...(platform === "darwin" ? macos : platform === "win32" ? windows : []),
  ]
  return required.filter((name) => !environment[name])
}

export function createReleaseOverlay({
  channel,
  publicKey,
  updateBaseUrl,
  frontendPrebuilt = false,
}) {
  if (!CHANNELS.has(channel)) throw new Error(`Unknown desktop release channel: ${channel}`)
  if (!publicKey?.trim()) throw new Error("TAURI_UPDATER_PUBLIC_KEY is required")
  const base = httpsUrl(updateBaseUrl, "UPDATE_BASE_URL")
  const endpoint = new URL("latest.json", `${base.toString().replace(/\/?$/, "/")}`)
  const overlay = {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        active: true,
        endpoints: [endpoint.toString()],
        pubkey: publicKey.trim(),
      },
    },
  }
  return frontendPrebuilt ? mergeConfig(overlay, { build: { beforeBuildCommand: "" } }) : overlay
}

export function createDesktopCsp(baseCsp, { apiUrl, asrWebsocketUrl }) {
  const connectSources = [httpsOrigin(apiUrl, "NEXT_PUBLIC_API_URL")]
  if (asrWebsocketUrl) {
    const websocket = new URL(asrWebsocketUrl)
    if (websocket.protocol !== "wss:" || websocket.username || websocket.password) {
      throw new Error("ASR_PUBLIC_WEBSOCKET_URL must use WSS without embedded credentials")
    }
    connectSources.push(websocket.origin)
  }
  return addCspSources(baseCsp, { "connect-src": connectSources })
}

export function createUpdateManifest({ version, notes, publishedAt, platforms }) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Update version must be SemVer")
  }
  if (Number.isNaN(Date.parse(publishedAt))) throw new Error("pub_date must be RFC 3339")
  const entries = {}
  for (const platform of platforms) {
    if (!UPDATE_TARGETS.has(platform.target)) {
      throw new Error(`Unsupported updater target: ${platform.target}`)
    }
    if (entries[platform.target]) throw new Error(`Duplicate updater target: ${platform.target}`)
    httpsUrl(platform.url, "Update URL")
    if (!platform.signature?.trim()) throw new Error(`Missing signature for ${platform.target}`)
    entries[platform.target] = { url: platform.url, signature: platform.signature.trim() }
  }
  if (!Object.keys(entries).length) throw new Error("Update manifest has no platforms")
  return { version, notes, pub_date: publishedAt, platforms: entries }
}

export function validatePromotableManifest(manifest) {
  const targets = Object.keys(manifest?.platforms ?? {}).sort()
  const expected = [...UPDATE_TARGETS].sort()
  if (JSON.stringify(targets) !== JSON.stringify(expected)) {
    throw new Error(`Promotable manifest must contain exactly: ${expected.join(", ")}`)
  }
  return createUpdateManifest({
    version: manifest.version,
    notes: manifest.notes ?? "",
    publishedAt: manifest.pub_date,
    platforms: targets.map((target) => ({ target, ...manifest.platforms[target] })),
  })
}

function requireEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function build(projectRoot, args) {
  assertVersionSync(projectRoot)
  requireEnvironment("TAURI_SIGNING_PRIVATE_KEY")
  let overlay = createReleaseOverlay({
    channel: requireEnvironment("DESKTOP_RELEASE_CHANNEL"),
    publicKey: requireEnvironment("TAURI_UPDATER_PUBLIC_KEY"),
    updateBaseUrl: requireEnvironment("UPDATE_BASE_URL"),
    frontendPrebuilt: process.env.DESKTOP_FRONTEND_PREBUILT === "true",
  })
  const tauri = JSON.parse(readFileSync(resolve(projectRoot, "src-tauri/tauri.conf.json"), "utf8"))
  let csp = createDesktopCsp(tauri.app.security.csp, {
    apiUrl: requireEnvironment("NEXT_PUBLIC_API_URL"),
    asrWebsocketUrl: process.env.ASR_PUBLIC_WEBSOCKET_URL,
  })
  if (process.env.NEXT_PUBLIC_AMAP_KEY) {
    csp = createAmapCsp(csp, {
      apiUrl: process.env.NEXT_PUBLIC_API_URL,
      serviceHost: requireEnvironment("NEXT_PUBLIC_AMAP_SERVICE_HOST"),
    })
  }
  overlay = mergeConfig(overlay, { app: { security: { csp } } })
  if (process.platform === "win32") {
    const endpoint = requireEnvironment("AZURE_ARTIFACT_SIGNING_ENDPOINT")
    const account = requireEnvironment("AZURE_ARTIFACT_SIGNING_ACCOUNT")
    const profile = requireEnvironment("AZURE_ARTIFACT_SIGNING_PROFILE")
    overlay.bundle.windows = { signCommand: azureSignCommand({ endpoint, account, profile }) }
  }
  runTauriBuild({ args, env: process.env, overlay, projectRoot })
}

function main() {
  const projectRoot = resolve(import.meta.dirname, "..")
  const [command, ...args] = process.argv.slice(2)
  if (command === "check-version") {
    process.stdout.write(`${assertVersionSync(projectRoot)}\n`)
  } else if (command === "check-tag") {
    const version = assertVersionSync(projectRoot)
    process.stdout.write(`${assertTagVersion(version, args[0])}\n`)
  } else if (command === "build") {
    build(projectRoot, args)
  } else if (command === "check-signing-env") {
    const missing = missingSigningConfiguration(process.platform, process.env)
    if (missing.length)
      throw new Error(`Missing formal signing configuration: ${missing.join(", ")}`)
    process.stdout.write("formal signing configuration present\n")
  } else if (command === "manifest") {
    const [input, output] = args
    if (!input || !output) throw new Error("manifest requires input and output JSON paths")
    const manifest = createUpdateManifest(JSON.parse(readFileSync(input, "utf8")))
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" })
  } else if (command === "validate-manifest") {
    const [input] = args
    if (!input) throw new Error("validate-manifest requires a JSON path")
    const manifest = validatePromotableManifest(JSON.parse(readFileSync(input, "utf8")))
    process.stdout.write(`${manifest.version}\n`)
  } else {
    throw new Error(
      "Usage: desktop-release.mjs <check-version|check-tag|check-signing-env|build|manifest|validate-manifest>"
    )
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
