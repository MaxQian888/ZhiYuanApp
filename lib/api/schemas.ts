import { z } from "zod"

const dateTime = z.string().datetime({ offset: true })
export const roleSchema = z.enum(["admin", "manager"])
export const staffSchema = z.object({
  id: z.number().int().positive(),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(80),
  role: roleSchema,
  phone: z.string().regex(/^1[3-9]\d{9}$/),
})
export const staffAccountSchema = staffSchema.extend({ enabled: z.boolean() })
/**
 * A sign-in that either completed or stopped for a second factor.
 *
 * `accessToken` and `staff` are absent — not null — when `mfaRequired` is true: the server
 * omits null fields, and a half-completed sign-in must not hand back anything that looks
 * like a session.
 */
export const loginResultSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().nullish(),
  staff: staffSchema.optional(),
  mfaRequired: z.boolean().default(false),
  mfaToken: z.string().optional(),
})

export const mfaStatusSchema = z.object({
  enabled: z.boolean(),
  /** A secret has been generated but never confirmed, so it guards nothing yet. */
  pendingEnrolment: z.boolean(),
  remainingRecoveryCodes: z.number().int().nonnegative(),
})

export const mfaEnrolmentSchema = z.object({
  secret: z.string(),
  provisioningUri: z.string(),
})

export const recoveryCodesSchema = z.object({ recoveryCodes: z.array(z.string()) })

export const uavStatusSchema = z.enum(["ONLINE", "OFFLINE", "FLYING", "CHARGING"])
export const uavSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  rfidTag: z.string(),
  model: z.string(),
  ownerName: z.string(),
  status: uavStatusSchema,
  battery: z.number().min(0).max(100),
  inHibernatePod: z.boolean(),
  region: z.string(),
  altitude: z.number(),
  speed: z.number(),
  latitude: z.number(),
  longitude: z.number(),
  updatedAt: dateTime,
})
/**
 * Whether the platform will currently accept a command for a device.
 *
 * `commandable` is the only field the UI branches on. `readiness` and `reason` exist so the
 * operator is told *why* a control is unavailable — "device offline" and "telemetry stale"
 * call for completely different responses, and a greyed-out button that explains nothing
 * invites the operator to keep clicking it.
 */
export const readinessSchema = z.object({
  uavCode: z.string(),
  commandable: z.boolean(),
  readiness: z.enum(["COMMANDABLE", "UNKNOWN_DEVICE", "OFFLINE", "STALE_TELEMETRY"]),
  reason: z.string(),
  online: z.boolean().optional(),
  observedAt: z.string().optional(),
})
export const alertSchema = z.object({
  id: z.number().int().positive(),
  uavId: z.number().int().positive().optional(),
  podId: z.number().int().positive().optional(),
  title: z.string(),
  level: z.enum(["HIGH", "MID", "LOW"]),
  occurredAt: dateTime,
  resolved: z.boolean(),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]),
  acknowledgedBy: z.number().int().positive().optional(),
  acknowledgedAt: dateTime.optional(),
  resolvedBy: z.number().int().positive().optional(),
  resolvedAt: dateTime.optional(),
})
export const auditLogSchema = z.object({
  id: z.string(),
  category: z.enum(["FLIGHT", "CONTROL", "VOICE"]),
  uavId: z.number().int().positive().optional(),
  title: z.string(),
  detail: z.string(),
  status: z.string(),
  source: z.string(),
  operatorId: z.number().int().positive().optional(),
  operatorName: z.string().optional(),
  occurredAt: dateTime,
})
export const flightLogSchema = z.object({
  id: z.number().int().positive(),
  uavId: z.number().int().positive(),
  event: z.string(),
  detail: z.string(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  occurredAt: dateTime,
})
export const commandSchema = z.object({
  id: z.string(),
  uavId: z.number().int().positive(),
  type: z.enum(["TAKE_OFF", "LAND", "RETURN_HOME", "STOP"]),
  status: z.enum(["QUEUED", "SENT", "ACKNOWLEDGED", "FAILED", "TIMEOUT"]),
  source: z.enum(["MANUAL", "VOICE"]),
  transcript: z.string().optional(),
  createdAt: dateTime,
})
export const addressSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  receiverName: z.string(),
  receiverPhone: z.string(),
  detail: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  isDefault: z.boolean(),
})
export const userSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  phone: z.string(),
  createdAt: dateTime,
  addresses: z.array(addressSchema),
})
export const goodsSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  category: z.enum(["food", "medicine", "life", "industry"]),
  price: z.number().nonnegative(),
  // `stock` is AVAILABLE stock — what a new order may still claim. Unchanged meaning, on
  // purpose: ADR 0004 forbids silently redefining a field an older client already reads.
  stock: z.number().int().nonnegative(),
  weight: z.number().nonnegative(),
  status: z.union([z.literal(0), z.literal(1)]),
  // Additive (ADR 0001). Defaulted so a server that predates the migration still parses.
  reservedStock: z.number().int().nonnegative().default(0),
  onHandStock: z.number().int().nonnegative().optional(),
})
export const orderItemSchema = z.object({
  id: z.number().int().positive(),
  goodsId: z.number().int().positive(),
  goodsName: z.string(),
  count: z.number().int().positive(),
  price: z.number().nonnegative(),
})
export const orderSchema = z.object({
  id: z.number().int().positive(),
  orderNo: z.string(),
  userId: z.number().int().positive(),
  addressId: z.number().int().positive(),
  totalPrice: z.number().nonnegative(),
  status: z.enum(["CREATED", "DISPATCHING", "DELIVERING", "FINISHED", "CANCELLED", "ERROR"]),
  createdAt: dateTime,
  addressSnapshot: z
    .object({ receiverName: z.string(), receiverPhone: z.string(), detail: z.string() })
    .optional(),
  items: z.array(orderItemSchema),
  // Optimistic-concurrency token. Additive; older servers omit it.
  version: z.number().int().nonnegative().default(0),
})
export const taskSchema = z.object({
  id: z.number().int().positive(),
  orderId: z.number().int().positive(),
  uavId: z.number().int().positive(),
  taskStatus: z.enum(["WAITING", "FLYING", "ARRIVED", "FAILED"]),
  startTime: dateTime.optional(),
  endTime: dateTime.optional(),
  failureReason: z.string().optional(),
})
export const podSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  region: z.string(),
  doorStatus: z.enum(["OPEN", "CLOSED", "ERROR"]),
  uavId: z.number().int().positive().optional(),
})
export const bindingSchema = z.object({
  id: z.number().int().positive(),
  staffId: z.number().int().positive(),
  uavId: z.number().int().positive(),
  boundAt: dateTime,
  unboundAt: dateTime.optional(),
})
export const dashboardSchema = z.object({
  totalUav: z.number().int().nonnegative(),
  onlineUav: z.number().int().nonnegative(),
  inPod: z.number().int().nonnegative(),
  alerts: z.number().int().nonnegative(),
})
export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().positive(),
    size: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
