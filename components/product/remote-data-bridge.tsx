"use client"

import { useQueries } from "@tanstack/react-query"
import { useEffect } from "react"
import { z } from "zod"
import { api, isSessionRecoverySuppressed, streamTelemetry } from "@/lib/api/client"
import { alertSchema, commandSchema, taskSchema, uavSchema } from "@/lib/api/schemas"
import { useProductStore } from "@/stores/product-store"
import { isRemoteApi } from "@/lib/env"

const remoteMode = isRemoteApi

export function RemoteDataBridge() {
  const authenticated = useProductStore((state) => state.authenticated)
  const results = useQueries({
    queries: [
      {
        queryKey: ["session"],
        queryFn: api.me,
        enabled: remoteMode && !authenticated && !isSessionRecoverySuppressed(),
        retry: false,
      },
      { queryKey: ["uavs"], queryFn: api.allUavs, enabled: remoteMode && authenticated },
      { queryKey: ["alerts"], queryFn: api.alerts, enabled: remoteMode && authenticated },
      { queryKey: ["pods"], queryFn: api.pods, enabled: remoteMode && authenticated },
      { queryKey: ["bindings"], queryFn: api.bindings, enabled: remoteMode && authenticated },
      { queryKey: ["users"], queryFn: api.allUsers, enabled: remoteMode && authenticated },
      { queryKey: ["goods"], queryFn: api.allGoods, enabled: remoteMode && authenticated },
      { queryKey: ["orders"], queryFn: api.allOrders, enabled: remoteMode && authenticated },
      { queryKey: ["tasks"], queryFn: api.allTasks, enabled: remoteMode && authenticated },
      { queryKey: ["commands"], queryFn: api.commands, enabled: remoteMode && authenticated },
    ],
  })

  useEffect(() => {
    if (!remoteMode) return
    const [session, uavs, alerts, pods, bindings, users, goods, orders, tasks, commands] = results
    if (!authenticated && session.isSuccess) {
      useProductStore.setState({ authenticated: true, staff: session.data })
    }
    if (!authenticated) return
    useProductStore.setState({
      ...(uavs.data ? { uavs: uavs.data } : {}),
      ...(alerts.data ? { alerts: alerts.data } : {}),
      ...(pods.data ? { pods: pods.data } : {}),
      ...(bindings.data ? { bindings: bindings.data } : {}),
      ...(users.data ? { users: users.data } : {}),
      ...(goods.data ? { goods: goods.data } : {}),
      ...(orders.data ? { orders: orders.data } : {}),
      ...(tasks.data ? { tasks: tasks.data } : {}),
      ...(commands.data ? { commands: commands.data } : {}),
    })
  }, [authenticated, results])

  useEffect(() => {
    if (!remoteMode || !authenticated) return
    const controller = new AbortController()
    void streamTelemetry(
      (event) => {
        const schemas = {
          telemetry: [uavSchema, "uavs"],
          alert: [alertSchema, "alerts"],
          "command-status": [commandSchema, "commands"],
          "task-status": [taskSchema, "tasks"],
        } as const
        if (!(event.event in schemas)) return
        const [schema, key] = schemas[event.event as keyof typeof schemas]
        const parsed = z.array(schema).safeParse(event.data)
        if (parsed.success) useProductStore.setState({ [key]: parsed.data })
      },
      (realtimeState) => useProductStore.setState({ realtimeState }),
      controller.signal
    )
    return () => controller.abort()
  }, [authenticated])

  return null
}
