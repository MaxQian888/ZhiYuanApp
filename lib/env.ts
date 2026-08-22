export type PublicEnv = {
  appName: string
  apiUrl: string | undefined
}

export const isRemoteApi = process.env.NEXT_PUBLIC_API_MODE !== "simulator"

const REQUIRED = ["NEXT_PUBLIC_APP_NAME"] as const

/**
 * Reads NEXT_PUBLIC_* env vars and validates required ones.
 * Throws on first call if a required var is missing — see .env.example.
 */
export function getPublicEnv(): PublicEnv {
  const missing = REQUIRED.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required public env vars: ${missing.join(", ")}. See .env.example.`)
  }
  return {
    appName: process.env.NEXT_PUBLIC_APP_NAME as string,
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
  }
}

/**
 * The AMap JS API key, or undefined when no map account is configured.
 *
 * Optional on purpose: without it the console falls back to the built-in test map, which is
 * enough to see where the fleet is. Read through a function rather than a module constant so
 * a test can set it — `isRemoteApi` above is a constant because the mode must not change
 * under a running app, but the map key is only ever read at render time.
 */
export function getMapKey(): string | undefined {
  return process.env.NEXT_PUBLIC_AMAP_KEY || undefined
}

/**
 * Which speech recogniser to use.
 *
 * Defaults to `browser` — the Web Speech API, which needs no account and is what the console
 * has always used. `volcengine` opts into the streaming service; `none` turns voice capture
 * off entirely. Defaulting to `none` would have silently removed a working feature from
 * every deployment that had not yet heard of this variable.
 */
export function getAsrProvider(): "browser" | "volcengine" | "none" {
  const configured = process.env.NEXT_PUBLIC_ASR_PROVIDER
  if (configured === "volcengine" || configured === "none") return configured
  return "browser"
}

/**
 * Where the browser opens its ASR websocket.
 *
 * This is our own backend, not Volcengine directly: the Volcengine credentials are
 * server-side secrets, so the server signs and proxies the upstream connection. A public env
 * var pointing straight at Volcengine would mean shipping the app key in the bundle.
 */
export function getAsrGatewayUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_ASR_GATEWAY_URL || undefined
}
