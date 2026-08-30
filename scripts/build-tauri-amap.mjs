import { readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { addCspSources, httpsOrigin, runTauriBuild } from "./tauri-build-utils.mjs"

export { httpsOrigin } from "./tauri-build-utils.mjs"

export function createAmapCsp(baseCsp, { apiUrl, serviceHost }) {
  const connectOrigins = [
    "https://restapi.amap.com",
    "https://webapi.amap.com",
    httpsOrigin(serviceHost, "NEXT_PUBLIC_AMAP_SERVICE_HOST"),
  ]
  if (apiUrl) connectOrigins.push(httpsOrigin(apiUrl, "NEXT_PUBLIC_API_URL"))

  return addCspSources(baseCsp, {
    "script-src": ["https://webapi.amap.com"],
    "img-src": ["https://*.amap.com", "https://*.autonavi.com"],
    "connect-src": connectOrigins,
  })
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
  runTauriBuild({
    args: process.argv.slice(2),
    env: process.env,
    overlay: JSON.parse(overlay),
    projectRoot: fileURLToPath(new URL("..", import.meta.url)),
  })
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
