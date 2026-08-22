"use client"

import { create } from "zustand"
import type {
  Alert,
  AuditLog,
  CommandType,
  ControlCommand,
  Goods,
  ManagedUser,
  Order,
  OrderStatus,
  Staff,
  TaskStatus,
  UavTask,
  UserAddress,
} from "@/lib/domain"
import { canTransitionOrder, canTransitionTask } from "@/lib/domain"
import { api } from "@/lib/api/client"
import { isRemoteApi } from "@/lib/env"
import {
  demoStaff,
  seedAlerts,
  seedAuditLogs,
  seedBindings,
  seedCommands,
  seedFlightLogs,
  seedGoods,
  seedOrders,
  seedPods,
  seedTasks,
  seedUavs,
  seedUsers,
} from "@/lib/mock-data"

export type Locale = "zh-CN" | "en"

/**
 * The three stock movements defined in CONTEXT.md §3, applied to one product row.
 * Available and reserved always move together so the physical count stays honest.
 */
function reserveLine(goods: Goods, items: { goodsId: number; count: number }[]): Goods {
  const line = items.find((item) => item.goodsId === goods.id)
  if (!line) return goods
  return {
    ...goods,
    stock: goods.stock - line.count,
    reservedStock: goods.reservedStock + line.count,
  }
}

function releaseLine(goods: Goods, order: Order | undefined): Goods {
  const line = order?.items.find((item) => item.goodsId === goods.id)
  if (!line) return goods
  return {
    ...goods,
    stock: goods.stock + line.count,
    reservedStock: Math.max(0, goods.reservedStock - line.count),
  }
}

function consumeLine(goods: Goods, order: Order | undefined): Goods {
  const line = order?.items.find((item) => item.goodsId === goods.id)
  if (!line) return goods
  return { ...goods, reservedStock: Math.max(0, goods.reservedStock - line.count) }
}

/**
 * A per-attempt key so a retried create returns the first result instead of duplicating
 * the order. `crypto.randomUUID` is unavailable in some embedded webviews, hence the
 * fallback.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
const remoteMode = isRemoteApi
interface ProductState {
  locale: Locale
  staff: Staff | null
  authenticated: boolean
  /**
   * True while a stored refresh token is being exchanged for a session on first load.
   *
   * Distinct from `authenticated: false`, which means *known* to be signed out. Collapsing
   * the two is what makes the login form flash for a moment on every reload before the
   * restored session replaces it — the app was not signed out, it just did not know yet.
   */
  sessionRecoveryPending: boolean
  realtimeState: "live" | "reconnecting" | "offline"
  dataSyncPending: boolean
  dataSyncErrors: string[]
  selectedUavId: number
  uavs: typeof seedUavs
  alerts: Alert[]
  auditLogs: AuditLog[]
  flightLogs: typeof seedFlightLogs
  commands: ControlCommand[]
  users: ManagedUser[]
  goods: Goods[]
  orders: Order[]
  tasks: UavTask[]
  pods: typeof seedPods
  bindings: typeof seedBindings
  setLocale: (locale: Locale) => void
  setSelectedUav: (id: number) => void
  login: (username: string, password: string) => boolean
  logout: () => void
  updateStaff: (patch: Partial<Staff>) => Promise<void>
  sendCommand: (
    uavId: number,
    type: CommandType,
    source: "MANUAL" | "VOICE",
    transcript?: string
  ) => Promise<string>
  acknowledgeAlert: (id: number) => Promise<void>
  resolveAlert: (id: number) => Promise<void>
  saveUser: (
    user: Omit<ManagedUser, "id" | "createdAt" | "addresses"> & { id?: number }
  ) => Promise<void>
  deleteUser: (id: number) => Promise<void>
  saveAddress: (
    userId: number,
    address: Omit<UserAddress, "id" | "userId"> & { id?: number }
  ) => Promise<void>
  deleteAddress: (userId: number, addressId: number) => Promise<void>
  setDefaultAddress: (userId: number, addressId: number) => Promise<void>
  /** Reserved stock is never edited directly — it only moves with the order lifecycle. */
  saveGoods: (
    goods: Omit<Goods, "id" | "reservedStock" | "onHandStock"> & { id?: number }
  ) => Promise<void>
  deleteGoods: (ids: number[]) => Promise<void>
  toggleGoods: (id: number) => Promise<void>
  transitionOrder: (id: number, status: OrderStatus) => Promise<boolean>
  dispatchOrder: (orderId: number, uavId: number) => Promise<boolean>
  createOrder: (
    userId: number,
    addressId: number,
    items: { goodsId: number; count: number }[]
  ) => Promise<void>
  transitionTask: (id: number, status: TaskStatus, failureReason?: string) => Promise<boolean>
  bindDevice: (uavId: number) => Promise<void>
  unbindDevice: (bindingId: number) => Promise<void>
  updatePod: (id: number, doorStatus: "OPEN" | "CLOSED" | "ERROR", uavId?: number) => Promise<void>
  clearNonAuthCache: () => void
}

