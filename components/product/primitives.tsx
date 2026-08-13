"use client"

import { cloneElement, isValidElement, useId, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field as UiField, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

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
        <span className="section-title">
          <i aria-hidden="true" />
          <h2>{title}</h2>
        </span>
        {action}
      </div>
      {children}
    </section>
  )
}

export function StatusPill({ value }: { value: string }) {
  const kind = [
    "ONLINE",
    "ACKNOWLEDGED",
    "ARRIVED",
    "FINISHED",
    "CLOSED",
    "LOW",
    "ENABLED",
    "RESOLVED",
  ].includes(value)
    ? "success"
    : ["FLYING", "SENT", "DISPATCHING", "DELIVERING", "OPEN", "MID"].includes(value)
      ? "info"
      : ["CHARGING", "QUEUED", "WAITING", "CREATED"].includes(value)
        ? "warning"
        : ["FAILED", "TIMEOUT", "ERROR", "HIGH"].includes(value)
          ? "danger"
          : "neutral"
  return (
    <Badge variant="outline" className={`status status-${kind}`}>
      <i aria-hidden="true" />
      {value}
    </Badge>
  )
}

export function MetricStrip({
  items,
}: {
  items: { label: string; value: string | number; detail?: string }[]
}) {
  return (
    <dl className="metric-strip">
      {items.map((item, index) => (
        <div key={item.label}>
          <span className="metric-index" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
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
    <Empty className="empty-state">
      <EmptyHeader>
        <EmptyMedia>
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

export function ConfirmAction({
  trigger,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
}: {
  trigger: ReactNode
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="app-alert-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void onConfirm()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ActionTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  )
}

export function PaginationControls({
  page,
  totalPages,
  pending = false,
  locale,
  onPageChange,
}: {
  page: number
  totalPages: number
  pending?: boolean
  locale: string
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null

  const chinese = locale === "zh-CN"
  return (
    <Pagination className="pagination-line" aria-label={chinese ? "分页" : "Pagination"}>
      <PaginationContent>
        <PaginationItem>
          <Button
            variant="outline"
            className="button button-secondary"
            disabled={page <= 1 || pending}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft aria-hidden="true" />
            {chinese ? "上一页" : "Previous"}
          </Button>
        </PaginationItem>
        <PaginationItem>
          <span className="pagination-current" aria-current="page">
            <span className="sr-only">{chinese ? "当前页" : "Current page"}</span>
            {page} / {totalPages}
          </span>
        </PaginationItem>
        <PaginationItem>
          <Button
            variant="outline"
            className="button button-secondary"
            disabled={page >= totalPages || pending}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          >
            {chinese ? "下一页" : "Next"}
            <ChevronRight aria-hidden="true" />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
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
  const generatedId = useId()
  const control = isValidElement<{ id?: string; "aria-invalid"?: boolean }>(children)
    ? cloneElement(children, {
        id: children.props.id ?? generatedId,
        "aria-invalid": Boolean(error) || children.props["aria-invalid"],
      })
    : children
  const controlId = isValidElement<{ id?: string }>(control) ? control.props.id : undefined

  return (
    <UiField className="field" data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
      {control}
      {error ? (
        <FieldError className="field-error">{error}</FieldError>
      ) : (
        <FieldDescription className="field-help">{"\u00a0"}</FieldDescription>
      )}
    </UiField>
  )
}
