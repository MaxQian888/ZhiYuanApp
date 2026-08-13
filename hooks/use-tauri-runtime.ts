"use client"

import { useSyncExternalStore } from "react"
import { isTauri } from "@/lib/tauri"

const subscribe = () => () => undefined
const getServerSnapshot = () => false

export function useTauriRuntime(): boolean {
  return useSyncExternalStore(subscribe, isTauri, getServerSnapshot)
}
