"use client"

/**
 * The handful of things every view needs and none of them owns.
 *
 * This is a deliberately small module. It holds the two query states, the pending-button
 * label, the toast wrapper and the URL-id hook — the pieces that would otherwise be copied
 * into nine route modules and drift apart. Anything larger or more opinionated than this
 * belongs in `primitives.tsx` or in the view that uses it.
 */

import { AlertTriangle } from "lucide-react"
import { type ReactNode, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

export function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function QueryLoading({ locale }: { locale: string }) {
  return (
    <div className="query-state" role="status">
      <Skeleton className="query-state-skeleton" aria-hidden="true" />
      <span>{locale === "zh-CN" ? "正在加载数据…" : "Loading data…"}</span>
    </div>
  )
}

export function QueryError({ locale, onRetry }: { locale: string; onRetry: () => void }) {
  return (
    <Alert className="query-state query-error">
      <AlertTriangle aria-hidden="true" />
      <AlertDescription>
        {locale === "zh-CN" ? "数据加载失败" : "Failed to load data"}
      </AlertDescription>
      <Button variant="outline" onClick={onRetry}>
        {locale === "zh-CN" ? "重试" : "Retry"}
      </Button>
    </Alert>
  )
}

export function PendingLabel({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean
  pendingLabel: string
  children: ReactNode
}) {
  return pending ? (
    <>
      <Spinner data-icon="inline-start" />
      {pendingLabel}
    </>
  ) : (
    children
  )
}

export async function executeAction<T>(action: () => Promise<T>, locale: string, success?: string) {
  try {
    const result = await action()
    if (success) toast.success(success)
    return { ok: true as const, value: result }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    toast.error(locale === "zh-CN" ? `操作失败：${detail}` : `Action failed: ${detail}`)
    return { ok: false as const }
  }
}

export function useUrlId(fallback: number) {
  const search = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("popstate", onChange)
      return () => window.removeEventListener("popstate", onChange)
    },
    () => window.location.search,
    () => ""
  )
  const parsed = Number(new URLSearchParams(search).get("id"))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
