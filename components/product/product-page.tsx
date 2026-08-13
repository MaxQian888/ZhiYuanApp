"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { useForm, useWatch } from "react-hook-form"
import {
  AlertTriangle,
  Battery,
  Check,
  ChevronRight,
  Crosshair,
  Database,
  LocateFixed,
  MapPin,
  Mic,
  Minus,
  Plane,
  Plus,
  Radio,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCog,
  Warehouse,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppShell } from "@/components/product/app-shell"
import {
  ActionTooltip,
  ConfirmAction,
  EmptyState,
  Field,
  MetricStrip,
  PageHeader,
  PaginationControls,
  Section,
  StatusPill,
} from "@/components/product/primitives"
import {
  filterUavs,
  parseVoiceCommand,
  type CommandType,
  type Goods,
  type ManagedUser,
  type StaffAccount,
  type UavStatus,
} from "@/lib/domain"
import { useCopy } from "@/lib/i18n-product"
import { api } from "@/lib/api/client"
import { resumeSessionRecovery, suppressSessionRecovery } from "@/lib/api/client"
import { isRemoteApi } from "@/lib/env"
import { checkForAppUpdate, getPlatformInfo, isTauri, type PlatformInfo } from "@/lib/tauri"
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

const staffAccountFormSchema = z
  .object({
    id: z.number().int().positive().optional(),
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9._-]+$/),
    displayName: z.string().trim().min(1).max(80),
    phone: z.string().regex(/^1[3-9]\d{9}$/),
    password: z
      .string()
      .trim()
      .refine((password) => !password || (password.length >= 8 && password.length <= 72)),
    role: z.enum(["admin", "manager"]),
    enabled: z.boolean(),
  })
  .superRefine((account, context) => {
    if (!account.id && !account.password) {
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: "An initial password is required",
      })
    }
  })

type StaffAccountForm = z.infer<typeof staffAccountFormSchema>

const profileFormSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^1[3-9]\d{9}$/),
})

type ProfileForm = z.infer<typeof profileFormSchema>

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function QueryLoading({ locale }: { locale: string }) {
  return (
    <div className="query-state" role="status">
      <Skeleton className="query-state-skeleton" aria-hidden="true" />
      <span>{locale === "zh-CN" ? "正在加载数据…" : "Loading data…"}</span>
    </div>
  )
}

