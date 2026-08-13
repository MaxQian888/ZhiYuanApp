export type SyncResourceResult = {
  key: string
  isPending: boolean
  isError: boolean
}

export const syncResourceKeys = [
  "uavs",
  "alerts",
  "pods",
  "bindings",
  "users",
  "goods",
  "orders",
  "tasks",
  "commands",
] as const

export function deriveDataSyncState(results: SyncResourceResult[]) {
  return {
    pending: results.some((result) => result.isPending),
    failedResources: results.filter((result) => result.isError).map((result) => result.key),
  }
}
