import { z } from "zod"

const dateTime = z.string().datetime({ offset: true })
export const roleSchema = z.enum(["admin", "manager"])
export const staffSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  displayName: z.string(),
  role: roleSchema,
  phone: z.string(),
})
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
export const alertSchema = z.object({
  id: z.number().int().positive(),
  uavId: z.number().int().positive().optional(),
  title: z.string(),
  level: z.enum(["HIGH", "MID", "LOW"]),
  occurredAt: dateTime,
  resolved: z.boolean(),
})
export const flightLogSchema = z.object({
  id: z.number().int().positive(),
  uavId: z.number().int().positive(),
  event: z.string(),
  detail: z.string(),
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
  stock: z.number().int().nonnegative(),
  weight: z.number().nonnegative(),
  status: z.union([z.literal(0), z.literal(1)]),
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
  items: z.array(orderItemSchema),
})
export const taskSchema = z.object({
  id: z.number().int().positive(),
  orderId: z.number().int().positive(),
  uavId: z.number().int().positive(),
  taskStatus: z.enum(["WAITING", "FLYING", "ARRIVED", "FAILED"]),
  startTime: dateTime.optional(),
  endTime: dateTime.optional(),
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
