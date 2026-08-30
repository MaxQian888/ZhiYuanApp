"use client"

import Script from "next/script"
import { useEffect, useRef, useState } from "react"
import type { Coordinate } from "@/lib/map"
import { toAmapPosition, type AmapPosition } from "@/lib/map/amap-provider"

interface AmapMapInstance {
  add(overlays: object[]): void
  clearMap(): void
  destroy(): void
  setZoomAndCenter(zoom: number, center: AmapPosition): void
}

interface AmapSdk {
  Map: new (
    container: HTMLElement,
    options: { center: AmapPosition; viewMode: "2D"; zoom: number }
  ) => AmapMapInstance
  Marker: new (options: { position: AmapPosition; title: string }) => object
  Polyline: new (options: {
    path: AmapPosition[]
    strokeColor: string
    strokeOpacity: number
    strokeWeight: number
  }) => object
}

interface AmapLoader {
  load(options: { key: string; version: "2.0" }): Promise<AmapSdk>
}

declare global {
  interface Window {
    AMapLoader?: AmapLoader
    _AMapSecurityConfig?: { serviceHost: string }
  }
}

interface AmapSurfaceProps {
  apiKey: string
  center: Coordinate
  current: Coordinate
  errorText: string
  label: string
  loadingText: string
  serviceHost?: string
  track: Coordinate[]
  zoom: number
}

/**
 * The client-only AMap rendering edge. All props remain WGS-84; conversion occurs only when
 * a position is handed to the SDK, so shifted coordinates never re-enter platform state.
 */
export function AmapSurface({
  apiKey,
  center,
  current,
  errorText,
  label,
  loadingText,
  serviceHost,
  track,
  zoom,
}: AmapSurfaceProps) {
  const centerLatitude = center.latitude
  const centerLongitude = center.longitude
  const currentLatitude = current.latitude
  const currentLongitude = current.longitude
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AmapMapInstance | null>(null)
  const sdkRef = useRef<AmapSdk | null>(null)
  const activeRef = useRef(true)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      mapRef.current?.destroy()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    map.setZoomAndCenter(
      zoom,
      toAmapPosition({ latitude: centerLatitude, longitude: centerLongitude })
    )
  }, [centerLatitude, centerLongitude, zoom, state])

  useEffect(() => {
    const map = mapRef.current
    const sdk = sdkRef.current
    if (!map || !sdk) return

    map.clearMap()
    const currentPosition = toAmapPosition({
      latitude: currentLatitude,
      longitude: currentLongitude,
    })
    const overlays: object[] = []
    if (track.length > 0) {
      overlays.push(
        new sdk.Polyline({
          path: [...track.map(toAmapPosition), currentPosition],
          strokeColor: "#0f766e",
          strokeOpacity: 0.9,
          strokeWeight: 4,
        })
      )
    }
    overlays.push(new sdk.Marker({ position: currentPosition, title: label }))
    map.add(overlays)
  }, [currentLatitude, currentLongitude, label, track, state])

  const initializeMap = (sdk: AmapSdk) => {
    const container = containerRef.current
    if (!activeRef.current) return
    if (!container) {
      setState("error")
      return
    }
    sdkRef.current = sdk
    if (!mapRef.current) {
      mapRef.current = new sdk.Map(container, {
        center: toAmapPosition(center),
        viewMode: "2D",
        zoom,
      })
    }
    setState("ready")
  }

  const loadMapSdk = () => {
    const loader = window.AMapLoader
    if (!loader) {
      setState("error")
      return
    }
    if (serviceHost) window._AMapSecurityConfig = { serviceHost }
    void loader.load({ key: apiKey, version: "2.0" }).then(initializeMap, () => {
      if (activeRef.current) setState("error")
    })
  }

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />
      {state === "loading" ? (
        <span
          className="absolute left-1/2 top-1/2 z-[1] max-w-[min(28rem,80%)] -translate-x-1/2 -translate-y-1/2 border border-[var(--color-rule-2)] bg-[var(--color-paper)] px-[var(--space-md)] py-[var(--space-sm)] text-center text-[length:var(--text-sm)] text-[var(--color-muted)]"
          aria-live="polite"
        >
          {loadingText}
        </span>
      ) : null}
      {state === "error" ? (
        <span
          className="absolute left-1/2 top-1/2 z-[1] max-w-[min(28rem,80%)] -translate-x-1/2 -translate-y-1/2 border border-[var(--color-rule-2)] bg-[var(--color-paper)] px-[var(--space-md)] py-[var(--space-sm)] text-center text-[length:var(--text-sm)] text-[var(--color-danger)]"
          role="alert"
        >
          {errorText}
        </span>
      ) : null}
      <Script
        id="amap-js-api-loader"
        src="https://webapi.amap.com/loader.js"
        strategy="afterInteractive"
        onReady={loadMapSdk}
        onError={() => setState("error")}
      />
    </>
  )
}
