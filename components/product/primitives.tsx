"use client"

import type { ReactNode } from "react"

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Section({
  title,
  action,
  children,
  tone,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  tone?: "dark"
}) {
  return (
    <section className={tone === "dark" ? "flat-section section-dark" : "flat-section"}>
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function StatusPill({ value }: { value: string }) {
  const kind = ["ONLINE", "ACKNOWLEDGED", "ARRIVED", "FINISHED", "CLOSED", "LOW"].includes(value)
    ? "success"
    : ["FLYING", "SENT", "DISPATCHING", "DELIVERING", "OPEN", "MID"].includes(value)
      ? "info"
      : ["CHARGING", "QUEUED", "WAITING", "CREATED"].includes(value)
        ? "warning"
        : ["FAILED", "TIMEOUT", "ERROR", "HIGH"].includes(value)
          ? "danger"
          : "neutral"
  return <span className={`status status-${kind}`}>{value}</span>
}

export function MetricStrip({
  items,
}: {
  items: { label: string; value: string | number; detail?: string }[]
}) {
  return (
    <dl className="metric-strip">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.detail && <small>{item.detail}</small>}
        </div>
      ))}
    </dl>
  )
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">—</span>
      <p>{title}</p>
      {action}
    </div>
  )
}

export function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      <small className={error ? "field-error" : "field-help"}>{error ?? "\u00a0"}</small>
    </label>
  )
}
