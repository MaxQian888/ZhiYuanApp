"use client"

import { useQueries } from "@tanstack/react-query"
import { useEffect } from "react"
import { z } from "zod"
import { api, streamTelemetry } from "@/lib/api/client"
import { uavSchema } from "@/lib/api/schemas"
import { useProductStore } from "@/stores/product-store"

const remoteMode = process.env.NEXT_PUBLIC_API_MODE === "remote"

export function RemoteDataBridge() {
  const authenticated = useProductStore((state) => state.authenticated)
  const results = useQueries({
    queries: [
      {
        queryKey: ["session"],
        queryFn: api.me,
        enabled: remoteMode && !authenticated,
        retry: false,
      },
      { queryKey: ["uavs"], queryFn: () => api.uavs(), enabled: remoteMode && authenticated },
      { queryKey: ["alerts"], queryFn: api.alerts, enabled: remoteMode && authenticated },
      { queryKey: ["pods"], queryFn: api.pods, enabled: remoteMode && authenticated },
      { queryKey: ["bindings"], queryFn: api.bindings, enabled: remoteMode && authenticated },
      { queryKey: ["users"], queryFn: api.users, enabled: remoteMode && authenticated },
      { queryKey: ["goods"], queryFn: api.goods, enabled: remoteMode && authenticated },
      { queryKey: ["orders"], queryFn: api.orders, enabled: remoteMode && authenticated },
      { queryKey: ["tasks"], queryFn: api.tasks, enabled: remoteMode && authenticated },
    ],
  })

  useEffect(() => {
    if (!remoteMode) return
    const [session, uavs, alerts, pods, bindings, users, goods, orders, tasks] = results
    if (!authenticated && session.isSuccess) {
      useProductStore.setState({ authenticated: true, staff: session.data })
    }
    if (!authenticated) return
    useProductStore.setState({
      ...(uavs.data ? { uavs: uavs.data.items } : {}),
      ...(alerts.data ? { alerts: alerts.data } : {}),
      ...(pods.data ? { pods: pods.data } : {}),
      ...(bindings.data ? { bindings: bindings.data } : {}),
      ...(users.data ? { users: users.data.items } : {}),
      ...(goods.data ? { goods: goods.data.items } : {}),
      ...(orders.data ? { orders: orders.data.items } : {}),
      ...(tasks.data ? { tasks: tasks.data.items } : {}),
    })
  }, [authenticated, results])

  useEffect(() => {
    if (!remoteMode || !authenticated) return
    const controller = new AbortController()
    void streamTelemetry(
      (event) => {
        if (event.event !== "telemetry") return
        const parsed = z.array(uavSchema).safeParse(event.data)
        if (parsed.success) useProductStore.setState({ uavs: parsed.data })
      },
      () => {},
      controller.signal
    )
    return () => controller.abort()
  }, [authenticated])

  return null
}
