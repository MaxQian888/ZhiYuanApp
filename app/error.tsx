"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"

/**
 * Catches a render or data error inside a route and keeps the rest of the shell alive.
 *
 * The console is used to watch a fleet in flight. One view throwing must not blank the
 * window — the operator needs to be able to get back to the map. So this shows what failed,
 * offers a retry that re-renders the segment, and leaves a way out to the dashboard.
 *
 * The error message is shown rather than hidden behind "something went wrong": the people
 * using this are operators with a support channel, and "cannot read property code of
 * undefined" is something they can paste into it. A message they cannot repeat is a message
 * that costs an hour of someone's day.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Route error", error)
  }, [error])

  return (
    <div className="route-error" role="alert">
      <span className="brand-mark">鸢</span>
      <h1>页面加载失败 · This view failed to load</h1>
      <p className="route-error-detail">{error.message}</p>
      {error.digest && <code>digest {error.digest}</code>}
      <div className="route-error-actions">
        <Button className="button button-primary" onClick={reset}>
          重试 · Retry
        </Button>
        <Button variant="outline" className="button button-secondary" asChild>
          <Link href="/">返回总览 · Dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
