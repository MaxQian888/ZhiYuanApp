import { z } from "zod"
import { clearRefreshToken, isTauri, loadRefreshToken, saveRefreshToken } from "@/lib/tauri"
import {
  alertSchema,
  bindingSchema,
  dashboardSchema,
  flightLogSchema,
  goodsSchema,
  orderSchema,
  pageSchema,
  podSchema,
  staffSchema,
  taskSchema,
  uavSchema,
  userSchema,
} from "@/lib/api/schemas"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"
let accessToken: string | null = null

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public traceId?: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function parseApiResponse<T>(value: unknown, dataSchema: z.ZodType<T>) {
  return z
    .object({ code: z.number(), message: z.string(), data: dataSchema, traceId: z.string() })
    .parse(value)
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = await loadRefreshToken()
  const headers = new Headers()
  if (refreshToken) headers.set("X-Refresh-Token", refreshToken)
  const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers,
  })
  if (!response.ok) return false
  const payload = parseApiResponse(
    await response.json(),
    z.object({ accessToken: z.string(), refreshToken: z.string().optional() })
  )
  setAccessToken(payload.data.accessToken)
  if (payload.data.refreshToken) await saveRefreshToken(payload.data.refreshToken)
  return true
}

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  retry = true
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" })
  if (response.status === 401 && retry && (await refreshAccessToken()))
    return apiRequest(path, schema, init, false)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = z
      .object({ message: z.string().optional(), traceId: z.string().optional() })
      .safeParse(payload)
    throw new ApiError(
      response.status,
      error.success ? (error.data.message ?? response.statusText) : response.statusText,
      error.success ? error.data.traceId : undefined
    )
  }
  return parseApiResponse(payload, schema).data
}

export const api = {
  login: async (username: string, password: string) => {
    const value = await apiRequest(
      "/api/v1/auth/login",
      z.object({
        accessToken: z.string(),
        refreshToken: z.string().optional(),
        staff: staffSchema,
      }),
      {
        method: "POST",
        body: JSON.stringify({ username, password, client: isTauri() ? "tauri" : "web" }),
      }
    )
    setAccessToken(value.accessToken)
    if (value.refreshToken) await saveRefreshToken(value.refreshToken)
    return value.staff
  },
  me: () => apiRequest("/api/v1/auth/me", staffSchema),
  logout: async () => {
    await apiRequest("/api/v1/auth/logout", z.null(), { method: "POST" })
    setAccessToken(null)
    await clearRefreshToken()
  },
  dashboard: () => apiRequest("/api/v1/dashboard", dashboardSchema),
  uavs: (query = "") => apiRequest(`/api/v1/uavs${query}`, pageSchema(uavSchema)),
  uav: (id: number) => apiRequest(`/api/v1/uavs/${id}`, uavSchema),
  command: (id: number, body: { type: string; source: string; transcript?: string }) =>
    apiRequest(
      `/api/v1/uavs/${id}/commands`,
      z.object({ commandId: z.string(), status: z.literal("QUEUED"), adapter: z.string() }),
      { method: "POST", body: JSON.stringify(body) }
    ),
  flightLogs: (id: number) =>
    apiRequest(`/api/v1/uavs/${id}/flight-logs`, z.array(flightLogSchema)),
  alerts: () => apiRequest("/api/v1/alerts", z.array(alertSchema)),
  pods: () => apiRequest("/api/v1/pods", z.array(podSchema)),
  bindings: () => apiRequest("/api/v1/device-bindings", z.array(bindingSchema)),
  users: () => apiRequest("/api/v1/users", pageSchema(userSchema)),
  goods: () => apiRequest("/api/v1/goods", pageSchema(goodsSchema)),
  orders: () => apiRequest("/api/v1/orders", pageSchema(orderSchema)),
  tasks: () => apiRequest("/api/v1/tasks", pageSchema(taskSchema)),
}

export type SseEvent = { event: string; data: unknown }
export function parseSseChunk(chunk: string): { events: SseEvent[]; remainder: string } {
  const frames = chunk.split("\n\n")
  const remainder = frames.pop() ?? ""
  const events = frames.flatMap((frame) => {
    let event = "message"
    const data: string[] = []
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      if (line.startsWith("data:")) data.push(line.slice(5).trim())
    }
    if (!data.length) return []
    try {
      return [{ event, data: JSON.parse(data.join("\n")) }]
    } catch {
      return []
    }
  })
  return { events, remainder }
}

export async function streamTelemetry(
  onEvent: (event: SseEvent) => void,
  onState: (state: "live" | "reconnecting" | "offline") => void,
  signal: AbortSignal
) {
  let delay = 500
  while (!signal.aborted) {
    try {
      const headers = new Headers({ Accept: "text/event-stream" })
      if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)
      const response = await fetch(`${API_URL}/api/v1/uavs/telemetry/stream`, { headers, signal })
      if (!response.ok || !response.body) throw new ApiError(response.status, response.statusText)
      onState("live")
      delay = 500
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (!signal.aborted) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parsed = parseSseChunk(buffer)
        buffer = parsed.remainder
        parsed.events.forEach(onEvent)
      }
    } catch {
      if (signal.aborted) break
      onState("reconnecting")
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, 15_000)
    }
  }
  onState("offline")
}
