"use client"

import { useQuery } from "@tanstack/react-query"
import { Database, LocateFixed, MapPin, Plane, Radio, RotateCcw, Search, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import {
  EmptyState,
  MetricStrip,
  PageHeader,
  PaginationControls,
  Section,
  StatusPill,
} from "@/components/product/primitives"
import {
  executeAction,
  formatDate,
  PendingLabel,
  QueryError,
  QueryLoading,
  useUrlId,
} from "@/components/product/view-kit"
import { Button } from "@/components/ui/button"
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
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api/client"
import { type CommandType, filterUavs, type UavStatus } from "@/lib/domain"
import { isRemoteApi } from "@/lib/env"
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

/**
 * Asks the platform whether it would currently accept a command for this device.
 *
 * The server gate is the authority — it checks presence *and* telemetry freshness at the
 * moment of dispatch, and a command that arrives a second late is still refused there. This
 * query only decides whether the button looks available, so that an operator sees "telemetry
 * stale" before clicking rather than as a failure toast afterwards.
 *
 * It refetches on the ground freshness budget, which is the slowest rate at which the answer
 * can change, and only for the one device on screen. Polling faster would not make the hint
 * more accurate: by the time a reply crosses the network the 2-second airborne budget has
 * already moved.
 */
function useReadiness(uavId: number | undefined) {
  return useQuery({
    queryKey: ["readiness", uavId],
    queryFn: () => api.readiness(uavId!),
    enabled: isRemoteApi && Boolean(uavId),
    refetchInterval: 5_000,
    staleTime: 0,
  })
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
  const readiness = useReadiness(uavId)
  const [pending, setPending] = useState(false)
  // Absent readiness data — simulator mode, or the check itself failing — must not block
  // control. Losing the ability to land a drone because a status endpoint is down is a worse
  // outcome than showing a button that the server may still refuse.
  const refused = readiness.data && !readiness.data.commandable ? readiness.data : null
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
        {refused && (
          <p className="command-refusal" role="alert">
            {refused.reason}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" className="button button-secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            className={command === "STOP" ? "button button-danger" : "button button-primary"}
            disabled={pending || Boolean(refused)}
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

export function UavDetailView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const id = useUrlId(store.selectedUavId)
  const uav = store.uavs.find((item) => item.id === id) ?? store.uavs[0]
  const [command, setCommand] = useState<CommandType | null>(null)
  const [retryingCommandId, setRetryingCommandId] = useState<string | null>(null)
  const readiness = useReadiness(uav?.id)
  const refused = readiness.data && !readiness.data.commandable ? readiness.data : null
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
          {refused && (
            <p className="command-refusal" role="status">
              {refused.reason}
            </p>
          )}
          <div className="command-grid">
            <Button
              variant="outline"
              className="command-button"
              disabled={Boolean(refused)}
              onClick={() => setCommand("TAKE_OFF")}
            >
              <Plane />
              {copy.takeOff}
              <code>TAKE_OFF</code>
            </Button>
            <Button
              variant="outline"
              className="command-button"
              disabled={Boolean(refused)}
              onClick={() => setCommand("LAND")}
            >
              <LocateFixed />
              {copy.land}
              <code>LAND</code>
            </Button>
            <Button
              variant="outline"
              className="command-button"
              disabled={Boolean(refused)}
              onClick={() => setCommand("RETURN_HOME")}
            >
              <RotateCcw />
              {copy.returnHome}
              <code>RETURN_HOME</code>
            </Button>
            <Button
              variant="destructive"
              className="command-button command-danger"
              disabled={Boolean(refused)}
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

export function UavListView() {
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
