"use client"

import { useQuery } from "@tanstack/react-query"
import { Crosshair, Minus, Plane, Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { ActionTooltip, PageHeader, StatusPill } from "@/components/product/primitives"
import { QueryLoading, useUrlId } from "@/components/product/view-kit"
import { api } from "@/lib/api/client"
import { isRemoteApi } from "@/lib/env"
import { selectMapProvider, type Coordinate, type Viewport } from "@/lib/map"
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

/**
 * Every coordinate in this component is WGS-84 — the datum the platform stores and the API
 * returns. The provider is the only thing that knows what datum the *map* draws in, and it
 * converts on both edges of its own implementation. See `lib/map/coordinates.ts`.
 */
export function MapView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const id = useUrlId(store.selectedUavId)
  const [selected, setSelected] = useState(id)
  const [zoom, setZoom] = useState(7)
  const [recentre, setRecentre] = useState<Coordinate | null>(null)
  const provider = useMemo(() => selectMapProvider(), [])
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
  const coordinates: Coordinate[] = [
    ...coordinateLogs.map((item) => ({ latitude: item.latitude, longitude: item.longitude })),
    { latitude: uav.latitude, longitude: uav.longitude },
  ]
  const minLatitude = Math.min(...coordinates.map((point) => point.latitude))
  const maxLatitude = Math.max(...coordinates.map((point) => point.latitude))
  const minLongitude = Math.min(...coordinates.map((point) => point.longitude))
  const maxLongitude = Math.max(...coordinates.map((point) => point.longitude))
  const zoomFactor = 7 / zoom
  const viewport: Viewport = {
    center: recentre ?? {
      latitude: (minLatitude + maxLatitude) / 2,
      longitude: (minLongitude + maxLongitude) / 2,
    },
    latitudeSpan: Math.max(maxLatitude - minLatitude, 0.02) * zoomFactor,
    longitudeSpan: Math.max(maxLongitude - minLongitude, 0.02) * zoomFactor,
  }
  const project = (point: Coordinate) => provider.project(point, viewport)
  const trackPoints = coordinateLogs.map((item) =>
    project({ latitude: item.latitude, longitude: item.longitude })
  )
  const currentPoint = project({ latitude: uav.latitude, longitude: uav.longitude })
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
                setRecentre(null)
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
                onClick={() => setRecentre({ latitude: uav.latitude, longitude: uav.longitude })}
                aria-label={copy.center}
              >
                <Crosshair />
              </Button>
            </ActionTooltip>
          </div>
          <span className="provider-label">
            {provider.name} · Z{zoom}
          </span>
        </div>
      </div>
    </>
  )
}
