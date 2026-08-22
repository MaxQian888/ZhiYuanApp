"use client"

import { useQuery } from "@tanstack/react-query"
import { Mic, Plane, Radio, Warehouse } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import {
  EmptyState,
  Field,
  MetricStrip,
  PageHeader,
  PaginationControls,
  Section,
  StatusPill,
} from "@/components/product/primitives"
import { executeAction, formatDate, QueryError, QueryLoading } from "@/components/product/view-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api/client"
import { isRemoteApi } from "@/lib/env"
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

export function OperationsView({ view }: { view: "alerts" | "logs" | "pods" }) {
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
