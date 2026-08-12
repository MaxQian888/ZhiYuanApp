"use client"

import { create } from "zustand"
import type {
  Alert,
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
import {
  demoStaff,
  seedAlerts,
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
interface ProductState {
  locale: Locale
  staff: Staff | null
  authenticated: boolean
  selectedUavId: number
  uavs: typeof seedUavs
  alerts: Alert[]
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
  updateStaff: (patch: Partial<Staff>) => void
  sendCommand: (
    uavId: number,
    type: CommandType,
    source: "MANUAL" | "VOICE",
    transcript?: string
  ) => string
  resolveAlert: (id: number) => void
  saveUser: (user: Omit<ManagedUser, "id" | "createdAt" | "addresses"> & { id?: number }) => void
  deleteUser: (id: number) => void
  saveAddress: (
    userId: number,
    address: Omit<UserAddress, "id" | "userId"> & { id?: number }
  ) => void
  saveGoods: (goods: Omit<Goods, "id"> & { id?: number }) => void
  deleteGoods: (ids: number[]) => void
  toggleGoods: (id: number) => void
  transitionOrder: (id: number, status: OrderStatus) => boolean
  dispatchOrder: (orderId: number, uavId: number) => boolean
  transitionTask: (id: number, status: TaskStatus) => boolean
  bindDevice: (uavId: number) => void
  unbindDevice: (bindingId: number) => void
  clearNonAuthCache: () => void
}

export const useProductStore = create<ProductState>((set, get) => ({
  locale: "zh-CN",
  staff: process.env.NEXT_PUBLIC_API_MODE === "remote" ? null : demoStaff,
  authenticated: process.env.NEXT_PUBLIC_API_MODE !== "remote",
  selectedUavId: 1,
  uavs: seedUavs,
  alerts: seedAlerts,
  flightLogs: seedFlightLogs,
  commands: seedCommands,
  users: seedUsers,
  goods: seedGoods,
  orders: seedOrders,
  tasks: seedTasks,
  pods: seedPods,
  bindings: seedBindings,
  setLocale: (locale) => set({ locale }),
  setSelectedUav: (selectedUavId) => set({ selectedUavId }),
  login: (username, password) => {
    const valid = username.trim() === "admin" && password === "admin123"
    if (valid) set({ authenticated: true, staff: demoStaff })
    return valid
  },
  logout: () => set({ authenticated: false, staff: null }),
  updateStaff: (patch) =>
    set((state) => ({ staff: state.staff ? { ...state.staff, ...patch } : null })),
  sendCommand: (uavId, type, source, transcript) => {
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
    set((state) => ({ commands: [command, ...state.commands] }))
    if (typeof window !== "undefined") {
      window.setTimeout(
        () =>
          set((state) => ({
            commands: state.commands.map((item) =>
              item.id === id ? { ...item, status: "SENT" } : item
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
          })),
        1000
      )
    }
    return id
  },
  resolveAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.map((item) => (item.id === id ? { ...item, resolved: true } : item)),
    })),
  saveUser: (user) =>
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
    ),
  deleteUser: (id) => set((state) => ({ users: state.users.filter((item) => item.id !== id) })),
  saveAddress: (userId, address) =>
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
    })),
  saveGoods: (goods) =>
    set((state) =>
      goods.id
        ? {
            goods: state.goods.map((item) => (item.id === goods.id ? { ...item, ...goods } : item)),
          }
        : {
            goods: [
              ...state.goods,
              { ...goods, id: Math.max(0, ...state.goods.map((item) => item.id)) + 1 },
            ],
          }
    ),
  deleteGoods: (ids) =>
    set((state) => ({ goods: state.goods.filter((item) => !ids.includes(item.id)) })),
  toggleGoods: (id) =>
    set((state) => ({
      goods: state.goods.map((item) =>
        item.id === id ? { ...item, status: item.status === 1 ? 0 : 1 } : item
      ),
    })),
  transitionOrder: (id, status) => {
    const current = get().orders.find((item) => item.id === id)
    if (!current || !canTransitionOrder(current.status, status)) return false
    set((state) => ({
      orders: state.orders.map((item) => (item.id === id ? { ...item, status } : item)),
    }))
    return true
  },
  dispatchOrder: (orderId, uavId) => {
    const current = get().orders.find((item) => item.id === orderId)
    if (!current || !canTransitionOrder(current.status, "DISPATCHING")) return false
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
  transitionTask: (id, status) => {
    const task = get().tasks.find((item) => item.id === id)
    if (!task || !canTransitionTask(task.taskStatus, status)) return false
    const now = new Date().toISOString()
    set((state) => ({
      tasks: state.tasks.map((item) =>
        item.id === id
          ? {
              ...item,
              taskStatus: status,
              startTime: status === "FLYING" ? now : item.startTime,
              endTime: status === "ARRIVED" || status === "FAILED" ? now : item.endTime,
            }
          : item
      ),
    }))
    return true
  },
  bindDevice: (uavId) =>
    set((state) =>
      state.staff &&
      !state.bindings.some((item) => item.staffId === state.staff?.id && item.uavId === uavId)
        ? {
            bindings: [
              ...state.bindings,
              { id: Date.now(), staffId: state.staff.id, uavId, boundAt: new Date().toISOString() },
            ],
          }
        : state
    ),
  unbindDevice: (bindingId) =>
    set((state) => ({ bindings: state.bindings.filter((item) => item.id !== bindingId) })),
  clearNonAuthCache: () => set({ selectedUavId: 1 }),
}))