export const useProductStore = create<ProductState>((set, get) => ({
  locale: "zh-CN",
  staff: remoteMode ? null : demoStaff,
  authenticated: !remoteMode,
  sessionRecoveryPending: remoteMode,
  realtimeState: remoteMode ? "offline" : "live",
  dataSyncPending: remoteMode,
  dataSyncErrors: [],
  selectedUavId: 1,
  uavs: remoteMode ? [] : seedUavs,
  alerts: remoteMode ? [] : seedAlerts,
  auditLogs: remoteMode ? [] : seedAuditLogs,
  flightLogs: remoteMode ? [] : seedFlightLogs,
  commands: remoteMode ? [] : seedCommands,
  users: remoteMode ? [] : seedUsers,
  goods: remoteMode ? [] : seedGoods,
  orders: remoteMode ? [] : seedOrders,
  tasks: remoteMode ? [] : seedTasks,
  pods: remoteMode ? [] : seedPods,
  bindings: remoteMode ? [] : seedBindings,
  setLocale: (locale) => set({ locale }),
  setSelectedUav: (selectedUavId) => set({ selectedUavId }),
  login: (username, password) => {
    const valid = username.trim() === "admin" && password === "admin123"
    if (valid) set({ authenticated: true, staff: demoStaff })
    return valid
  },
  logout: () =>
    set({
      authenticated: false,
      staff: null,
      sessionRecoveryPending: false,
      ...(remoteMode
        ? {
            realtimeState: "offline" as const,
            dataSyncPending: false,
            dataSyncErrors: [],
            selectedUavId: 1,
            uavs: [],
            alerts: [],
            auditLogs: [],
            flightLogs: [],
            commands: [],
            users: [],
            goods: [],
            orders: [],
            tasks: [],
            pods: [],
            bindings: [],
          }
        : {}),
    }),
  updateStaff: async (patch) => {
    const current = get().staff
    if (!current) return
    if (remoteMode) {
      const staff = await api.updateProfile(
        patch.displayName ?? current.displayName,
        patch.phone ?? current.phone
      )
      set({ staff })
      return
    }
    set({ staff: { ...current, ...patch } })
  },
  sendCommand: async (uavId, type, source, transcript) => {
    if (remoteMode) {
      const result = await api.command(uavId, { type, source, transcript })
      const command: ControlCommand = {
        id: result.commandId,
        uavId,
        type,
        source,
        transcript,
        status: result.status,
        createdAt: new Date().toISOString(),
      }
      const auditLog: AuditLog = {
        id: `C-${command.id}`,
        category: source === "VOICE" ? "VOICE" : "CONTROL",
        uavId,
        title: type,
        detail: transcript ?? command.status,
        status: command.status,
        source,
        operatorId: get().staff?.id,
        operatorName: get().staff?.displayName,
        occurredAt: command.createdAt,
      }
      set((state) => ({
        commands: [command, ...state.commands],
        auditLogs: [auditLog, ...state.auditLogs],
      }))
      return result.commandId
    }
    const id = `cmd-${Date.now()}`
    const command: ControlCommand = {
      id,
      uavId,
      type,
      source,
      transcript,
      status: "QUEUED",
      createdAt: new Date().toISOString(),
    }
    const auditLog: AuditLog = {
      id: `C-${command.id}`,
      category: source === "VOICE" ? "VOICE" : "CONTROL",
      uavId,
      title: type,
      detail: transcript ?? command.status,
      status: command.status,
      source,
      operatorId: get().staff?.id,
      operatorName: get().staff?.displayName,
      occurredAt: command.createdAt,
    }
    set((state) => ({
      commands: [command, ...state.commands],
      auditLogs: [auditLog, ...state.auditLogs],
    }))
    if (typeof window !== "undefined") {
      window.setTimeout(
        () =>
          set((state) => ({
            commands: state.commands.map((item) =>
              item.id === id ? { ...item, status: "SENT" } : item
            ),
            auditLogs: state.auditLogs.map((item) =>
              item.id === `C-${id}` ? { ...item, status: "SENT" } : item
            ),
          })),
        350
      )
      window.setTimeout(
        () =>
          set((state) => ({
            commands: state.commands.map((item) =>
              item.id === id ? { ...item, status: "ACKNOWLEDGED" } : item
            ),
            auditLogs: state.auditLogs.map((item) =>
              item.id === `C-${id}` ? { ...item, status: "ACKNOWLEDGED" } : item
            ),
          })),
        1000
      )
    }
    return id
  },
  acknowledgeAlert: async (id) => {
    const acknowledged = remoteMode ? await api.acknowledgeAlert(id) : undefined
    const staff = get().staff
    set((state) => ({
      alerts: state.alerts.map((item) =>
        item.id === id
          ? (acknowledged ?? {
              ...item,
              status: "ACKNOWLEDGED" as const,
              acknowledgedBy: staff?.id,
              acknowledgedAt: new Date().toISOString(),
            })
          : item
      ),
    }))
  },
  resolveAlert: async (id) => {
    const resolved = remoteMode ? await api.resolveAlert(id) : undefined
    set((state) => ({
      alerts: state.alerts.map((item) =>
        item.id === id
          ? (resolved ?? {
              ...item,
              resolved: true,
              status: "RESOLVED" as const,
              resolvedBy: get().staff?.id,
              resolvedAt: new Date().toISOString(),
            })
          : item
      ),
    }))
  },
  saveUser: async (user) => {
    if (remoteMode) {
      const saved = await api.saveUser(user)
      set((state) => ({
        users: user.id
          ? state.users.map((item) => (item.id === saved.id ? saved : item))
          : [...state.users, saved],
      }))
      return
    }
    set((state) =>
      user.id
        ? { users: state.users.map((item) => (item.id === user.id ? { ...item, ...user } : item)) }
        : {
            users: [
              ...state.users,
              {
                ...user,
                id: Math.max(0, ...state.users.map((item) => item.id)) + 1,
                addresses: [],
                createdAt: new Date().toISOString(),
              },
            ],
          }
    )
  },
  deleteUser: async (id) => {
    if (remoteMode) await api.deleteUser(id)
    set((state) => ({ users: state.users.filter((item) => item.id !== id) }))
  },
  saveAddress: async (userId, address) => {
    if (remoteMode) {
      const saved = await api.saveAddress(userId, address)
      set((state) => ({
        users: state.users.map((user) =>
          user.id !== userId
            ? user
            : {
                ...user,
                addresses: address.id
                  ? user.addresses.map((item) =>
                      item.id === saved.id
                        ? saved
                        : saved.isDefault
                          ? { ...item, isDefault: false }
                          : item
                    )
                  : [
                      ...user.addresses.map((item) =>
                        saved.isDefault ? { ...item, isDefault: false } : item
                      ),
                      saved,
                    ],
              }
        ),
      }))
      return
    }
    set((state) => ({
      users: state.users.map((user) => {
        if (user.id !== userId) return user
        let addresses = address.isDefault
          ? user.addresses.map((item) => ({ ...item, isDefault: false }))
          : user.addresses
        addresses = address.id
          ? addresses.map((item) => (item.id === address.id ? { ...item, ...address } : item))
          : [...addresses, { ...address, id: Date.now(), userId }]
        return { ...user, addresses }
      }),
    }))
  },
  deleteAddress: async (userId, addressId) => {
    if (remoteMode) await api.deleteAddress(userId, addressId)
    set((state) => ({
      users: state.users.map((user) => {
        if (user.id !== userId) return user
        const removed = user.addresses.find((address) => address.id === addressId)
        const addresses = user.addresses.filter((address) => address.id !== addressId)
        if (removed?.isDefault && addresses[0]) addresses[0] = { ...addresses[0], isDefault: true }
        return { ...user, addresses }
      }),
    }))
  },
  setDefaultAddress: async (userId, addressId) => {
    const saved = remoteMode ? await api.setDefaultAddress(userId, addressId) : undefined
    set((state) => ({
      users: state.users.map((user) =>
        user.id !== userId
          ? user
          : {
              ...user,
              addresses: user.addresses.map((address) =>
                address.id === addressId
                  ? (saved ?? { ...address, isDefault: true })
                  : { ...address, isDefault: false }
              ),
            }
      ),
    }))
  },
  saveGoods: async (goods) => {
    if (remoteMode) {
      const saved = await api.saveGoods(goods)
      set((state) => ({
        goods: goods.id
          ? state.goods.map((item) => (item.id === saved.id ? saved : item))
          : [...state.goods, saved],
      }))
      return
    }
    set((state) =>
      goods.id
        ? {
            // Spreading the edit over the existing row keeps whatever orders have reserved.
            goods: state.goods.map((item) => (item.id === goods.id ? { ...item, ...goods } : item)),
          }
        : {
            goods: [
              ...state.goods,
              {
                ...goods,
                id: Math.max(0, ...state.goods.map((item) => item.id)) + 1,
                reservedStock: 0,
              },
            ],
          }
    )
  },
  deleteGoods: async (ids) => {
    if (remoteMode) await api.deleteGoods(ids)
    set((state) => ({ goods: state.goods.filter((item) => !ids.includes(item.id)) }))
  },
  toggleGoods: async (id) => {
    const saved = remoteMode ? await api.toggleGoods(id) : undefined
    set((state) => ({
      goods: state.goods.map((item) =>
        item.id === id ? (saved ?? { ...item, status: item.status === 1 ? 0 : 1 }) : item
      ),
    }))
  },
  transitionOrder: async (id, status) => {
    const current = get().orders.find((item) => item.id === id)
    if (!current || !canTransitionOrder(current.status, status)) return false
    const saved = remoteMode && status === "CANCELLED" ? await api.cancelOrder(id) : undefined
    if (remoteMode && !saved) return false
    set((state) => ({
      orders: state.orders.map((item) => (item.id === id ? (saved ?? { ...item, status }) : item)),
      // Cancelling gives the claim back; every other transition leaves stock where it is.
      goods:
        status === "CANCELLED"
          ? state.goods.map((goods) => releaseLine(goods, current))
          : state.goods,
      tasks:
        status === "CANCELLED"
          ? state.tasks.map((task) =>
              task.orderId === id && ["WAITING", "FLYING"].includes(task.taskStatus)
                ? { ...task, taskStatus: "FAILED" as const, endTime: new Date().toISOString() }
                : task
            )
          : state.tasks,
    }))
    return true
  },
  createOrder: async (userId, addressId, items) => {
    if (remoteMode) {
      // The key makes a retried POST return the original order instead of a second one.
      const order = await api.createOrder(userId, addressId, items, newIdempotencyKey())
      set((state) => ({
        orders: [order, ...state.orders],
        goods: state.goods.map((goods) => reserveLine(goods, items)),
      }))
      return
    }
    const user = get().users.find((item) => item.id === userId)
    const address = user?.addresses.find((item) => item.id === addressId)
    if (!user || !address || !items.length) throw new Error("Invalid order data")
    const lines = items.map((line, index) => {
      const goods = get().goods.find((item) => item.id === line.goodsId)
      if (!goods || goods.status !== 1 || goods.stock < line.count)
        throw new Error("Insufficient stock")
      return {
        id: Date.now() + index,
        goodsId: goods.id,
        goodsName: goods.name,
        count: line.count,
        price: goods.price,
      }
    })
    const order: Order = {
      id: Math.max(0, ...get().orders.map((item) => item.id)) + 1,
      orderNo: `ZY-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now().toString().slice(-6)}`,
      userId,
      addressId,
      totalPrice: lines.reduce((total, line) => total + line.price * line.count, 0),
      status: "CREATED",
      createdAt: new Date().toISOString(),
      addressSnapshot: {
        receiverName: address.receiverName,
        receiverPhone: address.receiverPhone,
        detail: address.detail,
      },
      items: lines,
    }
    set((state) => ({
      orders: [order, ...state.orders],
      goods: state.goods.map((goods) => reserveLine(goods, items)),
    }))
  },
  dispatchOrder: async (orderId, uavId) => {
    const current = get().orders.find((item) => item.id === orderId)
    if (!current || !canTransitionOrder(current.status, "DISPATCHING")) return false
    if (remoteMode) {
      const task = await api.dispatchOrder(orderId, uavId)
      set((state) => ({
        orders: state.orders.map((item) =>
          item.id === orderId ? { ...item, status: "DISPATCHING" } : item
        ),
        tasks: state.tasks.some((item) => item.id === task.id)
          ? state.tasks.map((item) => (item.id === task.id ? task : item))
          : [...state.tasks, task],
      }))
      return true
    }
    set((state) => ({
      orders: state.orders.map((item) =>
        item.id === orderId ? { ...item, status: "DISPATCHING" } : item
      ),
      tasks: [
        ...state.tasks,
        {
          id: Math.max(0, ...state.tasks.map((item) => item.id)) + 1,
          orderId,
          uavId,
          taskStatus: "WAITING",
        },
      ],
    }))
    return true
  },
  transitionTask: async (id, status, failureReason) => {
    const task = get().tasks.find((item) => item.id === id)
    if (!task || !canTransitionTask(task.taskStatus, status)) return false
    if (status === "WAITING") return false
    if (remoteMode) {
      const saved = await api.transitionTask(id, status, failureReason)
      const orderStatus =
        status === "FLYING" ? "DELIVERING" : status === "ARRIVED" ? "FINISHED" : "ERROR"
      set((state) => ({
        tasks: state.tasks.map((item) => (item.id === id ? saved : item)),
        orders: state.orders.map((item) =>
          item.id === saved.orderId ? { ...item, status: orderStatus } : item
        ),
      }))
      return true
    }
    const now = new Date().toISOString()
    const order = get().orders.find((item) => item.id === task.orderId)
    set((state) => ({
      tasks: state.tasks.map((item) =>
        item.id === id
          ? {
              ...item,
              taskStatus: status,
              startTime: status === "FLYING" ? now : item.startTime,
              endTime: status === "ARRIVED" || status === "FAILED" ? now : item.endTime,
              failureReason: status === "FAILED" ? failureReason : undefined,
            }
          : item
      ),
      orders: state.orders.map((item) =>
        item.id === task.orderId
          ? {
              ...item,
              status:
                status === "FLYING" ? "DELIVERING" : status === "ARRIVED" ? "FINISHED" : "ERROR",
            }
          : item
      ),
      // Arrival redeems the reservation: the goods have physically left the warehouse.
      // A failure deliberately keeps it so the order can be re-dispatched.
      goods:
        status === "ARRIVED" ? state.goods.map((goods) => consumeLine(goods, order)) : state.goods,
    }))
    return true
  },
  bindDevice: async (uavId) => {
    const staff = get().staff
    if (
      !staff ||
      get().bindings.some(
        (item) => item.staffId === staff.id && item.uavId === uavId && !item.unboundAt
      )
    )
      return
    const binding = remoteMode
      ? await api.bindDevice(staff.id, uavId)
      : { id: Date.now(), staffId: staff.id, uavId, boundAt: new Date().toISOString() }
    set((state) => ({ bindings: [...state.bindings, binding] }))
  },
  unbindDevice: async (bindingId) => {
    if (remoteMode) await api.unbindDevice(bindingId)
    set((state) => ({
      bindings: state.bindings.map((item) =>
        item.id === bindingId ? { ...item, unboundAt: new Date().toISOString() } : item
      ),
    }))
  },
  updatePod: async (id, doorStatus, uavId) => {
    const saved = remoteMode
      ? await api.updatePod(id, doorStatus, uavId)
      : { ...get().pods.find((pod) => pod.id === id)!, doorStatus, uavId }
    set((state) => ({ pods: state.pods.map((pod) => (pod.id === id ? saved : pod)) }))
  },
  clearNonAuthCache: () =>
    set(
      remoteMode
        ? {
            selectedUavId: 1,
            dataSyncPending: true,
            dataSyncErrors: [],
            uavs: [],
            alerts: [],
            auditLogs: [],
            flightLogs: [],
            commands: [],
            users: [],
            goods: [],
            orders: [],
            tasks: [],
            pods: [],
            bindings: [],
          }
        : { selectedUavId: 1 }
    ),
}))
