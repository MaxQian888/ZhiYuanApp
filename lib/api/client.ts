import { z } from "zod"
import { clearRefreshToken, isTauri, loadRefreshToken, saveRefreshToken } from "@/lib/tauri"
import {
  alertSchema,
  auditLogSchema,
  addressSchema,
  bindingSchema,
  commandSchema,
  dashboardSchema,
  flightLogSchema,
  goodsSchema,
  loginResultSchema,
  mfaEnrolmentSchema,
  mfaStatusSchema,
  orderSchema,
  pageSchema,
  podSchema,
  readinessSchema,
  recoveryCodesSchema,
  staffSchema,
  staffAccountSchema,
  taskSchema,
  uavSchema,
  userSchema,
} from "@/lib/api/schemas"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"
const EXPLICIT_LOGOUT_KEY = "zhiyuan-explicit-logout"
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

export function suppressSessionRecovery() {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(EXPLICIT_LOGOUT_KEY, "true")
  } catch {
    // Storage is optional; the caller still clears in-memory authentication state.
  }
}

export function resumeSessionRecovery() {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(EXPLICIT_LOGOUT_KEY)
  } catch {
    // A successful explicit login already provides the active in-memory session.
  }
}

export function isSessionRecoverySuppressed() {
  try {
    return (
      typeof window !== "undefined" && window.localStorage.getItem(EXPLICIT_LOGOUT_KEY) === "true"
    )
  } catch {
    return true
  }
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
    z.object({ accessToken: z.string(), refreshToken: z.string().nullish() })
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

async function fetchAllPages<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?"
  const first = await apiRequest(`${path}${separator}page=1&size=100`, pageSchema(schema))
  if (first.totalPages <= 1) return first.items
  const remaining = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) =>
      apiRequest(`${path}${separator}page=${index + 2}&size=100`, pageSchema(schema))
    )
  )
  return [first, ...remaining].flatMap((page) => page.items)
}

/** Either a signed-in operator, or the challenge that has to be answered first. */
export type SignInOutcome =
  | { kind: "signed-in"; staff: z.infer<typeof staffSchema> }
  | { kind: "second-factor"; mfaToken: string }

async function completeSignIn(value: z.infer<typeof loginResultSchema>): Promise<SignInOutcome> {
  if (value.mfaRequired || !value.accessToken || !value.staff) {
    if (!value.mfaToken)
      throw new ApiError(500, "The server asked for a second factor but sent no challenge")
    // Nothing is stored yet. Until the code is verified this browser holds no session, which
    // is the entire point of the second step.
    return { kind: "second-factor", mfaToken: value.mfaToken }
  }
  setAccessToken(value.accessToken)
  if (value.refreshToken) await saveRefreshToken(value.refreshToken)
  resumeSessionRecovery()
  return { kind: "signed-in", staff: value.staff }
}

