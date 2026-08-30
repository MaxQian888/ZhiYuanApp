import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export function httpsOrigin(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`)
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${name} must be an HTTPS URL without embedded credentials`)
  }
  return url.origin
}

function appendSources(directives, name, sources) {
  const existing = directives.get(name)
  if (!existing) throw new Error(`Base Tauri CSP is missing ${name}`)
  directives.set(name, [...new Set([...existing, ...sources])])
}

export function createAmapCsp(baseCsp, { apiUrl, serviceHost }) {
  const directives = new Map(
    baseCsp
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => Boolean(name))
      .map(([name, ...sources]) => [name, sources])
  )
  const connectOrigins = [
    "https://restapi.amap.com",
    "https://webapi.amap.com",
    httpsOrigin(serviceHost, "NEXT_PUBLIC_AMAP_SERVICE_HOST"),
  ]
  if (apiUrl) connectOrigins.push(httpsOrigin(apiUrl, "NEXT_PUBLIC_API_URL"))

  appendSources(directives, "script-src", ["https://webapi.amap.com"])
  appendSources(directives, "img-src", ["https://*.amap.com", "https://*.autonavi.com"])
  appendSources(directives, "connect-src", connectOrigins)

  return [...directives]
    .map(([name, sources]) => `${name}${sources.length ? ` ${sources.join(" ")}` : ""}`)
    .join("; ")
}

export function forwardedBuildArgs(args) {
  return args[0] === "--" ? args.slice(1) : args
}

function build() {
  if (!process.env.NEXT_PUBLIC_AMAP_KEY) {
    throw new Error("NEXT_PUBLIC_AMAP_KEY is required for an AMap desktop build")
  }
  const serviceHost = process.env.NEXT_PUBLIC_AMAP_SERVICE_HOST
  if (!serviceHost) {
    throw new Error("NEXT_PUBLIC_AMAP_SERVICE_HOST is required for an AMap desktop build")
  }

  const tauriConfig = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
  )
  const csp = createAmapCsp(tauriConfig.app.security.csp, {
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    serviceHost,
  })
  const overlay = JSON.stringify({ app: { security: { csp } } })
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const result = spawnSync(
    pnpm,
    ["exec", "tauri", "build", "--config", overlay, ...forwardedBuildArgs(process.argv.slice(2))],
    { env: process.env, stdio: "inherit" }
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    build()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
