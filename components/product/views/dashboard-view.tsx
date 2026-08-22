"use client"

import { AlertTriangle, Battery, ChevronRight, Plane } from "lucide-react"
import Link from "next/link"
import { MetricStrip, PageHeader, Section, StatusPill } from "@/components/product/primitives"
import { executeAction, formatDate } from "@/components/product/view-kit"
import { Button } from "@/components/ui/button"
import { isRemoteApi } from "@/lib/env"
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

export function DashboardView() {
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
            detail: store.uavs.length
              ? `${Math.round((online.length / store.uavs.length) * 100)}%`
              : "—",
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
              · {isRemoteApi ? "REMOTE API" : copy.simulator}
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