function QueryError({ locale, onRetry }: { locale: string; onRetry: () => void }) {
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

function PendingLabel({
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

async function executeAction<T>(action: () => Promise<T>, locale: string, success?: string) {
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

function useUrlId(fallback: number) {
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

function DashboardView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const openAlerts = store.alerts.filter((item) => !item.resolved)
  const activeTasks = store.tasks.filter(
    (item) => item.taskStatus === "WAITING" || item.taskStatus === "FLYING"
  )
  const online = store.uavs.filter((item) => item.status !== "OFFLINE")
  return (
    <>
      <PageHeader
        title={copy.dashboardTitle}
        description={copy.dashboardDescription}
        actions={
          <Button asChild className="button button-primary">
            <Link href="/uavs">
              <Plane data-icon="inline-start" />
              {copy.uavs}
            </Link>
          </Button>
        }
      />
      <MetricStrip
        items={[
          {
            label: copy.totalUav,
            value: store.uavs.length,
            detail: `${online.length} ${copy.live.toLowerCase()}`,
          },
          {
            label: copy.onlineUav,
            value: online.length,
            detail: `${Math.round((online.length / store.uavs.length) * 100)}%`,
          },
          {
            label: copy.inPod,
            value: store.uavs.filter((item) => item.inHibernatePod).length,
            detail: `${store.pods.length} pods`,
          },
          {
            label: copy.openAlerts,
            value: openAlerts.length,
            detail: `${openAlerts.filter((item) => item.level === "HIGH").length} HIGH`,
          },
        ]}
      />
      <div className="workbench-grid">
        <Section
          title={copy.telemetry}
          action={
            <span className="connection">
              <i />
              {store.realtimeState === "live"
                ? copy.live
                : store.realtimeState === "reconnecting"
                  ? store.locale === "zh-CN"
                    ? "重连中"
                    : "Reconnecting"
                  : store.locale === "zh-CN"
                    ? "离线数据"
                    : "Offline data"}{" "}
              · {copy.simulator}
            </span>
          }
        >
          <div className="telemetry-list">
            {store.uavs.slice(0, 5).map((uav) => (
              <Link href={`/uavs/detail?id=${uav.id}`} className="telemetry-row" key={uav.id}>
                <span className="telemetry-code">{uav.code}</span>
                <span>
                  <strong>{uav.name}</strong>
                  <small>
                    {uav.region} · {uav.altitude}m · {uav.speed}m/s
                  </small>
                </span>
                <span className="battery-readout">
                  <Battery size={16} />
                  {uav.battery}%
                </span>
                <StatusPill value={uav.status} />
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </Section>
        <Section
          title={copy.recentAlerts}
          action={
            <Link className="text-link" href="/alerts">
              {copy.viewAll} →
            </Link>
          }
        >
          <div className="alert-list">
            {openAlerts.map((alert) => (
              <div className="alert-row" key={alert.id}>
                <AlertTriangle size={18} />
                <span>
                  <strong>{alert.title}</strong>
                  <small>{formatDate(alert.occurredAt, store.locale)}</small>
                </span>
                <StatusPill value={alert.level} />
                <Button
                  className="text-button"
                  onClick={() =>
                    void executeAction(
                      () =>
                        alert.status === "OPEN"
                          ? store.acknowledgeAlert(alert.id)
                          : store.resolveAlert(alert.id),
                      store.locale,
                      alert.status === "OPEN"
                        ? copy.acknowledge
                        : store.locale === "zh-CN"
                          ? "解除告警"
                          : "Resolve alert"
                    )
                  }
                >
                  {alert.status === "OPEN"
                    ? copy.acknowledge
                    : store.locale === "zh-CN"
                      ? "解除"
                      : "Resolve"}
                </Button>
              </div>
            ))}
          </div>
        </Section>
      </div>
      <Section title={copy.activeTasks} tone="dark">
        <div className="dark-table">
          {activeTasks.map((task) => (
            <div key={task.id}>
              <span>TSK-{String(task.id).padStart(4, "0")}</span>
              <strong>{store.orders.find((item) => item.id === task.orderId)?.orderNo}</strong>
              <span>{store.uavs.find((item) => item.id === task.uavId)?.code}</span>
              <StatusPill value={task.taskStatus} />
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function UavListView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<UavStatus | "ALL">("ALL")
  const [region, setRegion] = useState("ALL")
  const [page, setPage] = useState(1)
  const size = 10
  const regions = [...new Set(store.uavs.map((item) => item.region))]
  const serverPage = useQuery({
    queryKey: ["uavs-page", query, status, region, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      if (query.trim()) params.set("q", query.trim())
      if (status !== "ALL") params.set("status", status)
      if (region !== "ALL") params.set("region", region)
      return api.uavs(`?${params}`)
    },
    enabled: isRemoteApi,
    placeholderData: (previous) => previous,
  })
  const filtered = filterUavs(store.uavs, query, status).filter(
    (item) => region === "ALL" || item.region === region
  )
  const rows = isRemoteApi
    ? (serverPage.data?.items ?? []).map(
        (item) => store.uavs.find((candidate) => candidate.id === item.id) ?? item
      )
    : filtered.slice((page - 1) * size, page * size)
  const total = isRemoteApi ? (serverPage.data?.total ?? 0) : filtered.length
  const totalPages = isRemoteApi
    ? (serverPage.data?.totalPages ?? 1)
    : Math.max(1, Math.ceil(filtered.length / size))
  return (
    <>
      <PageHeader
        title={copy.uavs}
        description={
          store.locale === "zh-CN"
            ? "搜索、筛选并进入任意设备的遥测与控制工作台。"
            : "Search and filter the fleet, then open telemetry and controls."
        }
        actions={
          <Button asChild variant="outline" className="button button-secondary">
            <Link href="/map">
              <MapPin data-icon="inline-start" />
              {copy.map}
            </Link>
          </Button>
        }
      />
      <div className="filter-bar">
        <label className="search-field">
          <Search size={17} />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder={copy.searchUav}
          />
        </label>
        <label>
          <span className="sr-only">{copy.status}</span>
          <NativeSelect
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as UavStatus | "ALL")
              setPage(1)
            }}
          >
            <NativeSelectOption value="ALL">{copy.allStatus}</NativeSelectOption>
            {["ONLINE", "OFFLINE", "FLYING", "CHARGING"].map((value) => (
              <NativeSelectOption key={value}>{value}</NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span className="sr-only">{copy.region}</span>
          <NativeSelect
            value={region}
            onChange={(event) => {
              setRegion(event.target.value)
              setPage(1)
            }}
          >
            <NativeSelectOption value="ALL">
              {store.locale === "zh-CN" ? "全部区域" : "All regions"}
            </NativeSelectOption>
            {regions.map((value) => (
              <NativeSelectOption key={value}>{value}</NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <Section title={`${copy.uavs} · ${total}`}>
        {isRemoteApi && serverPage.isError ? (
          <QueryError locale={store.locale} onRetry={() => void serverPage.refetch()} />
        ) : isRemoteApi && serverPage.isPending ? (
          <QueryLoading locale={store.locale} />
        ) : rows.length ? (
          <div className="data-table">
            <div className="table-head">
              <span>{copy.uavs}</span>
              <span>{copy.status}</span>
              <span>{copy.owner}</span>
              <span>{copy.region}</span>
              <span>{copy.battery}</span>
              <span>{copy.updated}</span>
              <span>{copy.action}</span>
            </div>
            {rows.map((uav) => (
              <div className="table-row" key={uav.id}>
                <span data-label={copy.uavs}>
                  <strong>{uav.code}</strong>
                  <small>
                    {uav.name} · {uav.model}
                    <br />
                    {uav.rfidTag}
                  </small>
                </span>
                <span data-label={copy.status}>
                  <StatusPill value={uav.status} />
                </span>
                <span data-label={copy.owner}>{uav.ownerName}</span>
                <span data-label={copy.region}>{uav.region}</span>
                <span data-label={copy.battery}>
                  <Progress
                    className="battery-line"
                    value={uav.battery}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uav.battery}
                    aria-label={`${copy.battery} ${uav.battery}%`}
                  />
                  {uav.battery}%
                </span>
                <span data-label={copy.updated}>{formatDate(uav.updatedAt, store.locale)}</span>
                <span data-label={copy.action}>
                  <Link className="text-link" href={`/uavs/detail?id=${uav.id}`}>
                    {copy.details} →
                  </Link>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={copy.noResults} />
        )}
        <PaginationControls
          page={page}
          totalPages={totalPages}
          pending={serverPage.isFetching}
          locale={store.locale}
          onPageChange={setPage}
        />
      </Section>
    </>
  )
}

function CommandDialogView({
  uavId,
  command,
  onClose,
}: {
  uavId: number
  command: CommandType | null
  onClose: () => void
}) {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const uav = store.uavs.find((item) => item.id === uavId)
  const [pending, setPending] = useState(false)
  if (!command || !uav) return null
  const names: Record<CommandType, string> = {
    TAKE_OFF: copy.takeOff,
    LAND: copy.land,
    RETURN_HOME: copy.returnHome,
    STOP: copy.stop,
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.commandConfirm}</DialogTitle>
          <DialogDescription>
            {uav.code} · {uav.name}
            <br />
            {copy.commandHint}
          </DialogDescription>
        </DialogHeader>
        <div className="command-review">
          <span>{names[command]}</span>
          <code>{command}</code>
        </div>
        <DialogFooter>
          <Button variant="outline" className="button button-secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            className={command === "STOP" ? "button button-danger" : "button button-primary"}
            disabled={pending}
            data-state={pending ? "loading" : undefined}
            onClick={() => {
              setPending(true)
              void executeAction(
                () => store.sendCommand(uavId, command, "MANUAL"),
                store.locale,
                copy.commandSent
              ).then((result) => {
                setPending(false)
                if (result.ok) onClose()
              })
            }}
          >
            <PendingLabel
              pending={pending}
              pendingLabel={store.locale === "zh-CN" ? "发送中…" : "Sending…"}
            >
              {copy.confirm}
            </PendingLabel>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UavDetailView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const id = useUrlId(store.selectedUavId)
  const uav = store.uavs.find((item) => item.id === id) ?? store.uavs[0]
  const [command, setCommand] = useState<CommandType | null>(null)
  const [retryingCommandId, setRetryingCommandId] = useState<string | null>(null)
  const commands = store.commands.filter((item) => item.uavId === uav?.id)
  const serverFlightLogs = useQuery({
    queryKey: ["flight-logs", uav?.id],
    queryFn: () => api.flightLogs(uav!.id),
    enabled: isRemoteApi && Boolean(uav),
  })
  const logs = isRemoteApi
    ? (serverFlightLogs.data ?? [])
    : store.flightLogs.filter((item) => item.uavId === uav?.id)
  if (!uav) return <QueryLoading locale={store.locale} />
  return (
    <>
      <PageHeader
        title={`${uav.code} · ${uav.name}`}
        description={`${uav.model} · ${uav.rfidTag}`}
        actions={
          <>
            <StatusPill value={uav.status} />
            <Button asChild variant="outline" className="button button-secondary">
              <Link href={`/map?id=${uav.id}`}>
                <MapPin data-icon="inline-start" />
                {copy.map}
              </Link>
            </Button>
          </>
        }
      />
      <MetricStrip
        items={[
          { label: copy.battery, value: `${uav.battery}%` },
          { label: store.locale === "zh-CN" ? "高度" : "Altitude", value: `${uav.altitude} m` },
          { label: store.locale === "zh-CN" ? "速度" : "Speed", value: `${uav.speed} m/s` },
          { label: "GPS", value: `${uav.latitude}, ${uav.longitude}` },
        ]}
      />
      <div className="workbench-grid">
        <Section title={store.locale === "zh-CN" ? "设备档案" : "Device profile"}>
          <dl className="definition-list">
            <div>
              <dt>{copy.owner}</dt>
              <dd>{uav.ownerName}</dd>
            </div>
            <div>
              <dt>{copy.region}</dt>
              <dd>{uav.region}</dd>
            </div>
            <div>
              <dt>{copy.inPod}</dt>
              <dd>
                {uav.inHibernatePod
                  ? store.locale === "zh-CN"
                    ? "是"
                    : "Yes"
                  : store.locale === "zh-CN"
                    ? "否"
                    : "No"}
              </dd>
            </div>
            <div>
              <dt>{copy.updated}</dt>
              <dd>{formatDate(uav.updatedAt, store.locale)}</dd>
            </div>
          </dl>
        </Section>
        <Section title={store.locale === "zh-CN" ? "快捷控制" : "Quick controls"}>
          <div className="command-grid">
            <Button
              variant="outline"
              className="command-button"
              onClick={() => setCommand("TAKE_OFF")}
            >
              <Plane />
              {copy.takeOff}
              <code>TAKE_OFF</code>
            </Button>
            <Button variant="outline" className="command-button" onClick={() => setCommand("LAND")}>
              <LocateFixed />
              {copy.land}
              <code>LAND</code>
            </Button>
            <Button
              variant="outline"
              className="command-button"
              onClick={() => setCommand("RETURN_HOME")}
            >
              <RotateCcw />
              {copy.returnHome}
              <code>RETURN_HOME</code>
            </Button>
            <Button
              variant="destructive"
              className="command-button command-danger"
              onClick={() => setCommand("STOP")}
            >
              <X />
              {copy.stop}
              <code>STOP</code>
            </Button>
          </div>
        </Section>
      </div>
      <Section title={store.locale === "zh-CN" ? "指令回执" : "Command receipts"}>
        {commands.length ? (
          <div className="timeline">
            {commands.map((item) => (
              <div key={item.id}>
                <Radio size={16} />
                <span>
                  <strong>{item.type}</strong>
                  <small>
                    {item.source} · {formatDate(item.createdAt, store.locale)}
                  </small>
                </span>
                <div className="command-receipt-actions">
                  <StatusPill value={item.status} />
                  {(item.status === "FAILED" || item.status === "TIMEOUT") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={retryingCommandId === item.id}
                      onClick={() => {
                        setRetryingCommandId(item.id)
                        void executeAction(
                          () =>
                            store.sendCommand(item.uavId, item.type, item.source, item.transcript),
                          store.locale,
                          store.locale === "zh-CN" ? "重试指令已发送" : "Retry sent"
                        ).then(() => setRetryingCommandId(null))
                      }}
                    >
                      {retryingCommandId === item.id ? <Spinner /> : <RotateCcw />}
                      {store.locale === "zh-CN" ? "重试" : "Retry"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={copy.noResults} />
        )}
      </Section>
      <Section title={copy.logs}>
        {isRemoteApi && serverFlightLogs.isPending ? (
          <QueryLoading locale={store.locale} />
        ) : isRemoteApi && serverFlightLogs.isError ? (
          <QueryError locale={store.locale} onRetry={() => void serverFlightLogs.refetch()} />
        ) : logs.length ? (
          <div className="timeline">
            {logs.map((item) => (
              <div key={item.id}>
                <Database size={16} />
                <span>
                  <strong>{item.event}</strong>
                  <small>
                    {item.detail} · {formatDate(item.occurredAt, store.locale)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={copy.noResults} />
        )}
      </Section>
      <CommandDialogView uavId={uav.id} command={command} onClose={() => setCommand(null)} />
    </>
  )
}

interface MapProvider {
  name: string
  project: (
    latitude: number,
    longitude: number,
    bounds: {
      centerLatitude: number
      centerLongitude: number
      latitudeSpan: number
      longitudeSpan: number
    }
  ) => { x: number; y: number }
}

const testMapProvider: MapProvider = {
  name: "TEST MAP PROVIDER",
  project: (latitude, longitude, bounds) => ({
    x: 50 + ((longitude - bounds.centerLongitude) / bounds.longitudeSpan) * 84,
    y: 30 - ((latitude - bounds.centerLatitude) / bounds.latitudeSpan) * 48,
  }),
}

function MapView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const id = useUrlId(store.selectedUavId)
  const [selected, setSelected] = useState(id)
  const [zoom, setZoom] = useState(7)
  const [mapCenter, setMapCenter] = useState<{ latitude: number; longitude: number } | null>(null)
  const uav = store.uavs.find((item) => item.id === selected) ?? store.uavs[0]
  const serverFlightLogs = useQuery({
    queryKey: ["flight-logs", uav?.id],
    queryFn: () => api.flightLogs(uav!.id),
    enabled: isRemoteApi && Boolean(uav),
  })
  const mapFlightLogs = isRemoteApi
    ? (serverFlightLogs.data ?? [])
    : store.flightLogs.filter((item) => item.uavId === uav?.id)
  if (!uav) return <QueryLoading locale={store.locale} />
  const coordinateLogs = mapFlightLogs
    .filter(
      (item): item is typeof item & { latitude: number; longitude: number } =>
        item.latitude !== undefined && item.longitude !== undefined
    )
    .toSorted((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  const coordinates = [
    ...coordinateLogs.map((item) => ({ latitude: item.latitude, longitude: item.longitude })),
    { latitude: uav.latitude, longitude: uav.longitude },
  ]
  const minLatitude = Math.min(...coordinates.map((point) => point.latitude))
  const maxLatitude = Math.max(...coordinates.map((point) => point.latitude))
  const minLongitude = Math.min(...coordinates.map((point) => point.longitude))
  const maxLongitude = Math.max(...coordinates.map((point) => point.longitude))
  const zoomFactor = 7 / zoom
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.02) * zoomFactor
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.02) * zoomFactor
  const centerLatitude = mapCenter?.latitude ?? (minLatitude + maxLatitude) / 2
  const centerLongitude = mapCenter?.longitude ?? (minLongitude + maxLongitude) / 2
  const project = (latitude: number, longitude: number) =>
    testMapProvider.project(latitude, longitude, {
      centerLatitude,
      centerLongitude,
      latitudeSpan,
      longitudeSpan,
    })
  const trackPoints = coordinateLogs.map((item) => project(item.latitude, item.longitude))
  const currentPoint = project(uav.latitude, uav.longitude)
  const visibleTrack = [...trackPoints, currentPoint]
  return (
    <>
      <PageHeader
        title={copy.map}
        description={
          store.locale === "zh-CN"
            ? "内置可交互测试提供方；替换 provider 即可接入生产地图。"
            : "Interactive test provider. Replace the provider to connect a production map."
        }
      />
      <div className="map-workbench">
        <aside>
          <label>
            {copy.uavs}
            <NativeSelect
              value={selected}
              onChange={(event) => {
                setSelected(Number(event.target.value))
                setMapCenter(null)
                setZoom(7)
              }}
            >
              {store.uavs.map((item) => (
                <NativeSelectOption value={item.id} key={item.id}>
                  {item.code} · {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <dl className="definition-list">
            <div>
              <dt>GPS</dt>
              <dd>
                {uav.latitude}, {uav.longitude}
              </dd>
            </div>
            <div>
              <dt>{copy.status}</dt>
              <dd>
                <StatusPill value={uav.status} />
              </dd>
            </div>
            <div>
              <dt>{copy.track}</dt>
              <dd>
                {isRemoteApi && serverFlightLogs.isPending ? (
                  <Spinner aria-label={store.locale === "zh-CN" ? "加载轨迹" : "Loading track"} />
                ) : isRemoteApi && serverFlightLogs.isError ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="text-button"
                    onClick={() => void serverFlightLogs.refetch()}
                  >
                    {store.locale === "zh-CN" ? "重试" : "Retry"}
                  </Button>
                ) : (
                  `${mapFlightLogs.length} ${store.locale === "zh-CN" ? "个事件点" : "events"}`
                )}
              </dd>
            </div>
          </dl>
        </aside>
        <div className="test-map" role="img" aria-label={`${copy.map}: ${uav.code}`}>
          <div className="map-grid" aria-hidden="true">
            {Array.from({ length: 11 }, (_, index) => {
              const position = `${(index + 1) * (100 / 12)}%`
              return (
                <span key={position}>
                  <i
                    className="map-grid-x"
                    style={{ "--grid-position": position } as React.CSSProperties}
                  />
                  <i
                    className="map-grid-y"
                    style={{ "--grid-position": position } as React.CSSProperties}
                  />
                </span>
              )
            })}
          </div>
          {trackPoints.length ? (
            <svg viewBox="0 0 100 60" role="img" aria-label={`${uav.code} ${copy.track}`}>
              <polyline points={visibleTrack.map((point) => `${point.x},${point.y}`).join(" ")} />
              {trackPoints.map((point, index) => (
                <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="1.8">
                  <title>{coordinateLogs[index]?.event}</title>
                </circle>
              ))}
              <circle cx={currentPoint.x} cy={currentPoint.y} r="2.8">
                <title>{store.locale === "zh-CN" ? "当前位置" : "Current position"}</title>
              </circle>
            </svg>
          ) : (
            <span className="map-empty-track">
              {store.locale === "zh-CN"
                ? "暂无轨迹数据，仅显示当前位置"
                : "No track data; showing current position"}
            </span>
          )}
          <div
            className="map-marker"
            style={{
              left: `${currentPoint.x}%`,
              top: `${(currentPoint.y / 60) * 100}%`,
              transform: `scale(${0.85 + zoom * 0.03})`,
            }}
          >
            <Plane />
            <span>{uav.code}</span>
          </div>
          <div className="map-controls">
            <ActionTooltip label={copy.zoomIn}>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoom((value) => Math.min(12, value + 1))}
                aria-label={copy.zoomIn}
              >
                <Plus />
              </Button>
            </ActionTooltip>
            <ActionTooltip label={copy.zoomOut}>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoom((value) => Math.max(3, value - 1))}
                aria-label={copy.zoomOut}
              >
                <Minus />
              </Button>
            </ActionTooltip>
            <ActionTooltip label={copy.center}>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setMapCenter({ latitude: uav.latitude, longitude: uav.longitude })}
                aria-label={copy.center}
              >
                <Crosshair />
              </Button>
            </ActionTooltip>
          </div>
          <span className="provider-label">
            {testMapProvider.name} · Z{zoom}
          </span>
        </div>
      </div>
    </>
  )
}

function VoiceView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [recording, setRecording] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [parsed, setParsed] = useState<ReturnType<typeof parseVoiceCommand>>(null)
  const supported = useSyncExternalStore(
    () => () => undefined,
    () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    () => false
  )
  const parse = (value: string) => {
    const result = parseVoiceCommand(value, store.uavs)
    setParsed(result)
    setError(result ? "" : copy.ambiguous)
  }
  const record = () => {
    if (!supported) {
      setError(copy.unsupported)
      return
    }
    setRecording(true)
    setError("")
    const SpeechRecognitionCtor =
      (
        window as unknown as {
          SpeechRecognition?: new () => {
            lang: string
            onresult: (event: { results: { 0: { transcript: string } }[] }) => void
            onerror: () => void
            onend: () => void
            start: () => void
            stop: () => void
          }
          webkitSpeechRecognition?: new () => {
            lang: string
            onresult: (event: { results: { 0: { transcript: string } }[] }) => void
            onerror: () => void
            onend: () => void
            start: () => void
            stop: () => void
          }
        }
      ).SpeechRecognition ??
      (
        window as unknown as {
          webkitSpeechRecognition: new () => {
            lang: string
            onresult: (event: { results: { 0: { transcript: string } }[] }) => void
            onerror: () => void
            onend: () => void
            start: () => void
            stop: () => void
          }
        }
      ).webkitSpeechRecognition
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = store.locale === "zh-CN" ? "zh-CN" : "en-US"
    recognition.onresult = (event) => {
      const value = event.results[0][0].transcript
      setText(value)
      parse(value)
    }
    recognition.onerror = () => setError(copy.unsupported)
    recognition.onend = () => setRecording(false)
    recognition.start()
  }
  return (
    <>
      <PageHeader title={copy.voiceTitle} description={copy.voiceDescription} />
      <div className="voice-workbench">
        <section className={recording ? "voice-stage is-recording" : "voice-stage"}>
          <div className="voice-rings">
            <Mic />
          </div>
          <strong>{recording ? copy.stopRecording : copy.startRecording}</strong>
          <Button className="button button-primary" onClick={record}>
            {recording ? <Radio /> : <Mic />}
            {recording ? copy.stopRecording : copy.startRecording}
          </Button>
          <small>
            {supported
              ? store.locale === "zh-CN"
                ? "浏览器语音识别可用"
                : "Browser speech recognition available"
              : copy.unsupported}
          </small>
        </section>
        <section className="voice-form">
          <Field label={copy.textFallback} error={error}>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                store.locale === "zh-CN" ? "例如：无人机一号起飞" : "Example: stop UAV-02"
              }
            />
          </Field>
          <Button variant="outline" className="button button-secondary" onClick={() => parse(text)}>
            {copy.parse}
          </Button>
          {parsed && (
            <div className="parsed-command">
              <Check />
              <span>
                <strong>{store.uavs.find((item) => item.id === parsed.uavId)?.code}</strong>
                <code>{parsed.type}</code>
              </span>
              <Button
                className="button button-primary"
                onClick={() =>
                  void executeAction(
                    () => store.sendCommand(parsed.uavId, parsed.type, "VOICE", parsed.transcript),
                    store.locale,
                    copy.commandSent
                  ).then((result) => result.ok && setParsed(null))
                }
              >
                {copy.confirm}
              </Button>
            </div>
          )}
        </section>
      </div>
      <Section title={store.locale === "zh-CN" ? "语音与控制日志" : "Voice and command log"}>
        <div className="timeline">
          {store.commands
            .filter((item) => item.source === "VOICE")
            .map((item) => (
              <div key={item.id}>
                <Mic />
                <span>
                  <strong>{item.transcript}</strong>
                  <small>
                    {item.type} · {formatDate(item.createdAt, store.locale)}
                  </small>
                </span>
                <StatusPill value={item.status} />
              </div>
            ))}
        </div>
      </Section>
    </>
  )
}

function OperationsView({ view }: { view: "alerts" | "logs" | "pods" }) {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [alertLevel, setAlertLevel] = useState("ALL")
  const [alertStatus, setAlertStatus] = useState("ALL")
  const [logType, setLogType] = useState("ALL")
  const [logQuery, setLogQuery] = useState("")
  const [logPage, setLogPage] = useState(1)
  const logSize = 20
  const serverLogs = useQuery({
    queryKey: ["audit-logs-page", logType, logQuery, logPage],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(logPage), size: String(logSize) })
      if (logType !== "ALL") params.set("type", logType)
      if (logQuery.trim()) params.set("q", logQuery.trim())
      return api.auditLogs(`?${params}`)
    },
    enabled: isRemoteApi && view === "logs",
    placeholderData: (previous) => previous,
  })
  const visibleAlerts = store.alerts.filter(
    (alert) =>
      (alertLevel === "ALL" || alert.level === alertLevel) &&
      (alertStatus === "ALL" || alert.status === alertStatus)
  )
  const filteredLogs = store.auditLogs.filter(
    (log) =>
      (logType === "ALL" || log.category === logType) &&
      (!logQuery.trim() ||
        `${log.title} ${log.detail} ${log.operatorName ?? ""}`
          .toLocaleLowerCase()
          .includes(logQuery.trim().toLocaleLowerCase()))
  )
  const logRows = isRemoteApi
    ? (serverLogs.data?.items ?? [])
    : filteredLogs.slice((logPage - 1) * logSize, logPage * logSize)
  const logTotalPages = isRemoteApi
    ? (serverLogs.data?.totalPages ?? 1)
    : Math.max(1, Math.ceil(filteredLogs.length / logSize))
  if (view === "alerts")
    return (
      <>
        <PageHeader
          title={copy.alerts}
          description={
            store.locale === "zh-CN"
              ? "按严重级别检查、确认和追溯告警。"
              : "Review, acknowledge, and trace alerts by severity."
          }
        />
        <Section title={`${copy.alerts} · ${visibleAlerts.length}`}>
          <div className="filter-toolbar">
            <Field label={store.locale === "zh-CN" ? "告警等级" : "Severity"}>
              <NativeSelect
                value={alertLevel}
                onChange={(event) => setAlertLevel(event.target.value)}
              >
                <NativeSelectOption value="ALL">
                  {store.locale === "zh-CN" ? "全部" : "All"}
                </NativeSelectOption>
                <NativeSelectOption value="HIGH">HIGH</NativeSelectOption>
                <NativeSelectOption value="MID">MID</NativeSelectOption>
                <NativeSelectOption value="LOW">LOW</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field label={copy.status}>
              <NativeSelect
                value={alertStatus}
                onChange={(event) => setAlertStatus(event.target.value)}
              >
                <NativeSelectOption value="ALL">
                  {store.locale === "zh-CN" ? "全部" : "All"}
                </NativeSelectOption>
                <NativeSelectOption value="OPEN">OPEN</NativeSelectOption>
                <NativeSelectOption value="ACKNOWLEDGED">ACKNOWLEDGED</NativeSelectOption>
                <NativeSelectOption value="RESOLVED">RESOLVED</NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>
          <div className="data-table compact">
            <div className="table-head">
              <span>{copy.alerts}</span>
              <span>{copy.uavs}</span>
              <span>{copy.status}</span>
              <span>{copy.updated}</span>
              <span>{copy.action}</span>
            </div>
            {visibleAlerts.map((item) => (
              <div className="table-row" key={item.id}>
                <span data-label={copy.alerts}>
                  <strong>{item.title}</strong>
                  <small>{item.level}</small>
                </span>
                <span data-label={copy.uavs}>
                  {item.uavId ? (
                    <Link className="touch-link" href={`/uavs/detail?id=${item.uavId}`}>
                      {store.uavs.find((uav) => uav.id === item.uavId)?.code ?? `UAV-${item.uavId}`}
                    </Link>
                  ) : item.podId ? (
                    <Link className="touch-link" href="/pods">
                      POD-{String(item.podId).padStart(2, "0")}
                    </Link>
                  ) : store.locale === "zh-CN" ? (
                    "平台"
                  ) : (
                    "Platform"
                  )}
                </span>
                <span data-label={copy.status}>
                  <StatusPill value={item.status} />
                  {(item.resolvedAt || item.acknowledgedAt) && (
                    <small>
                      #{item.resolvedBy ?? item.acknowledgedBy} ·{" "}
                      {formatDate(item.resolvedAt ?? item.acknowledgedAt!, store.locale)}
                    </small>
                  )}
                </span>
                <span data-label={copy.updated}>{formatDate(item.occurredAt, store.locale)}</span>
                <span data-label={copy.action}>
                  {item.status === "OPEN" && (
                    <Button
                      className="text-button"
                      onClick={() =>
                        void executeAction(
                          () => store.acknowledgeAlert(item.id),
                          store.locale,
                          copy.acknowledge
                        )
                      }
                    >
                      {copy.acknowledge}
                    </Button>
                  )}
                  {item.status === "ACKNOWLEDGED" && (
                    <Button
                      className="text-button"
                      onClick={() =>
                        void executeAction(
                          () => store.resolveAlert(item.id),
                          store.locale,
                          store.locale === "zh-CN" ? "解除告警" : "Resolve alert"
                        )
                      }
                    >
                      {store.locale === "zh-CN" ? "解除" : "Resolve"}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </>
    )
  if (view === "pods")
    return (
      <>
        <PageHeader
          title={copy.pods}
          description={
            store.locale === "zh-CN"
              ? "检查舱门、区域和当前停放设备。"
              : "Inspect door state, region, and docked UAV."
          }
        />
        <MetricStrip
          items={[
            { label: copy.pods, value: store.pods.length },
            { label: copy.inPod, value: store.pods.filter((item) => item.uavId).length },
            {
              label: "ERROR",
              value: store.pods.filter((item) => item.doorStatus === "ERROR").length,
            },
          ]}
        />
        <Section title={copy.pods}>
          <div className="pod-grid">
            {store.pods.map((pod) => (
              <div className="pod-row" key={pod.id}>
                <Warehouse />
                <span>
                  <strong>{pod.name}</strong>
                  <small>{pod.region}</small>
                </span>
                <span>
                  {pod.uavId ? store.uavs.find((item) => item.id === pod.uavId)?.code : "—"}
                </span>
                <StatusPill value={pod.doorStatus} />
                <div className="pod-actions">
                  <NativeSelect
                    aria-label={
                      store.locale === "zh-CN" ? `${pod.name} 舱门状态` : `${pod.name} door status`
                    }
                    value={pod.doorStatus}
                    onChange={(event) =>
                      void executeAction(
                        () =>
                          store.updatePod(
                            pod.id,
                            event.target.value as "OPEN" | "CLOSED" | "ERROR",
                            pod.uavId
                          ),
                        store.locale,
                        copy.save
                      )
                    }
                  >
                    <NativeSelectOption value="OPEN">OPEN</NativeSelectOption>
                    <NativeSelectOption value="CLOSED">CLOSED</NativeSelectOption>
                    <NativeSelectOption value="ERROR">ERROR</NativeSelectOption>
                  </NativeSelect>
                  <NativeSelect
                    aria-label={
                      store.locale === "zh-CN" ? `${pod.name} 停放设备` : `${pod.name} docked UAV`
                    }
                    value={pod.uavId ?? ""}
                    onChange={(event) =>
                      void executeAction(
                        () =>
                          store.updatePod(
                            pod.id,
                            pod.doorStatus,
                            event.target.value ? Number(event.target.value) : undefined
                          ),
                        store.locale,
                        copy.save
                      )
                    }
                  >
                    <NativeSelectOption value="">—</NativeSelectOption>
                    {store.uavs.map((uav) => (
                      <NativeSelectOption key={uav.id} value={uav.id}>
                        {uav.code}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </>
    )
  return (
    <>
      <PageHeader
        title={copy.logs}
        description={
          store.locale === "zh-CN"
            ? "统一查看飞行、控制和语音审计记录。"
            : "Review flight, control, and voice audit records."
        }
      />
      <Section title={copy.logs}>
        <div className="audit-toolbar">
          <Tabs
            value={logType}
            onValueChange={(value) => {
              setLogType(value)
              setLogPage(1)
            }}
          >
            <TabsList
              variant="line"
              aria-label={store.locale === "zh-CN" ? "日志类型" : "Log type"}
            >
              <TabsTrigger value="ALL">{store.locale === "zh-CN" ? "全部" : "All"}</TabsTrigger>
              <TabsTrigger value="FLIGHT">
                {store.locale === "zh-CN" ? "飞行" : "Flight"}
              </TabsTrigger>
              <TabsTrigger value="CONTROL">
                {store.locale === "zh-CN" ? "控制" : "Control"}
              </TabsTrigger>
              <TabsTrigger value="VOICE">{store.locale === "zh-CN" ? "语音" : "Voice"}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            type="search"
            value={logQuery}
            placeholder={
              store.locale === "zh-CN"
                ? "搜索事件、详情或操作人"
                : "Search event, detail, or operator"
            }
            aria-label={store.locale === "zh-CN" ? "搜索日志" : "Search logs"}
            onChange={(event) => {
              setLogQuery(event.target.value)
              setLogPage(1)
            }}
          />
        </div>
        {isRemoteApi && serverLogs.isPending ? (
          <QueryLoading locale={store.locale} />
        ) : isRemoteApi && serverLogs.isError ? (
          <QueryError locale={store.locale} onRetry={() => void serverLogs.refetch()} />
        ) : logRows.length ? (
          <div className="timeline">
            {logRows.map((item) => {
              const Icon =
                item.category === "FLIGHT" ? Plane : item.category === "VOICE" ? Mic : Radio
              return (
                <div key={item.id}>
                  <Icon />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.detail} ·{" "}
                      {item.uavId ? (
                        <Link className="touch-link" href={`/uavs/detail?id=${item.uavId}`}>
                          {store.uavs.find((uav) => uav.id === item.uavId)?.code ??
                            `UAV-${item.uavId}`}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {item.operatorName ? ` · ${item.operatorName}` : ""} ·{" "}
                      {formatDate(item.occurredAt, store.locale)}
                    </small>
                  </span>
                  <StatusPill value={item.status} />
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState title={store.locale === "zh-CN" ? "暂无匹配日志" : "No matching logs"} />
        )}
        <PaginationControls
          page={logPage}
          totalPages={logTotalPages}
          pending={serverLogs.isFetching}
          locale={store.locale}
          onPageChange={setLogPage}
        />
      </Section>
    </>
  )
}

function UsersView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [editing, setEditing] = useState<Partial<ManagedUser> | null>(null)
  const [addressUser, setAddressUser] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!editing?.username || !/^1\d{10}$/.test(editing.phone ?? "")) return
    setSaving(true)
    const result = await executeAction(
      () => store.saveUser({ id: editing.id, username: editing.username!, phone: editing.phone! }),
      store.locale,
      copy.save
    )
    setSaving(false)
    if (result.ok) setEditing(null)
  }
  return (
    <>
      <PageHeader
        title={copy.users}
        description={
          store.locale === "zh-CN"
            ? "管理配送用户与地址；每位用户只允许一个默认地址。"
            : "Manage delivery users and enforce one default address per user."
        }
        actions={
          <Button className="button button-primary" onClick={() => setEditing({})}>
            <Plus />
            {copy.add}
          </Button>
        }
      />
      <Section title={`${copy.users} · ${store.users.length}`}>
        <div className="data-table compact">
          <div className="table-head">
            <span>{copy.users}</span>
            <span>{store.locale === "zh-CN" ? "手机号" : "Phone"}</span>
            <span>{store.locale === "zh-CN" ? "地址" : "Addresses"}</span>
            <span>{copy.updated}</span>
            <span>{copy.action}</span>
          </div>
          {store.users.map((user) => (
            <div className="table-row" key={user.id}>
              <span data-label={copy.users}>
                <strong>{user.username}</strong>
                <small>USR-{String(user.id).padStart(4, "0")}</small>
              </span>
              <span data-label="Phone">{user.phone}</span>
              <span data-label="Addresses">
                <Button
                  variant="link"
                  size="sm"
                  className="text-button"
                  onClick={() => setAddressUser(user.id)}
                >
                  {user.addresses.length} · {copy.edit}
                </Button>
              </span>
              <span data-label={copy.updated}>{formatDate(user.createdAt, store.locale)}</span>
              <span data-label={copy.action}>
                <Button
                  variant="link"
                  size="sm"
                  className="text-button"
                  onClick={() => setEditing(user)}
                >
                  {copy.edit}
                </Button>
                <ConfirmAction
                  trigger={
                    <Button variant="link" size="sm" className="text-button danger-text">
                      {copy.delete}
                    </Button>
                  }
                  title={store.locale === "zh-CN" ? "确认删除用户" : "Delete user?"}
                  description={
                    store.locale === "zh-CN"
                      ? `用户“${user.username}”及其地址将被永久删除。`
                      : `${user.username} and associated addresses will be permanently deleted.`
                  }
                  cancelLabel={copy.cancel}
                  confirmLabel={copy.delete}
                  onConfirm={() => {
                    void executeAction(() => store.deleteUser(user.id), store.locale, copy.delete)
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      </Section>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? copy.edit : copy.add} {copy.users}
            </DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "手机号必须为 11 位大陆手机号。"
                : "Phone must be an 11-digit mainland China number."}
            </DialogDescription>
          </DialogHeader>
          <Field label={copy.users}>
            <Input
              value={editing?.username ?? ""}
              onChange={(event) =>
                setEditing((value) => ({ ...value, username: event.target.value }))
              }
            />
          </Field>
          <Field
            label={store.locale === "zh-CN" ? "手机号" : "Phone"}
            error={
              editing?.phone && !/^1\d{10}$/.test(editing.phone)
                ? store.locale === "zh-CN"
                  ? "请输入有效手机号"
                  : "Enter a valid phone number"
                : undefined
            }
          >
            <Input
              value={editing?.phone ?? ""}
              onChange={(event) => setEditing((value) => ({ ...value, phone: event.target.value }))}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setEditing(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={saving}
              data-state={saving ? "loading" : undefined}
              onClick={() => void save()}
            >
              <PendingLabel
                pending={saving}
                pendingLabel={store.locale === "zh-CN" ? "保存中…" : "Saving…"}
              >
                {copy.save}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddressDialog userId={addressUser} onClose={() => setAddressUser(null)} />
    </>
  )
}

function AddressDialog({ userId, onClose }: { userId: number | null; onClose: () => void }) {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const user = store.users.find((item) => item.id === userId)
  const [detail, setDetail] = useState("")
  const [receiverName, setReceiverName] = useState("")
  const [receiverPhone, setReceiverPhone] = useState("")
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")
  const [editingAddressId, setEditingAddressId] = useState<number | undefined>()
  const [saving, setSaving] = useState(false)
  if (!userId || !user) return null
  const resetAddressForm = () => {
    setEditingAddressId(undefined)
    setReceiverName("")
    setReceiverPhone("")
    setDetail("")
    setLatitude("")
    setLongitude("")
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {user.username} · {store.locale === "zh-CN" ? "收货地址" : "Addresses"}
          </DialogTitle>
          <DialogDescription>
            {store.locale === "zh-CN"
              ? "新增地址会设为默认地址，并取消原默认地址。"
              : "The new address becomes default and replaces the previous default."}
          </DialogDescription>
        </DialogHeader>
        <div className="address-list">
          {user.addresses.map((item) => (
            <div key={item.id}>
              <MapPin />
              <span>
                <strong>
                  {item.receiverName} · {item.receiverPhone}
                </strong>
                <small>{item.detail}</small>
              </span>
              {item.isDefault && <StatusPill value="DEFAULT" />}
              <span className="address-actions">
                <Button
                  className="text-button"
                  onClick={() => {
                    setEditingAddressId(item.id)
                    setReceiverName(item.receiverName)
                    setReceiverPhone(item.receiverPhone)
                    setDetail(item.detail)
                    setLatitude(String(item.latitude))
                    setLongitude(String(item.longitude))
                  }}
                >
                  {copy.edit}
                </Button>
                {!item.isDefault && (
                  <Button
                    className="text-button"
                    onClick={() =>
                      void executeAction(
                        () => store.setDefaultAddress(userId, item.id),
                        store.locale,
                        copy.save
                      )
                    }
                  >
                    {store.locale === "zh-CN" ? "设为默认" : "Set default"}
                  </Button>
                )}
                <ConfirmAction
                  trigger={
                    <Button variant="link" size="sm" className="text-button danger-text">
                      {copy.delete}
                    </Button>
                  }
                  title={store.locale === "zh-CN" ? "确认删除地址" : "Delete address?"}
                  description={
                    store.locale === "zh-CN"
                      ? `将永久删除“${item.detail}”。`
                      : `This permanently deletes “${item.detail}”.`
                  }
                  cancelLabel={copy.cancel}
                  confirmLabel={copy.delete}
                  onConfirm={() => {
                    void executeAction(
                      () => store.deleteAddress(userId, item.id),
                      store.locale,
                      copy.delete
                    )
                  }}
                />
              </span>
            </div>
          ))}
        </div>
        <div className="form-grid">
          <Field label={store.locale === "zh-CN" ? "收件人" : "Receiver"}>
            <Input
              value={receiverName}
              placeholder={user.username}
              onChange={(event) => setReceiverName(event.target.value)}
            />
          </Field>
          <Field
            label={store.locale === "zh-CN" ? "收件手机号" : "Receiver phone"}
            error={
              receiverPhone && !/^1\d{10}$/.test(receiverPhone)
                ? store.locale === "zh-CN"
                  ? "请输入有效手机号"
                  : "Enter a valid phone number"
                : undefined
            }
          >
            <Input
              value={receiverPhone}
              placeholder={user.phone}
              onChange={(event) => setReceiverPhone(event.target.value)}
            />
          </Field>
        </div>
        <Field label={store.locale === "zh-CN" ? "详细地址" : "Address detail"}>
          <Input value={detail} onChange={(event) => setDetail(event.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label={store.locale === "zh-CN" ? "纬度" : "Latitude"}>
            <Input
              type="number"
              min="-90"
              max="90"
              step="0.000001"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
            />
          </Field>
          <Field label={store.locale === "zh-CN" ? "经度" : "Longitude"}>
            <Input
              type="number"
              min="-180"
              max="180"
              step="0.000001"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="button button-secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            className="button button-primary"
            disabled={
              saving ||
              !detail.trim() ||
              !latitude.trim() ||
              !longitude.trim() ||
              !Number.isFinite(Number(latitude)) ||
              !Number.isFinite(Number(longitude)) ||
              Number(latitude) < -90 ||
              Number(latitude) > 90 ||
              Number(longitude) < -180 ||
              Number(longitude) > 180
            }
            data-state={saving ? "loading" : undefined}
            onClick={() =>
              void (async () => {
                if (!detail.trim()) return
                setSaving(true)
                const result = await executeAction(
                  () =>
                    store.saveAddress(userId, {
                      id: editingAddressId,
                      receiverName: receiverName.trim() || user.username,
                      receiverPhone: receiverPhone.trim() || user.phone,
                      detail,
                      latitude: Number(latitude),
                      longitude: Number(longitude),
                      isDefault:
                        user.addresses.find((address) => address.id === editingAddressId)
                          ?.isDefault ?? true,
                    }),
                  store.locale,
                  copy.save
                )
                setSaving(false)
                if (result.ok) resetAddressForm()
              })()
            }
          >
            <PendingLabel
              pending={saving}
              pendingLabel={store.locale === "zh-CN" ? "保存中…" : "Saving…"}
            >
              {editingAddressId ? copy.save : copy.add}
            </PendingLabel>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GoodsView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [editing, setEditing] = useState<Partial<Goods> | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<Goods["category"] | "ALL">("ALL")
  const [page, setPage] = useState(1)
  const pageSize = 10
  const goodsRevision = store.goods
    .map((item) => `${item.id}:${item.name}:${item.category}:${item.stock}:${item.status}`)
    .join("|")
  const serverPage = useQuery({
    queryKey: ["goods-page", query, category, page, goodsRevision],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: String(pageSize) })
      if (query.trim()) params.set("q", query.trim())
      if (category !== "ALL") params.set("category", category)
      return api.goods(`?${params}`)
    },
    enabled: isRemoteApi,
    placeholderData: (previous) => previous,
  })
  const save = async () => {
    if (!editing?.name) return
    setSaving(true)
    const name = editing.name
    const result = await executeAction(
      () =>
        store.saveGoods({
          id: editing.id,
          name,
          category: editing.category ?? "life",
          price: Number(editing.price ?? 0),
          stock: Number(editing.stock ?? 0),
          weight: Number(editing.weight ?? 0),
          status: editing.status ?? 1,
        }),
      store.locale,
      copy.save
    )
    setSaving(false)
    if (result.ok) setEditing(null)
  }
  const categoryCounts = ["food", "medicine", "life", "industry"].map((category) => ({
    label: category.toUpperCase(),
    value: store.goods.filter((item) => item.category === category).length,
  }))
  const filteredGoods = store.goods.filter(
    (item) =>
      (!query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase())) &&
      (category === "ALL" || item.category === category)
  )
  const total = isRemoteApi ? (serverPage.data?.total ?? 0) : filteredGoods.length
  const totalPages = isRemoteApi
    ? (serverPage.data?.totalPages ?? 1)
    : Math.max(1, Math.ceil(filteredGoods.length / pageSize))
  const rows = isRemoteApi
    ? (serverPage.data?.items ?? [])
    : filteredGoods.slice((page - 1) * pageSize, page * pageSize)
  const deleteSelectedGoods = async () => {
    const result = await executeAction(() => store.deleteGoods(selected), store.locale, copy.delete)
    if (!result.ok) return
    if (page > 1 && rows.every((item) => selected.includes(item.id))) {
      setPage((value) => value - 1)
    }
    setSelected([])
  }
  return (
    <>
      <PageHeader
        title={copy.goods}
        description={
          store.locale === "zh-CN"
            ? "管理商品、库存、分类与上下架状态。"
            : "Manage goods, stock, categories, and availability."
        }
        actions={
          <>
            <ConfirmAction
              trigger={
                <Button
                  variant="outline"
                  className="button button-secondary"
                  disabled={!selected.length}
                >
                  {copy.delete} ({selected.length})
                </Button>
              }
              title={store.locale === "zh-CN" ? "确认批量删除" : "Confirm bulk deletion"}
              description={
                store.locale === "zh-CN"
                  ? `将永久删除已选择的 ${selected.length} 个商品。`
                  : `This permanently deletes ${selected.length} selected goods.`
              }
              cancelLabel={copy.cancel}
              confirmLabel={copy.delete}
              onConfirm={deleteSelectedGoods}
            />
            <Button className="button button-primary" onClick={() => setEditing({})}>
              <Plus />
              {copy.add}
            </Button>
          </>
        }
      />
      <div className="filter-bar">
        <label className="search-field">
          <Search size={17} />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder={store.locale === "zh-CN" ? "搜索商品" : "Search goods"}
          />
        </label>
        <label>
          <span className="sr-only">{store.locale === "zh-CN" ? "分类" : "Category"}</span>
          <NativeSelect
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as Goods["category"] | "ALL")
              setPage(1)
            }}
          >
            <NativeSelectOption value="ALL">
              {store.locale === "zh-CN" ? "全部分类" : "All categories"}
            </NativeSelectOption>
            {categoryCounts.map((item) => (
              <NativeSelectOption key={item.label} value={item.label.toLowerCase()}>
                {item.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <MetricStrip items={categoryCounts} />
      <Section title={`${copy.goods} · ${total}`}>
        {isRemoteApi && serverPage.isError ? (
          <QueryError locale={store.locale} onRetry={() => void serverPage.refetch()} />
        ) : isRemoteApi && serverPage.isPending ? (
          <QueryLoading locale={store.locale} />
        ) : rows.length ? (
          <div className="data-table goods-table">
            <div className="table-head">
              <span>✓</span>
              <span>{copy.goods}</span>
              <span>{store.locale === "zh-CN" ? "分类" : "Category"}</span>
              <span>{store.locale === "zh-CN" ? "价格" : "Price"}</span>
              <span>{store.locale === "zh-CN" ? "库存" : "Stock"}</span>
              <span>{copy.status}</span>
              <span>{copy.action}</span>
            </div>
            {rows.map((item) => (
              <div className="table-row" key={item.id}>
                <span>
                  <label className="selection-control">
                    <Checkbox
                      checked={selected.includes(item.id)}
                      onCheckedChange={() =>
                        setSelected((value) =>
                          value.includes(item.id)
                            ? value.filter((id) => id !== item.id)
                            : [...value, item.id]
                        )
                      }
                      aria-label={`Select ${item.name}`}
                    />
                  </label>
                </span>
                <span data-label={copy.goods}>
                  <strong>{item.name}</strong>
                  <small>{item.weight} kg</small>
                </span>
                <span data-label="Category">{item.category}</span>
                <span data-label="Price">¥{item.price.toFixed(2)}</span>
                <span data-label="Stock">{item.stock}</span>
                <span data-label={copy.status}>
                  <StatusPill value={item.status === 1 ? "ENABLED" : "DISABLED"} />
                </span>
                <span data-label={copy.action}>
                  <Button
                    className="text-button"
                    onClick={() =>
                      void executeAction(() => store.toggleGoods(item.id), store.locale)
                    }
                  >
                    {item.status ? copy.disable : copy.enable}
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-button"
                    onClick={() => setEditing(item)}
                  >
                    {copy.edit}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={copy.noResults} />
        )}
        <PaginationControls
          page={page}
          totalPages={totalPages}
          pending={serverPage.isFetching}
          locale={store.locale}
          onPageChange={setPage}
        />
      </Section>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? copy.edit : copy.add} {copy.goods}
            </DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "价格、库存和重量必须为非负数。"
                : "Price, stock, and weight must be non-negative."}
            </DialogDescription>
          </DialogHeader>
          <div className="form-grid">
            <Field label={copy.goods}>
              <Input
                value={editing?.name ?? ""}
                onChange={(e) => setEditing((v) => ({ ...v, name: e.target.value }))}
              />
            </Field>
            <Field label="Category">
              <NativeSelect
                value={editing?.category ?? "life"}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, category: e.target.value as Goods["category"] }))
                }
              >
                {["food", "medicine", "life", "industry"].map((value) => (
                  <NativeSelectOption key={value}>{value}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Price">
              <Input
                type="number"
                min="0"
                value={editing?.price ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, price: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Stock">
              <Input
                type="number"
                min="0"
                value={editing?.stock ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, stock: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Weight">
              <Input
                type="number"
                min="0"
                step="0.1"
                value={editing?.weight ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, weight: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setEditing(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={saving}
              data-state={saving ? "loading" : undefined}
              onClick={() => void save()}
            >
              <PendingLabel
                pending={saving}
                pendingLabel={store.locale === "zh-CN" ? "保存中…" : "Saving…"}
              >
                {copy.save}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function OrdersView({ detail = false }: { detail?: boolean }) {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const id = useUrlId(store.orders[0]?.id ?? 1)
  const order = store.orders.find((item) => item.id === id) ?? store.orders[0]
  const [creating, setCreating] = useState(false)
  const [userId, setUserId] = useState(store.users.find((user) => user.addresses.length)?.id ?? 0)
  const selectedUser = store.users.find((user) => user.id === userId)
  const [addressId, setAddressId] = useState(selectedUser?.addresses[0]?.id ?? 0)
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  if (detail)
    return (
      <>
        <PageHeader
          title={order.orderNo}
          description={`${copy.orders} · ${formatDate(order.createdAt, store.locale)}`}
          actions={<StatusPill value={order.status} />}
        />
        <MetricStrip
          items={[
            {
              label: store.locale === "zh-CN" ? "订单金额" : "Total",
              value: `¥${order.totalPrice.toFixed(2)}`,
            },
            {
              label: copy.users,
              value: store.users.find((item) => item.id === order.userId)?.username ?? "—",
            },
            {
              label: copy.tasks,
              value: store.tasks.find((item) => item.orderId === order.id)?.taskStatus ?? "—",
            },
          ]}
        />
        <Section title={store.locale === "zh-CN" ? "订单明细" : "Order items"}>
          <div className="definition-list">
            {order.items.map((item) => (
              <div key={item.id}>
                <dt>
                  {item.goodsName} × {item.count}
                </dt>
                <dd>¥{(item.price * item.count).toFixed(2)}</dd>
              </div>
            ))}
          </div>
        </Section>
        {order.addressSnapshot && (
          <Section title={store.locale === "zh-CN" ? "配送地址快照" : "Delivery address snapshot"}>
            <div className="definition-list">
              <div>
                <dt>{order.addressSnapshot.receiverName}</dt>
                <dd>{order.addressSnapshot.receiverPhone}</dd>
              </div>
              <div>
                <dt>{store.locale === "zh-CN" ? "详细地址" : "Address"}</dt>
                <dd>{order.addressSnapshot.detail}</dd>
              </div>
            </div>
          </Section>
        )}
        <OrderActions orderId={order.id} />
      </>
    )
  return (
    <>
      <PageHeader
        title={copy.orders}
        description={
          store.locale === "zh-CN"
            ? "从创建、调度、配送到完成追踪订单。"
            : "Track orders from creation through dispatch and delivery."
        }
        actions={
          <Button className="button button-primary" onClick={() => setCreating(true)}>
            <Plus />
            {copy.add}
          </Button>
        }
      />
      <Section title={`${copy.orders} · ${store.orders.length}`}>
        <div className="data-table compact orders-table">
          <div className="table-head">
            <span>{copy.orders}</span>
            <span>{copy.users}</span>
            <span>{store.locale === "zh-CN" ? "金额" : "Total"}</span>
            <span>{copy.status}</span>
            <span>{copy.updated}</span>
            <span>{copy.action}</span>
          </div>
          {store.orders.map((item) => (
            <div className="table-row" key={item.id}>
              <span data-label={copy.orders}>
                <strong>{item.orderNo}</strong>
              </span>
              <span data-label={copy.users}>
                {store.users.find((user) => user.id === item.userId)?.username}
              </span>
              <span data-label="Total">¥{item.totalPrice.toFixed(2)}</span>
              <span data-label={copy.status}>
                <StatusPill value={item.status} />
              </span>
              <span data-label={copy.updated}>{formatDate(item.createdAt, store.locale)}</span>
              <span data-label={copy.action}>
                <Link className="text-link" href={`/orders/detail?id=${item.id}`}>
                  {copy.details} →
                </Link>
              </span>
            </div>
          ))}
        </div>
      </Section>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{store.locale === "zh-CN" ? "创建订单" : "Create order"}</DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "选择用户、地址和商品数量；库存将在创建成功后扣减。"
                : "Select a user, address, and quantities. Stock is deducted after creation."}
            </DialogDescription>
          </DialogHeader>
          <Field label={copy.users}>
            <NativeSelect
              value={userId}
              onChange={(event) => {
                const nextUserId = Number(event.target.value)
                const nextUser = store.users.find((user) => user.id === nextUserId)
                setUserId(nextUserId)
                setAddressId(nextUser?.addresses[0]?.id ?? 0)
              }}
            >
              {store.users
                .filter((user) => user.addresses.length)
                .map((user) => (
                  <NativeSelectOption key={user.id} value={user.id}>
                    {user.username} · {user.phone}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          <Field label={store.locale === "zh-CN" ? "配送地址" : "Delivery address"}>
            <NativeSelect
              value={addressId}
              onChange={(event) => setAddressId(Number(event.target.value))}
            >
              {selectedUser?.addresses.map((address) => (
                <NativeSelectOption key={address.id} value={address.id}>
                  {address.detail}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="order-editor">
            {store.goods
              .filter((goods) => goods.status === 1 && goods.stock > 0)
              .map((goods) => (
                <label key={goods.id}>
                  <span>
                    <strong>{goods.name}</strong>
                    <small>
                      ¥{goods.price.toFixed(2)} · {store.locale === "zh-CN" ? "库存" : "Stock"}{" "}
                      {goods.stock}
                    </small>
                  </span>
                  <Input
                    type="number"
                    min="0"
                    max={goods.stock}
                    value={quantities[goods.id] ?? 0}
                    onChange={(event) =>
                      setQuantities((value) => ({
                        ...value,
                        [goods.id]: Math.max(0, Math.min(goods.stock, Number(event.target.value))),
                      }))
                    }
                    aria-label={`${goods.name} quantity`}
                  />
                </label>
              ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setCreating(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={
                saving ||
                !userId ||
                !addressId ||
                !Object.values(quantities).some((count) => count > 0)
              }
              data-state={saving ? "loading" : undefined}
              onClick={() => {
                const items = Object.entries(quantities)
                  .filter(([, count]) => count > 0)
                  .map(([goodsId, count]) => ({ goodsId: Number(goodsId), count }))
                setSaving(true)
                void executeAction(
                  () => store.createOrder(userId, addressId, items),
                  store.locale,
                  copy.save
                ).then((result) => {
                  setSaving(false)
                  if (!result.ok) return
                  setCreating(false)
                  setQuantities({})
                })
              }}
            >
              <PendingLabel
                pending={saving}
                pendingLabel={store.locale === "zh-CN" ? "创建中…" : "Creating…"}
              >
                {copy.save}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function OrderActions({ orderId }: { orderId: number }) {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const order = store.orders.find((item) => item.id === orderId)
  const [uavId, setUavId] = useState(store.uavs.find((item) => item.status === "ONLINE")?.id ?? 1)
  if (!order) return null
  return (
    <Section title={store.locale === "zh-CN" ? "订单操作" : "Order actions"}>
      <div className="action-line">
        <NativeSelect value={uavId} onChange={(event) => setUavId(Number(event.target.value))}>
          {store.uavs
            .filter((item) => item.status === "ONLINE")
            .map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.code} · {item.battery}%
              </NativeSelectOption>
            ))}
        </NativeSelect>
        <Button
          className="button button-primary"
          disabled={order.status !== "CREATED"}
          onClick={() =>
            void executeAction(
              () => store.dispatchOrder(orderId, uavId),
              store.locale,
              copy.dispatch
            )
          }
        >
          {copy.dispatch}
        </Button>
        <Button
          className="button button-danger"
          disabled={!["CREATED", "DISPATCHING"].includes(order.status)}
          onClick={() =>
            void executeAction(
              () => store.transitionOrder(orderId, "CANCELLED"),
              store.locale,
              copy.cancelOrder
            )
          }
        >
          {copy.cancelOrder}
        </Button>
      </div>
    </Section>
  )
}

function TasksView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [failureTaskId, setFailureTaskId] = useState<number | null>(null)
  const [failureReason, setFailureReason] = useState("")
  return (
    <>
      <PageHeader
        title={copy.tasks}
        description={
          store.locale === "zh-CN"
            ? "执行配送状态机，非法状态跳转不会提交。"
            : "Run the delivery state machine; invalid transitions are rejected."
        }
      />
      <Section title={`${copy.tasks} · ${store.tasks.length}`}>
        <div className="task-list">
          {store.tasks.map((task) => (
            <div className="task-row" key={task.id}>
              <span>
                <strong>TSK-{String(task.id).padStart(4, "0")}</strong>
                <small>{store.orders.find((item) => item.id === task.orderId)?.orderNo}</small>
              </span>
              <span>{store.uavs.find((item) => item.id === task.uavId)?.code}</span>
              <StatusPill value={task.taskStatus} />
              {task.failureReason && <small>{task.failureReason}</small>}
              <div>
                {task.taskStatus === "WAITING" && (
                  <Button
                    className="text-button"
                    onClick={() =>
                      void executeAction(
                        () => store.transitionTask(task.id, "FLYING"),
                        store.locale,
                        copy.startTask
                      )
                    }
                  >
                    {copy.startTask}
                  </Button>
                )}
                {task.taskStatus === "FLYING" && (
                  <>
                    <Button
                      className="text-button"
                      onClick={() =>
                        void executeAction(
                          () => store.transitionTask(task.id, "ARRIVED"),
                          store.locale,
                          copy.arrive
                        )
                      }
                    >
                      {copy.arrive}
                    </Button>
                    <Button
                      className="text-button danger-text"
                      onClick={() => setFailureTaskId(task.id)}
                    >
                      {copy.fail}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Dialog
        open={failureTaskId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFailureTaskId(null)
            setFailureReason("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {store.locale === "zh-CN" ? "记录失败原因" : "Record failure"}
            </DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "失败原因会写入任务记录并用于后续重调度复盘。"
                : "The reason is stored with the task for retry review."}
            </DialogDescription>
          </DialogHeader>
          <Field label={store.locale === "zh-CN" ? "失败原因" : "Failure reason"}>
            <Textarea
              value={failureReason}
              onChange={(event) => setFailureReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setFailureTaskId(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-danger"
              disabled={!failureReason.trim()}
              onClick={() => {
                if (failureTaskId === null) return
                void executeAction(
                  () => store.transitionTask(failureTaskId, "FAILED", failureReason.trim()),
                  store.locale,
                  copy.fail
                ).then((result) => {
                  if (!result.ok) return
                  setFailureTaskId(null)
                  setFailureReason("")
                })
              }}
            >
              {copy.fail}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SettingsView() {
  const store = useProductStore()
  const router = useRouter()
  const queryClient = useQueryClient()
  const copy = useCopy(store.locale)
  const [updateMessage, setUpdateMessage] = useState("")
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof api.sessions>>>([])
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>(() =>
    store.staff ? [{ ...store.staff, enabled: true }] : []
  )
  const [staffLoading, setStaffLoading] = useState(isRemoteApi && store.staff?.role === "admin")
  const [staffSaving, setStaffSaving] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffAccountForm | null>(null)
  const staffForm = useForm<StaffAccountForm>({
    resolver: zodResolver(staffAccountFormSchema),
    defaultValues: {
      username: "",
      displayName: "",
      phone: "",
      password: "",
      role: "manager",
      enabled: true,
    },
  })
  const staffRole = useWatch({ control: staffForm.control, name: "role" })
  const staffEnabled = useWatch({ control: staffForm.control, name: "enabled" })
  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      displayName: store.staff?.displayName ?? "",
      phone: store.staff?.phone ?? "",
    },
  })
  const bindingHistory = store.bindings.filter(
    (item) => item.staffId === store.staff?.id && item.unboundAt
  )
  const bindings = store.bindings.filter(
    (item) => item.staffId === store.staff?.id && !item.unboundAt
  )
  const finishLogout = async () => {
    try {
      suppressSessionRecovery()
      await api.forgetAuthentication()
    } catch {
      toast.warning(
        store.locale === "zh-CN"
          ? "本地安全凭据未能完全移除，请关闭应用后重新打开。"
          : "Local security credentials could not be fully removed. Close and reopen the app."
      )
    } finally {
      queryClient.clear()
      store.logout()
      router.replace("/login")
    }
  }
  useEffect(() => {
    void getPlatformInfo()
      .then(setPlatformInfo)
      .catch(() => setPlatformInfo(null))
  }, [])
  useEffect(() => {
    if (store.staff?.role !== "admin" || !isRemoteApi) return
    let active = true
    void api
      .staffAccounts()
      .then((accounts) => {
        if (active) setStaffAccounts(accounts)
      })
      .catch((error: unknown) => {
        if (active) {
          const detail = error instanceof Error ? error.message : String(error)
          toast.error(
            store.locale === "zh-CN"
              ? `员工账号加载失败：${detail}`
              : `Unable to load staff accounts: ${detail}`
          )
        }
      })
      .finally(() => {
        if (active) setStaffLoading(false)
      })
    return () => {
      active = false
    }
  }, [store.locale, store.staff?.role])
  const openStaffEditor = (account?: StaffAccount) => {
    const values: StaffAccountForm = account
      ? { ...account, password: "" }
      : {
          username: "",
          displayName: "",
          phone: "",
          password: "",
          role: "manager",
          enabled: true,
        }
    staffForm.reset(values)
    setEditingStaff(values)
  }
  const saveStaffAccount = async (account: StaffAccountForm) => {
    const username = account.username.trim()
    const displayName = account.displayName.trim()
    const phone = account.phone.trim()
    const password = account.password.trim()
    setStaffSaving(true)
    const { role, enabled } = account
    const result = await executeAction(
      async () => {
        if (isRemoteApi) {
          return account.id
            ? api.updateStaffAccount(account.id, {
                username,
                ...(password ? { password } : {}),
                displayName,
                role,
                phone,
                enabled,
              })
            : api.createStaffAccount({ username, password, displayName, role, phone })
        }
        return {
          id: account.id ?? Math.max(0, ...staffAccounts.map((item) => item.id)) + 1,
          username,
          displayName,
          role,
          phone,
          enabled,
        } satisfies StaffAccount
      },
      store.locale,
      copy.save
    )
    setStaffSaving(false)
    if (!result.ok) return
    if (result.value.id === store.staff?.id) {
      if (password) {
        await finishLogout()
        return
      }
      useProductStore.setState({
        staff: {
          id: result.value.id,
          username: result.value.username,
          displayName: result.value.displayName,
          role: result.value.role,
          phone: result.value.phone,
        },
      })
      profileForm.reset({ displayName: result.value.displayName, phone: result.value.phone })
    }
    setStaffAccounts((accounts) =>
      account.id
        ? accounts.map((account) => (account.id === result.value.id ? result.value : account))
        : [...accounts, result.value]
    )
    setEditingStaff(null)
  }
  const disableStaffAccount = async (account: StaffAccount) => {
    const result = await executeAction(
      () =>
        isRemoteApi
          ? api.disableStaffAccount(account.id)
          : Promise.resolve({ ...account, enabled: false }),
      store.locale,
      store.locale === "zh-CN" ? "账号已停用" : "Account disabled"
    )
    if (!result.ok) return
    setStaffAccounts((accounts) =>
      accounts.map((item) => (item.id === result.value.id ? result.value : item))
    )
  }
  const checkUpdate = async () => {
    if (!isTauri()) {
      const result = await executeAction(api.version, store.locale)
      if (!result.ok) return
      setUpdateMessage(
        result.value.configured
          ? `${store.locale === "zh-CN" ? "当前版本" : "Current version"} ${result.value.currentVersion}`
          : copy.updateUnavailable
      )
      return
    }
    const result = await checkForAppUpdate()
    setUpdateMessage(result.message)
  }
  return (
    <>
      <PageHeader
        title={copy.account}
        description={
          store.locale === "zh-CN"
            ? "管理员工资料、安全会话、设备绑定与客户端状态。"
            : "Manage staff profile, security sessions, device bindings, and client status."
        }
      />
      <div className="settings-layout">
        <nav>
          <a href="#profile">{copy.profile}</a>
          {store.staff?.role === "admin" && (
            <a href="#staff">{store.locale === "zh-CN" ? "员工账号" : "Staff accounts"}</a>
          )}
          <a href="#security">{copy.security}</a>
          <a href="#bindings">{copy.bindings}</a>
          <a href="#about">{copy.about}</a>
        </nav>
        <div>
          <Section title={copy.profile}>
            <div id="profile" className="form-inline">
              <Field
                label={store.locale === "zh-CN" ? "显示名称" : "Display name"}
                error={
                  profileForm.formState.errors.displayName
                    ? store.locale === "zh-CN"
                      ? "请输入不超过 80 个字符的显示名称"
                      : "Enter a display name up to 80 characters"
                    : undefined
                }
              >
                <Input
                  aria-invalid={Boolean(profileForm.formState.errors.displayName)}
                  {...profileForm.register("displayName")}
                />
              </Field>
              <Field
                label={store.locale === "zh-CN" ? "手机号" : "Phone"}
                error={
                  profileForm.formState.errors.phone
                    ? store.locale === "zh-CN"
                      ? "请输入有效的中国大陆手机号"
                      : "Enter a valid mainland China mobile number"
                    : undefined
                }
              >
                <Input
                  inputMode="tel"
                  aria-invalid={Boolean(profileForm.formState.errors.phone)}
                  {...profileForm.register("phone")}
                />
              </Field>
              <Field label={store.locale === "zh-CN" ? "角色" : "Role"}>
                <Input disabled value={store.staff?.role ?? "—"} />
              </Field>
              <Button
                className="button button-primary"
                onClick={profileForm.handleSubmit(
                  (profile) =>
                    void executeAction(
                      () => store.updateStaff(profile),
                      store.locale,
                      copy.save
                    ).then((result) => {
                      if (!result.ok) return
                      const current = useProductStore.getState().staff
                      if (!current) return
                      setStaffAccounts((accounts) =>
                        accounts.map((account) =>
                          account.id === current.id ? { ...account, ...current } : account
                        )
                      )
                    })
                )}
              >
                {copy.save}
              </Button>
            </div>
          </Section>
          {store.staff?.role === "admin" && (
            <Section
              title={store.locale === "zh-CN" ? "员工账号" : "Staff accounts"}
              action={
                <Button className="button button-primary" onClick={() => openStaffEditor()}>
                  <Plus />
                  {store.locale === "zh-CN" ? "新增员工" : "Add staff"}
                </Button>
              }
            >
              <div id="staff">
                {staffLoading ? (
                  <QueryLoading locale={store.locale} />
                ) : (
                  <div className="data-table compact">
                    <div className="table-head">
                      <span>{store.locale === "zh-CN" ? "员工" : "Staff"}</span>
                      <span>{store.locale === "zh-CN" ? "手机号" : "Phone"}</span>
                      <span>{store.locale === "zh-CN" ? "角色" : "Role"}</span>
                      <span>{copy.status}</span>
                      <span>{copy.action}</span>
                    </div>
                    {staffAccounts.map((account) => (
                      <div className="table-row" key={account.id}>
                        <span data-label={store.locale === "zh-CN" ? "员工" : "Staff"}>
                          <strong>{account.displayName}</strong>
                          <small>@{account.username}</small>
                        </span>
                        <span data-label={store.locale === "zh-CN" ? "手机号" : "Phone"}>
                          {account.phone}
                        </span>
                        <span data-label={store.locale === "zh-CN" ? "角色" : "Role"}>
                          {account.role}
                        </span>
                        <span data-label={copy.status}>
                          <StatusPill value={account.enabled ? "ENABLED" : "DISABLED"} />
                        </span>
                        <span data-label={copy.action}>
                          <Button
                            variant="link"
                            size="sm"
                            className="text-button"
                            onClick={() => openStaffEditor(account)}
                          >
                            {copy.edit}
                          </Button>
                          {account.enabled && account.id !== store.staff?.id && (
                            <ConfirmAction
                              trigger={
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="text-button danger-text"
                                >
                                  {store.locale === "zh-CN" ? "停用" : "Disable"}
                                </Button>
                              }
                              title={
                                store.locale === "zh-CN"
                                  ? "确认停用员工账号"
                                  : "Disable staff account?"
                              }
                              description={
                                store.locale === "zh-CN"
                                  ? `“${account.displayName}”将立即失去访问权限，所有刷新会话也会撤销。`
                                  : `${account.displayName} loses access immediately and all refresh sessions are revoked.`
                              }
                              cancelLabel={copy.cancel}
                              confirmLabel={store.locale === "zh-CN" ? "停用" : "Disable"}
                              onConfirm={() => disableStaffAccount(account)}
                            />
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}
          <Section title={copy.security}>
            <div id="security" className="settings-rows">
              <Button onClick={() => setPasswordOpen(true)}>
                <ShieldCheck />
                <span>
                  <strong>{copy.changePassword}</strong>
                  <small>
                    {store.locale === "zh-CN"
                      ? "修改密码将撤销全部活动会话"
                      : "Changing it revokes every active session"}
                  </small>
                </span>
                <ChevronRight />
              </Button>
              <Button
                onClick={() =>
                  void executeAction(api.sessions, store.locale).then((result) => {
                    if (result.ok) {
                      setSessions(result.value)
                      setSessionsOpen(true)
                    }
                  })
                }
              >
                <Radio />
                <span>
                  <strong>{copy.sessions}</strong>
                  <small>
                    {store.locale === "zh-CN"
                      ? "查看并撤销已登录的设备"
                      : "Review and revoke signed-in devices"}
                  </small>
                </span>
                <ChevronRight />
              </Button>
            </div>
          </Section>
          <Section title={copy.bindings}>
            <div id="bindings" className="binding-list">
              {bindings.map((binding) => (
                <div key={binding.id}>
                  <Plane />
                  <span>
                    <strong>{store.uavs.find((item) => item.id === binding.uavId)?.code}</strong>
                    <small>{formatDate(binding.boundAt, store.locale)}</small>
                  </span>
                  <Button
                    className="text-button"
                    onClick={() =>
                      void executeAction(() => store.unbindDevice(binding.id), store.locale)
                    }
                  >
                    {store.locale === "zh-CN" ? "解绑" : "Unbind"}
                  </Button>
                </div>
              ))}
              {bindingHistory.map((binding) => (
                <div key={binding.id}>
                  <X />
                  <span>
                    <strong>{store.uavs.find((item) => item.id === binding.uavId)?.code}</strong>
                    <small>
                      {store.locale === "zh-CN" ? "已解绑" : "Unbound"} ·{" "}
                      {formatDate(binding.unboundAt!, store.locale)}
                    </small>
                  </span>
                </div>
              ))}
              <NativeSelect
                onChange={(e) => {
                  if (e.target.value)
                    void executeAction(() => store.bindDevice(Number(e.target.value)), store.locale)
                  e.target.value = ""
                }}
                defaultValue=""
              >
                <NativeSelectOption value="" disabled>
                  {store.locale === "zh-CN" ? "绑定其他设备" : "Bind another device"}
                </NativeSelectOption>
                {store.uavs
                  .filter((uav) => !bindings.some((binding) => binding.uavId === uav.id))
                  .map((uav) => (
                    <NativeSelectOption key={uav.id} value={uav.id}>
                      {uav.code}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </div>
          </Section>
          <Section title={copy.about}>
            <div id="about" className="settings-rows">
              <Button
                onClick={() => {
                  store.clearNonAuthCache()
                  toast.success(copy.cacheCleared)
                }}
              >
                <Database />
                <span>
                  <strong>{copy.clearCache}</strong>
                  <small>
                    {store.locale === "zh-CN"
                      ? "保留登录与安全凭据"
                      : "Authentication credentials are preserved"}
                  </small>
                </span>
                <ChevronRight />
              </Button>
              <Button onClick={checkUpdate}>
                <RotateCcw />
                <span>
                  <strong>{copy.checkUpdate}</strong>
                  <small>{updateMessage || platformInfo?.appVersion || "v0.1.0"}</small>
                </span>
                <ChevronRight />
              </Button>
              <div className="about-line">
                <span>
                  {copy.brand} · {copy.console}
                </span>
                <code>
                  {platformInfo
                    ? `${platformInfo.platform.toUpperCase()} ${platformInfo.architecture} · v${platformInfo.appVersion}`
                    : "WEB · API v1"}
                </code>
              </div>
              <Button
                className="danger-row"
                disabled={loggingOut}
                data-state={loggingOut ? "loading" : undefined}
                onClick={() =>
                  void (async () => {
                    setLoggingOut(true)
                    if (isRemoteApi) {
                      try {
                        await api.logout()
                      } catch {
                        toast.warning(
                          store.locale === "zh-CN"
                            ? "服务端会话暂未撤销，已安全清除本机登录状态。"
                            : "The server session could not be revoked; local sign-in state was cleared."
                        )
                      }
                    }
                    await finishLogout()
                  })()
                }
              >
                {loggingOut ? <Spinner /> : <X />}
                <span>
                  <strong>
                    {loggingOut
                      ? store.locale === "zh-CN"
                        ? "正在退出…"
                        : "Signing out…"
                      : copy.logout}
                  </strong>
                </span>
                <ChevronRight />
              </Button>
            </div>
          </Section>
        </div>
      </div>
      <Dialog open={editingStaff !== null} onOpenChange={(open) => !open && setEditingStaff(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <UserCog />
              {editingStaff?.id
                ? store.locale === "zh-CN"
                  ? "编辑员工账号"
                  : "Edit staff account"
                : store.locale === "zh-CN"
                  ? "新增员工账号"
                  : "Add staff account"}
            </DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "管理员拥有全部权限；经理可监控、控制并处理订单与任务。"
                : "Administrators have full access; managers can monitor, control, and process operations."}
            </DialogDescription>
          </DialogHeader>
          <div className="form-grid">
            <Field
              label={store.locale === "zh-CN" ? "用户名" : "Username"}
              error={
                staffForm.formState.errors.username
                  ? store.locale === "zh-CN"
                    ? "请输入 3–32 位字母、数字或 . _ -"
                    : "Use 3–32 letters, numbers, or . _ -"
                  : undefined
              }
            >
              <Input
                autoComplete="off"
                aria-invalid={Boolean(staffForm.formState.errors.username)}
                {...staffForm.register("username")}
              />
            </Field>
            <Field
              label={store.locale === "zh-CN" ? "显示名称" : "Display name"}
              error={
                staffForm.formState.errors.displayName
                  ? store.locale === "zh-CN"
                    ? "请输入显示名称"
                    : "Enter a display name"
                  : undefined
              }
            >
              <Input
                aria-invalid={Boolean(staffForm.formState.errors.displayName)}
                {...staffForm.register("displayName")}
              />
            </Field>
            <Field
              label={store.locale === "zh-CN" ? "手机号" : "Phone"}
              error={
                staffForm.formState.errors.phone
                  ? store.locale === "zh-CN"
                    ? "请输入有效的中国大陆手机号"
                    : "Enter a valid mainland China mobile number"
                  : undefined
              }
            >
              <Input
                inputMode="tel"
                aria-invalid={Boolean(staffForm.formState.errors.phone)}
                {...staffForm.register("phone")}
              />
            </Field>
            <Field
              label={
                editingStaff?.id
                  ? store.locale === "zh-CN"
                    ? "重置密码（可选）"
                    : "Reset password (optional)"
                  : store.locale === "zh-CN"
                    ? "初始密码"
                    : "Initial password"
              }
              error={
                staffForm.formState.errors.password
                  ? store.locale === "zh-CN"
                    ? "至少需要 8 个字符"
                    : "Use at least 8 characters"
                  : undefined
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(staffForm.formState.errors.password)}
                {...staffForm.register("password")}
              />
            </Field>
            <Field label={store.locale === "zh-CN" ? "角色" : "Role"}>
              <NativeSelect
                value={staffRole}
                disabled={editingStaff?.id === store.staff?.id}
                onChange={(event) =>
                  staffForm.setValue("role", event.target.value as StaffAccount["role"], {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                <NativeSelectOption value="manager">manager</NativeSelectOption>
                <NativeSelectOption value="admin">admin</NativeSelectOption>
              </NativeSelect>
            </Field>
            {editingStaff?.id && (
              <Field label={copy.status}>
                <NativeSelect
                  value={staffEnabled ? "enabled" : "disabled"}
                  disabled={editingStaff.id === store.staff?.id}
                  onChange={(event) =>
                    staffForm.setValue("enabled", event.target.value === "enabled", {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <NativeSelectOption value="enabled">
                    {store.locale === "zh-CN" ? "启用" : "Enabled"}
                  </NativeSelectOption>
                  <NativeSelectOption value="disabled">
                    {store.locale === "zh-CN" ? "停用" : "Disabled"}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setEditingStaff(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={staffSaving}
              onClick={staffForm.handleSubmit(saveStaffAccount)}
            >
              <PendingLabel
                pending={staffSaving}
                pendingLabel={store.locale === "zh-CN" ? "保存中…" : "Saving…"}
              >
                {copy.save}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.changePassword}</DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "修改后将撤销所有活动会话，并要求重新登录。"
                : "Changing the password revokes every active session and requires a new login."}
            </DialogDescription>
          </DialogHeader>
          <Field label={store.locale === "zh-CN" ? "当前密码" : "Current password"}>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field
            label={store.locale === "zh-CN" ? "新密码" : "New password"}
            error={
              newPassword && newPassword.length < 8
                ? store.locale === "zh-CN"
                  ? "至少需要 8 个字符"
                  : "Use at least 8 characters"
                : undefined
            }
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setPasswordOpen(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={!currentPassword || newPassword.length < 8}
              onClick={() =>
                void executeAction(
                  () => api.changePassword(currentPassword, newPassword),
                  store.locale,
                  copy.save
                ).then(async (result) => {
                  if (!result.ok) return
                  await finishLogout()
                })
              }
            >
              {copy.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.sessions}</DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "撤销不认识的设备会立即阻止其刷新登录状态。"
                : "Revoke an unknown device to prevent it from refreshing its login."}
            </DialogDescription>
          </DialogHeader>
          <div className="binding-list">
            {sessions.map((session) => (
              <div key={session.id}>
                <Radio />
                <span>
                  <strong>{session.userAgent}</strong>
                  <small>
                    {session.ipAddress} · {formatDate(session.createdAt, store.locale)}
                    {session.current ? ` · ${store.locale === "zh-CN" ? "当前" : "Current"}` : ""}
                  </small>
                </span>
                <ConfirmAction
                  trigger={
                    <Button variant="link" size="sm" className="text-button danger-text">
                      {store.locale === "zh-CN" ? "撤销" : "Revoke"}
                    </Button>
                  }
                  title={store.locale === "zh-CN" ? "确认撤销会话" : "Revoke session?"}
                  description={
                    session.current
                      ? store.locale === "zh-CN"
                        ? "这是当前会话，撤销后将立即退出登录。"
                        : "This is the current session. Revoking it signs you out immediately."
                      : store.locale === "zh-CN"
                        ? "该设备将无法继续刷新登录状态。"
                        : "This device will no longer be able to refresh its session."
                  }
                  cancelLabel={copy.cancel}
                  confirmLabel={store.locale === "zh-CN" ? "确认撤销" : "Revoke"}
                  onConfirm={() => {
                    void executeAction(() => api.revokeSession(session.id), store.locale).then(
                      async (result) => {
                        if (!result.ok) return
                        setSessions((items) => items.filter((item) => item.id !== session.id))
                        if (session.current) {
                          await finishLogout()
                        }
                      }
                    )
                  }}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LoginView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [username, setUsername] = useState("admin")
  const [password, setPassword] = useState("admin123")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      if (isRemoteApi) {
        const { api } = await import("@/lib/api/client")
        const staff = await api.login(username, password)
        useProductStore.setState({ authenticated: true, staff })
      } else {
        resumeSessionRecovery()
        if (!store.login(username, password)) throw new Error("invalid")
      }
      window.location.href = "/"
    } catch {
      setError(copy.loginError)
    } finally {
      setLoading(false)
    }
  }
  return (
    <main className="login-page">
      <section className="login-intro">
        <span className="brand-mark">鸢</span>
        <p>{copy.console}</p>
        <h1>{store.locale === "zh-CN" ? "看清状态，再下指令。" : "Read the state. Then act."}</h1>
        <div className="login-signals">
          <span>
            <i />
            {copy.live}
          </span>
          <span>6 UAV</span>
          <span>3 POD</span>
        </div>
      </section>
      <section className="login-form-panel">
        <Button
          className="locale-button"
          onClick={() => store.setLocale(store.locale === "zh-CN" ? "en" : "zh-CN")}
        >
          {store.locale === "zh-CN" ? "EN" : "中"}
        </Button>
        <form onSubmit={submit}>
          <h2>{copy.login}</h2>
          <p>{copy.loginIntro}</p>
          <Field label={copy.username}>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label={copy.password} error={error}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Button className="button button-primary button-wide" disabled={loading}>
            <PendingLabel
              pending={loading}
              pendingLabel={store.locale === "zh-CN" ? "登录中…" : "Signing in…"}
            >
              {copy.login}
            </PendingLabel>
          </Button>
          <small>{copy.loginDemo}</small>
        </form>
        <footer>© 2026 · ZHIYUAN OPERATIONS · v1.0.0</footer>
      </section>
    </main>
  )
}

export function ProductPage({ view }: { view: ProductView }) {
  const authenticated = useProductStore((state) => state.authenticated)
  if (view === "login") return <LoginView />
  if (!authenticated) return <LoginView />
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