export const api = {
  login: async (username: string, password: string): Promise<SignInOutcome> =>
    completeSignIn(
      await apiRequest("/api/v1/auth/login", loginResultSchema, {
        method: "POST",
        body: JSON.stringify({ username, password, client: isTauri() ? "tauri" : "web" }),
      })
    ),

  /** Answers a second-factor challenge with a TOTP code or a recovery code. */
  verifyMfa: async (mfaToken: string, code: string): Promise<SignInOutcome> =>
    completeSignIn(
      await apiRequest("/api/v1/auth/mfa/verify", loginResultSchema, {
        method: "POST",
        body: JSON.stringify({ mfaToken, code, client: isTauri() ? "tauri" : "web" }),
      })
    ),

  mfaStatus: () => apiRequest("/api/v1/auth/mfa", mfaStatusSchema),
  beginMfaEnrolment: () =>
    apiRequest("/api/v1/auth/mfa/setup", mfaEnrolmentSchema, { method: "POST" }),
  confirmMfaEnrolment: (code: string) =>
    apiRequest("/api/v1/auth/mfa/confirm", recoveryCodesSchema, {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  regenerateRecoveryCodes: (code: string) =>
    apiRequest("/api/v1/auth/mfa/recovery", recoveryCodesSchema, {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  disableMfa: (code: string) =>
    apiRequest("/api/v1/auth/mfa", z.null(), {
      method: "DELETE",
      body: JSON.stringify({ code }),
    }),
  me: () => apiRequest("/api/v1/auth/me", staffSchema),
  staffAccounts: () => apiRequest("/api/v1/admins", z.array(staffAccountSchema)),
  createStaffAccount: (account: {
    username: string
    password: string
    displayName: string
    role: "admin" | "manager"
    phone: string
  }) =>
    apiRequest("/api/v1/admins", staffAccountSchema, {
      method: "POST",
      body: JSON.stringify(account),
    }),
  updateStaffAccount: (
    id: number,
    account: {
      username: string
      password?: string
      displayName: string
      role: "admin" | "manager"
      phone: string
      enabled: boolean
    }
  ) =>
    apiRequest(`/api/v1/admins/${id}`, staffAccountSchema, {
      method: "PUT",
      body: JSON.stringify(account),
    }),
  disableStaffAccount: (id: number) =>
    apiRequest(`/api/v1/admins/${id}`, staffAccountSchema, { method: "DELETE" }),
  logout: async () => {
    const refreshToken = await loadRefreshToken()
    await apiRequest("/api/v1/auth/logout", z.null(), {
      method: "POST",
      ...(refreshToken ? { headers: { "X-Refresh-Token": refreshToken } } : {}),
    })
    setAccessToken(null)
    await clearRefreshToken()
  },
  forgetAuthentication: async () => {
    setAccessToken(null)
    await clearRefreshToken()
  },
  dashboard: () => apiRequest("/api/v1/dashboard", dashboardSchema),
  search: (query: string) =>
    apiRequest(
      `/api/v1/search?q=${encodeURIComponent(query)}`,
      z.array(
        z.object({
          type: z.string(),
          id: z.number(),
          title: z.string(),
          href: z.string(),
        })
      )
    ),
  uavs: (query = "") => apiRequest(`/api/v1/uavs${query}`, pageSchema(uavSchema)),
  allUavs: () => fetchAllPages("/api/v1/uavs", uavSchema),
  uav: (id: number) => apiRequest(`/api/v1/uavs/${id}`, uavSchema),
  command: (id: number, body: { type: string; source: string; transcript?: string }) =>
    apiRequest(
      `/api/v1/uavs/${id}/commands`,
      z.object({ commandId: z.string(), status: z.literal("QUEUED"), adapter: z.string() }),
      { method: "POST", body: JSON.stringify(body) }
    ),
  readiness: (id: number) => apiRequest(`/api/v1/uavs/${id}/readiness`, readinessSchema),
  commands: () => apiRequest("/api/v1/uavs/commands", z.array(commandSchema)),
  flightLogs: (id: number) =>
    apiRequest(`/api/v1/uavs/${id}/flight-logs`, z.array(flightLogSchema)),
  alerts: (level = "") =>
    apiRequest(
      `/api/v1/alerts${level ? `?level=${encodeURIComponent(level)}` : ""}`,
      z.array(alertSchema)
    ),
  acknowledgeAlert: (id: number) =>
    apiRequest(`/api/v1/alerts/${id}/acknowledge`, alertSchema, { method: "PATCH" }),
  resolveAlert: (id: number) =>
    apiRequest(`/api/v1/alerts/${id}/resolve`, alertSchema, { method: "PATCH" }),
  auditLogs: (query = "") => apiRequest(`/api/v1/logs${query}`, pageSchema(auditLogSchema)),
  pods: () => apiRequest("/api/v1/pods", z.array(podSchema)),
  updatePod: (id: number, doorStatus: string, uavId?: number) =>
    apiRequest(`/api/v1/pods/${id}`, podSchema, {
      method: "PATCH",
      body: JSON.stringify({ doorStatus, uavId }),
    }),
  bindings: () => apiRequest("/api/v1/device-bindings", z.array(bindingSchema)),
  bindDevice: (staffId: number, uavId: number) =>
    apiRequest("/api/v1/device-bindings", bindingSchema, {
      method: "POST",
      body: JSON.stringify({ staffId, uavId }),
    }),
  unbindDevice: (id: number) =>
    apiRequest(`/api/v1/device-bindings/${id}`, z.null(), { method: "DELETE" }),
  users: () => apiRequest("/api/v1/users", pageSchema(userSchema)),
  allUsers: () => fetchAllPages("/api/v1/users", userSchema),
  saveUser: (user: { id?: number; username: string; phone: string }) =>
    apiRequest(user.id ? `/api/v1/users/${user.id}` : "/api/v1/users", userSchema, {
      method: user.id ? "PUT" : "POST",
      body: JSON.stringify({ username: user.username, phone: user.phone }),
    }),
  deleteUser: (id: number) => apiRequest(`/api/v1/users/${id}`, z.null(), { method: "DELETE" }),
  saveAddress: (
    userId: number,
    address: {
      id?: number
      receiverName: string
      receiverPhone: string
      detail: string
      latitude: number
      longitude: number
      isDefault: boolean
    }
  ) =>
    apiRequest(
      address.id
        ? `/api/v1/users/${userId}/addresses/${address.id}`
        : `/api/v1/users/${userId}/addresses`,
      addressSchema,
      { method: address.id ? "PUT" : "POST", body: JSON.stringify(address) }
    ),
  deleteAddress: (userId: number, addressId: number) =>
    apiRequest(`/api/v1/users/${userId}/addresses/${addressId}`, z.null(), { method: "DELETE" }),
  setDefaultAddress: (userId: number, addressId: number) =>
    apiRequest(`/api/v1/users/${userId}/addresses/${addressId}/default`, addressSchema, {
      method: "PATCH",
    }),
  goods: (query = "") => apiRequest(`/api/v1/goods${query}`, pageSchema(goodsSchema)),
  allGoods: () => fetchAllPages("/api/v1/goods", goodsSchema),
  saveGoods: (goods: {
    id?: number
    name: string
    category: string
    price: number
    stock: number
    weight: number
    status: number
  }) =>
    apiRequest(goods.id ? `/api/v1/goods/${goods.id}` : "/api/v1/goods", goodsSchema, {
      method: goods.id ? "PUT" : "POST",
      body: JSON.stringify(goods),
    }),
  deleteGoods: (ids: number[]) =>
    ids.length === 1
      ? apiRequest(`/api/v1/goods/${ids[0]}`, z.null(), { method: "DELETE" })
      : apiRequest("/api/v1/goods", z.null(), {
          method: "DELETE",
          body: JSON.stringify({ ids }),
        }),
  toggleGoods: (id: number) =>
    apiRequest(`/api/v1/goods/${id}/status`, goodsSchema, { method: "PATCH" }),
  orders: () => apiRequest("/api/v1/orders", pageSchema(orderSchema)),
  allOrders: () => fetchAllPages("/api/v1/orders", orderSchema),
  /**
   * Creates an order. `idempotencyKey` is optional on the wire for older clients, but new
   * ones must send it — a retried POST then returns the original order rather than a
   * second one. See ADR 0004.
   */
  createOrder: (
    userId: number,
    addressId: number,
    items: { goodsId: number; count: number }[],
    idempotencyKey?: string
  ) =>
    apiRequest("/api/v1/orders", orderSchema, {
      method: "POST",
      body: JSON.stringify({ userId, addressId, items }),
      ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    }),
  dispatchOrder: (orderId: number, uavId: number) =>
    apiRequest(`/api/v1/orders/${orderId}/dispatch`, taskSchema, {
      method: "POST",
      body: JSON.stringify({ uavId }),
    }),
  cancelOrder: (orderId: number) =>
    apiRequest(`/api/v1/orders/${orderId}/cancel`, orderSchema, { method: "POST" }),
  tasks: () => apiRequest("/api/v1/tasks", pageSchema(taskSchema)),
  allTasks: () => fetchAllPages("/api/v1/tasks", taskSchema),
  transitionTask: (id: number, target: "FLYING" | "ARRIVED" | "FAILED", failureReason?: string) => {
    const action = { FLYING: "start", ARRIVED: "arrive", FAILED: "fail" }[target]
    return apiRequest(`/api/v1/tasks/${id}/${action}`, taskSchema, {
      method: "POST",
      ...(target === "FAILED" ? { body: JSON.stringify({ reason: failureReason }) } : {}),
    })
  },
  updateProfile: (displayName: string, phone: string) =>
    apiRequest("/api/v1/auth/me", staffSchema, {
      method: "PATCH",
      body: JSON.stringify({ displayName, phone }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest("/api/v1/auth/password", z.null(), {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  sessions: async () => {
    const refreshToken = await loadRefreshToken()
    return apiRequest(
      "/api/v1/auth/sessions",
      z.array(
        z.object({
          id: z.string(),
          userAgent: z.string(),
          ipAddress: z.string(),
          createdAt: z.string().datetime({ offset: true }),
          expiresAt: z.string().datetime({ offset: true }),
          current: z.boolean(),
        })
      ),
      refreshToken ? { headers: { "X-Refresh-Token": refreshToken } } : {}
    )
  },
  revokeSession: (id: string) =>
    apiRequest(`/api/v1/auth/sessions?id=${encodeURIComponent(id)}`, z.null(), {
      method: "DELETE",
    }),
  version: () =>
    apiRequest(
      "/api/v1/system/version",
      z.object({
        configured: z.boolean(),
        currentVersion: z.string(),
        manifestUrl: z.string().optional(),
      })
    ),
}

export type SseEvent = { event: string; data: unknown; id?: string }

export function parseSseChunk(chunk: string): { events: SseEvent[]; remainder: string } {
  const frames = chunk.split("\n\n")
  const remainder = frames.pop() ?? ""
  const events = frames.flatMap((frame) => {
    let event = "message"
    let id: string | undefined
    const data: string[] = []
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      // The server numbers every event so a reconnect can resume from the gap rather
      // than refetching the whole fleet.
      if (line.startsWith("id:")) id = line.slice(3).trim()
      if (line.startsWith("data:")) data.push(line.slice(5).trim())
    }
    if (!data.length) return []
    try {
      return [{ event, id, data: JSON.parse(data.join("\n")) }]
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
  // Remembered across reconnects so the server can replay only what we missed. When it
  // cannot — the gap is older than its buffer — it sends a full snapshot instead, so a
  // long disconnection still ends with a correct client.
  let lastEventId: string | undefined

  const open = async () => {
    const headers = new Headers({ Accept: "text/event-stream" })
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)
    if (lastEventId) headers.set("Last-Event-ID", lastEventId)
    return fetch(`${API_URL}/api/v1/uavs/telemetry/stream`, {
      headers,
      signal,
      credentials: "include",
    })
  }

  while (!signal.aborted) {
    try {
      let response = await open()
      if (response.status === 401 && (await refreshAccessToken())) response = await open()
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
        for (const event of parsed.events) {
          if (event.id) lastEventId = event.id
          onEvent(event)
        }
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
