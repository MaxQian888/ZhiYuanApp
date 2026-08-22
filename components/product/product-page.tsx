"use client"

import { AppShell } from "@/components/product/app-shell"
import { DashboardView } from "@/components/product/views/dashboard-view"
import { UavDetailView, UavListView } from "@/components/product/views/fleet-view"
import { GoodsView } from "@/components/product/views/goods-view"
import { LoginView } from "@/components/product/views/login-view"
import { MapView } from "@/components/product/views/map-view"
import { OperationsView } from "@/components/product/views/operations-view"
import { OrdersView } from "@/components/product/views/orders-view"
import { SettingsView } from "@/components/product/views/settings-view"
import { TasksView } from "@/components/product/views/tasks-view"
import { UsersView } from "@/components/product/views/users-view"
import { VoiceView } from "@/components/product/views/voice-view"
import { Spinner } from "@/components/ui/spinner"
import { isRemoteApi } from "@/lib/env"
import { useProductStore } from "@/stores/product-store"

export type ProductView =
  | "dashboard"
  | "uavs"
  | "uav-detail"
  | "map"
  | "voice"
  | "alerts"
  | "logs"
  | "pods"
  | "users"
  | "goods"
  | "orders"
  | "order-detail"
  | "tasks"
  | "settings"
  | "login"

/**
 * Shown while a stored session is being exchanged for an access token.
 *
 * The alternative — rendering the login form until recovery finishes — puts a sign-in
 * prompt in front of someone who is already signed in, for as long as the round trip takes.
 * Operators reasonably read that as "I have been logged out" and start typing.
 */
function SessionRecovery({ locale }: { locale: string }) {
  return (
    <div className="session-recovery" role="status" aria-live="polite">
      <span className="brand-mark">鸢</span>
      <Spinner />
      <p>{locale === "zh-CN" ? "正在恢复会话…" : "Restoring session…"}</p>
    </div>
  )
}

/**
 * Maps a route to its view.
 *
 * Each view owns its own data, forms and dialogs; this component owns only the choice
 * between them and the authentication gate in front of them all. The route modules live in
 * `components/product/views/`.
 */
export function ProductPage({ view }: { view: ProductView }) {
  const authenticated = useProductStore((state) => state.authenticated)
  const sessionRecoveryPending = useProductStore((state) => state.sessionRecoveryPending)
  const locale = useProductStore((state) => state.locale)
  if (view === "login") return <LoginView />
  if (!authenticated) {
    return sessionRecoveryPending ? <SessionRecovery locale={locale} /> : <LoginView />
  }
  const content =
    view === "dashboard" ? (
      <DashboardView />
    ) : view === "uavs" ? (
      <UavListView />
    ) : view === "uav-detail" ? (
      <UavDetailView />
    ) : view === "map" ? (
      <MapView />
    ) : view === "voice" ? (
      <VoiceView />
    ) : view === "alerts" || view === "logs" || view === "pods" ? (
      <OperationsView view={view} />
    ) : view === "users" ? (
      <UsersView />
    ) : view === "goods" ? (
      <GoodsView />
    ) : view === "orders" ? (
      <OrdersView />
    ) : view === "order-detail" ? (
      <OrdersView detail />
    ) : view === "tasks" ? (
      <TasksView />
    ) : (
      <SettingsView />
    )
  return (
    <AppShell>
      <main className="product-page" data-view={view}>
        {content}
        <footer className="app-footer">
          © 2026 · ZHIYUAN OPERATIONS · API v1 · {isRemoteApi ? "REMOTE" : "SIMULATOR"}
        </footer>
      </main>
    </AppShell>
  )
}
