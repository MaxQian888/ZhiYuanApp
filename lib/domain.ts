export type Role = "admin" | "manager"
export type UavStatus = "ONLINE" | "OFFLINE" | "FLYING" | "CHARGING"
export type CommandType = "TAKE_OFF" | "LAND" | "RETURN_HOME" | "STOP"
export type CommandStatus = "QUEUED" | "SENT" | "ACKNOWLEDGED" | "FAILED" | "TIMEOUT"
export type OrderStatus =
  | "CREATED"
  | "DISPATCHING"
  | "DELIVERING"
  | "FINISHED"
  | "CANCELLED"
  | "ERROR"
export type TaskStatus = "WAITING" | "FLYING" | "ARRIVED" | "FAILED"
export type AlertLevel = "HIGH" | "MID" | "LOW"
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED"
export type AuditLogCategory = "FLIGHT" | "CONTROL" | "VOICE"

export interface Staff {
  id: number
  username: string
  displayName: string
  role: Role
  phone: string
}

export interface StaffAccount extends Staff {
  enabled: boolean
}

export interface Uav {
  id: number
  code: string
  name: string
  rfidTag: string
  model: string
  ownerName: string
  status: UavStatus
  battery: number
  inHibernatePod: boolean
  region: string
  altitude: number
  speed: number
  latitude: number
  longitude: number
  updatedAt: string
}

export interface Alert {
  id: number
  uavId?: number
  podId?: number
  title: string
  level: AlertLevel
  occurredAt: string
  resolved: boolean
  status: AlertStatus
  acknowledgedBy?: number
  acknowledgedAt?: string
  resolvedBy?: number
  resolvedAt?: string
}

export interface AuditLog {
  id: string
  category: AuditLogCategory
  uavId?: number
  title: string
  detail: string
  status: string
  source: string
  operatorId?: number
  operatorName?: string
  occurredAt: string
}

export interface FlightLog {
  id: number
  uavId: number
  event: string
  detail: string
  latitude?: number
  longitude?: number
  occurredAt: string
}

export interface ControlCommand {
  id: string
  uavId: number
  type: CommandType
  status: CommandStatus
  source: "MANUAL" | "VOICE"
  transcript?: string
  createdAt: string
}

export interface UserAddress {
  id: number
  userId: number
  receiverName: string
  receiverPhone: string
  detail: string
  latitude: number
  longitude: number
  isDefault: boolean
}

export interface ManagedUser {
  id: number
  username: string
  phone: string
  createdAt: string
  addresses: UserAddress[]
}

export interface Goods {
  id: number
  name: string
  category: "food" | "medicine" | "life" | "industry"
  price: number
  stock: number
  weight: number
  status: 0 | 1
}

export interface OrderItem {
  id: number
  goodsId: number
  goodsName: string
  count: number
  price: number
}

export interface Order {
  id: number
  orderNo: string
  userId: number
  addressId: number
  totalPrice: number
  status: OrderStatus
  createdAt: string
  addressSnapshot?: { receiverName: string; receiverPhone: string; detail: string }
  items: OrderItem[]
}

export interface UavTask {
  id: number
  orderId: number
  uavId: number
  taskStatus: TaskStatus
  startTime?: string
  endTime?: string
  failureReason?: string
}

export interface HibernatePod {
  id: number
  name: string
  region: string
  doorStatus: "OPEN" | "CLOSED" | "ERROR"
  uavId?: number
}

export interface DeviceBinding {
  id: number
  staffId: number
  uavId: number
  boundAt: string
  unboundAt?: string
}

export interface DashboardSummary {
  totalUav: number
  onlineUav: number
  inPod: number
  alerts: number
}

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  traceId: string
}

export interface PageResponse<T> {
  items: T[]
  page: number
  size: number
  total: number
  totalPages: number
}

const orderTransitions: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ["DISPATCHING", "CANCELLED"],
  DISPATCHING: ["DELIVERING", "CANCELLED", "ERROR"],
  DELIVERING: ["FINISHED", "ERROR"],
  FINISHED: [],
  CANCELLED: [],
  ERROR: ["DISPATCHING", "CANCELLED"],
}

const taskTransitions: Record<TaskStatus, TaskStatus[]> = {
  WAITING: ["FLYING", "FAILED"],
  FLYING: ["ARRIVED", "FAILED"],
  ARRIVED: [],
  FAILED: [],
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return orderTransitions[from].includes(to)
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return taskTransitions[from].includes(to)
}

export function filterUavs(uavs: Uav[], query: string, status: UavStatus | "ALL"): Uav[] {
  const normalized = query.trim().toLocaleLowerCase()
  return uavs.filter((uav) => {
    const matchesText =
      normalized.length === 0 ||
      [uav.code, uav.name, uav.rfidTag, uav.model, uav.ownerName, uav.region].some((value) =>
        value.toLocaleLowerCase().includes(normalized)
      )
    return matchesText && (status === "ALL" || uav.status === status)
  })
}

export function parseVoiceCommand(
  transcript: string,
  uavs: Uav[]
): { type: CommandType; uavId: number; transcript: string } | null {
  const text = transcript.trim()
  const normalized = text.toLocaleLowerCase()
  const type: CommandType | undefined =
    normalized.includes("起飞") || normalized.includes("take off")
      ? "TAKE_OFF"
      : normalized.includes("降落") || normalized.includes("land")
        ? "LAND"
        : normalized.includes("返航") || normalized.includes("return home")
          ? "RETURN_HOME"
          : normalized.includes("停止") || normalized.includes("stop")
            ? "STOP"
            : undefined
  if (!type) return null

  const chineseNumbers: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
  const matched = uavs.find((uav) => {
    const numeric = String(uav.id)
    const chinese = Object.entries(chineseNumbers).find(([, number]) => number === uav.id)?.[0]
    return (
      normalized.includes(uav.code.toLocaleLowerCase()) ||
      normalized.includes(uav.name.toLocaleLowerCase()) ||
      normalized.includes(`无人机${chinese ?? numeric}号`)
    )
  })
  return matched ? { type, uavId: matched.id, transcript: text } : null
}
