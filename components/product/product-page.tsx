"use client"

import Link from "next/link"
import { useEffect, useState, useSyncExternalStore } from "react"
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
  Warehouse,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AppShell } from "@/components/product/app-shell"
import {
  EmptyState,
  Field,
  MetricStrip,
  PageHeader,
  Section,
  StatusPill,
} from "@/components/product/primitives"
import {
  filterUavs,
  parseVoiceCommand,
  type CommandType,
  type Goods,
  type ManagedUser,
  type UavStatus,
} from "@/lib/domain"
import { useCopy } from "@/lib/i18n-product"
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

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
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
          <Link className="button button-primary" href="/uavs">
            <Plane size={17} />
            {copy.uavs}
          </Link>
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
              {copy.live} · {copy.simulator}
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
                <button className="text-button" onClick={() => store.resolveAlert(alert.id)}>
                  {copy.acknowledge}
                </button>
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
  const rows = filterUavs(store.uavs, query, status)
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
          <Link href="/map" className="button button-secondary">
            <MapPin size={17} />
            {copy.map}
          </Link>
        }
      />
      <div className="filter-bar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchUav}
          />
        </label>
        <label>
          <span className="sr-only">{copy.status}</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as UavStatus | "ALL")}
          >
            <option value="ALL">{copy.allStatus}</option>
            {["ONLINE", "OFFLINE", "FLYING", "CHARGING"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <Section title={`${copy.uavs} · ${rows.length}`}>
        {rows.length ? (
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
                  <span className="battery-line">
                    <i style={{ "--battery": `${uav.battery}%` } as React.CSSProperties} />
                  </span>
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
          <button className="button button-secondary" onClick={onClose}>
            {copy.cancel}
          </button>
          <button
            className={command === "STOP" ? "button button-danger" : "button button-primary"}
            onClick={() => {
              store.sendCommand(uavId, command, "MANUAL")
              toast.success(copy.commandSent)
              onClose()
            }}
          >
            {copy.confirm}
          </button>
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
  const commands = store.commands.filter((item) => item.uavId === uav.id)
  const logs = store.flightLogs.filter((item) => item.uavId === uav.id)
  return (
    <>
      <PageHeader
        title={`${uav.code} · ${uav.name}`}
        description={`${uav.model} · ${uav.rfidTag}`}
        actions={
          <>
            <StatusPill value={uav.status} />
            <Link className="button button-secondary" href={`/map?id=${uav.id}`}>
              <MapPin size={17} />
              {copy.map}
            </Link>
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
            <button className="command-button" onClick={() => setCommand("TAKE_OFF")}>
              <Plane />
              {copy.takeOff}
              <code>TAKE_OFF</code>
            </button>
            <button className="command-button" onClick={() => setCommand("LAND")}>
              <LocateFixed />
              {copy.land}
              <code>LAND</code>
            </button>
            <button className="command-button" onClick={() => setCommand("RETURN_HOME")}>
              <RotateCcw />
              {copy.returnHome}
              <code>RETURN_HOME</code>
            </button>
            <button className="command-button command-danger" onClick={() => setCommand("STOP")}>
              <X />
              {copy.stop}
              <code>STOP</code>
            </button>
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
                <StatusPill value={item.status} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={copy.noResults} />
        )}
      </Section>
      <Section title={copy.logs}>
        {logs.length ? (
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

function MapView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const id = useUrlId(store.selectedUavId)
  const [selected, setSelected] = useState(id)
  const [zoom, setZoom] = useState(7)
  const uav = store.uavs.find((item) => item.id === selected) ?? store.uavs[0]
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
            <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
              {store.uavs.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
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
              <dd>{store.flightLogs.filter((item) => item.uavId === uav.id).length} points</dd>
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
          <svg viewBox="0 0 100 60" aria-hidden="true">
            <polyline points="10,48 25,40 37,43 52,28 68,31 84,15" />
            <circle cx="10" cy="48" r="2" />
            <circle cx="84" cy="15" r="2.8" />
          </svg>
          <div
            className="map-marker"
            style={{
              left: `${45 + uav.id * 4}%`,
              top: `${38 - uav.id * 2}%`,
              transform: `scale(${0.85 + zoom * 0.03})`,
            }}
          >
            <Plane />
            <span>{uav.code}</span>
          </div>
          <div className="map-controls">
            <button
              onClick={() => setZoom((value) => Math.min(12, value + 1))}
              aria-label={copy.zoomIn}
            >
              <Plus />
            </button>
            <button
              onClick={() => setZoom((value) => Math.max(3, value - 1))}
              aria-label={copy.zoomOut}
            >
              <Minus />
            </button>
            <button onClick={() => setSelected(uav.id)} aria-label={copy.center}>
              <Crosshair />
            </button>
          </div>
          <span className="provider-label">TEST MAP PROVIDER · Z{zoom}</span>
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
          <button className="button button-primary" onClick={record}>
            {recording ? <Radio /> : <Mic />}
            {recording ? copy.stopRecording : copy.startRecording}
          </button>
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
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                store.locale === "zh-CN" ? "例如：无人机一号起飞" : "Example: stop UAV-02"
              }
            />
          </Field>
          <button className="button button-secondary" onClick={() => parse(text)}>
            {copy.parse}
          </button>
          {parsed && (
            <div className="parsed-command">
              <Check />
              <span>
                <strong>{store.uavs.find((item) => item.id === parsed.uavId)?.code}</strong>
                <code>{parsed.type}</code>
              </span>
              <button
                className="button button-primary"
                onClick={() => {
                  store.sendCommand(parsed.uavId, parsed.type, "VOICE", parsed.transcript)
                  toast.success(copy.commandSent)
                  setParsed(null)
                }}
              >
                {copy.confirm}
              </button>
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
        <Section title={`${copy.alerts} · ${store.alerts.length}`}>
          <div className="data-table compact">
            <div className="table-head">
              <span>{copy.alerts}</span>
              <span>{copy.uavs}</span>
              <span>{copy.status}</span>
              <span>{copy.updated}</span>
              <span>{copy.action}</span>
            </div>
            {store.alerts.map((item) => (
              <div className="table-row" key={item.id}>
                <span data-label={copy.alerts}>
                  <strong>{item.title}</strong>
                </span>
                <span data-label={copy.uavs}>
                  {item.uavId ? store.uavs.find((uav) => uav.id === item.uavId)?.code : "POD-03"}
                </span>
                <span data-label={copy.status}>
                  <StatusPill value={item.resolved ? "RESOLVED" : item.level} />
                </span>
                <span data-label={copy.updated}>{formatDate(item.occurredAt, store.locale)}</span>
                <span data-label={copy.action}>
                  {!item.resolved && (
                    <button className="text-button" onClick={() => store.resolveAlert(item.id)}>
                      {copy.acknowledge}
                    </button>
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
        <div className="timeline">
          {[
            ...store.commands.map((item) => ({
              id: item.id,
              icon: Radio,
              title: `${item.type} · ${item.status}`,
              detail: `${item.source} · ${store.uavs.find((uav) => uav.id === item.uavId)?.code}`,
              time: item.createdAt,
            })),
            ...store.flightLogs.map((item) => ({
              id: `f-${item.id}`,
              icon: Plane,
              title: item.event,
              detail: item.detail,
              time: item.occurredAt,
            })),
          ]
            .sort((a, b) => b.time.localeCompare(a.time))
            .map((item) => (
              <div key={item.id}>
                <item.icon />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.detail} · {formatDate(item.time, store.locale)}
                  </small>
                </span>
              </div>
            ))}
        </div>
      </Section>
    </>
  )
}

function UsersView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [editing, setEditing] = useState<Partial<ManagedUser> | null>(null)
  const [addressUser, setAddressUser] = useState<number | null>(null)
  const save = () => {
    if (!editing?.username || !/^1\d{10}$/.test(editing.phone ?? "")) return
    store.saveUser({ id: editing.id, username: editing.username, phone: editing.phone! })
    setEditing(null)
    toast.success(copy.save)
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
          <button className="button button-primary" onClick={() => setEditing({})}>
            <Plus />
            {copy.add}
          </button>
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
                <button className="text-button" onClick={() => setAddressUser(user.id)}>
                  {user.addresses.length} · {copy.edit}
                </button>
              </span>
              <span data-label={copy.updated}>{formatDate(user.createdAt, store.locale)}</span>
              <span data-label={copy.action}>
                <button className="text-button" onClick={() => setEditing(user)}>
                  {copy.edit}
                </button>
                <button
                  className="text-button danger-text"
                  onClick={() => store.deleteUser(user.id)}
                >
                  {copy.delete}
                </button>
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
            <input
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
            <input
              value={editing?.phone ?? ""}
              onChange={(event) => setEditing((value) => ({ ...value, phone: event.target.value }))}
            />
          </Field>
          <DialogFooter>
            <button className="button button-secondary" onClick={() => setEditing(null)}>
              {copy.cancel}
            </button>
            <button className="button button-primary" onClick={save}>
              {copy.save}
            </button>
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
  if (!userId || !user) return null
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
            </div>
          ))}
        </div>
        <Field label={store.locale === "zh-CN" ? "新地址" : "New address"}>
          <input value={detail} onChange={(event) => setDetail(event.target.value)} />
        </Field>
        <DialogFooter>
          <button className="button button-secondary" onClick={onClose}>
            {copy.cancel}
          </button>
          <button
            className="button button-primary"
            onClick={() => {
              if (!detail.trim()) return
              store.saveAddress(userId, {
                receiverName: user.username,
                receiverPhone: user.phone,
                detail,
                latitude: 32.06,
                longitude: 118.78,
                isDefault: true,
              })
              setDetail("")
              toast.success(copy.save)
            }}
          >
            {copy.add}
          </button>
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
  const save = () => {
    if (!editing?.name) return
    store.saveGoods({
      id: editing.id,
      name: editing.name,
      category: editing.category ?? "life",
      price: Number(editing.price ?? 0),
      stock: Number(editing.stock ?? 0),
      weight: Number(editing.weight ?? 0),
      status: editing.status ?? 1,
    })
    setEditing(null)
    toast.success(copy.save)
  }
  const categoryCounts = ["food", "medicine", "life", "industry"].map((category) => ({
    label: category.toUpperCase(),
    value: store.goods.filter((item) => item.category === category).length,
  }))
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
            <button
              className="button button-secondary"
              disabled={!selected.length}
              onClick={() => {
                store.deleteGoods(selected)
                setSelected([])
              }}
            >
              {copy.delete} ({selected.length})
            </button>
            <button className="button button-primary" onClick={() => setEditing({})}>
              <Plus />
              {copy.add}
            </button>
          </>
        }
      />
      <MetricStrip items={categoryCounts} />
      <Section title={`${copy.goods} · ${store.goods.length}`}>
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
          {store.goods.map((item) => (
            <div className="table-row" key={item.id}>
              <span>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={() =>
                    setSelected((value) =>
                      value.includes(item.id)
                        ? value.filter((id) => id !== item.id)
                        : [...value, item.id]
                    )
                  }
                  aria-label={`Select ${item.name}`}
                />
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
                <button className="text-button" onClick={() => store.toggleGoods(item.id)}>
                  {item.status ? copy.disable : copy.enable}
                </button>
                <button className="text-button" onClick={() => setEditing(item)}>
                  {copy.edit}
                </button>
              </span>
            </div>
          ))}
        </div>
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
              <input
                value={editing?.name ?? ""}
                onChange={(e) => setEditing((v) => ({ ...v, name: e.target.value }))}
              />
            </Field>
            <Field label="Category">
              <select
                value={editing?.category ?? "life"}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, category: e.target.value as Goods["category"] }))
                }
              >
                {["food", "medicine", "life", "industry"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="Price">
              <input
                type="number"
                min="0"
                value={editing?.price ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, price: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Stock">
              <input
                type="number"
                min="0"
                value={editing?.stock ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, stock: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Weight">
              <input
                type="number"
                min="0"
                step="0.1"
                value={editing?.weight ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, weight: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <DialogFooter>
            <button className="button button-secondary" onClick={() => setEditing(null)}>
              {copy.cancel}
            </button>
            <button className="button button-primary" onClick={save}>
              {copy.save}
            </button>
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
      />
      <Section title={`${copy.orders} · ${store.orders.length}`}>
        <div className="data-table compact">
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
        <select value={uavId} onChange={(event) => setUavId(Number(event.target.value))}>
          {store.uavs
            .filter((item) => item.status === "ONLINE")
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.battery}%
              </option>
            ))}
        </select>
        <button
          className="button button-primary"
          disabled={order.status !== "CREATED"}
          onClick={() => {
            if (store.dispatchOrder(orderId, uavId)) toast.success(copy.dispatch)
          }}
        >
          {copy.dispatch}
        </button>
        <button
          className="button button-danger"
          disabled={!["CREATED", "DISPATCHING"].includes(order.status)}
          onClick={() => {
            if (store.transitionOrder(orderId, "CANCELLED")) toast.success(copy.cancelOrder)
          }}
        >
          {copy.cancelOrder}
        </button>
      </div>
    </Section>
  )
}

function TasksView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
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
              <div>
                {task.taskStatus === "WAITING" && (
                  <button
                    className="text-button"
                    onClick={() => store.transitionTask(task.id, "FLYING")}
                  >
                    {copy.startTask}
                  </button>
                )}
                {task.taskStatus === "FLYING" && (
                  <>
                    <button
                      className="text-button"
                      onClick={() => store.transitionTask(task.id, "ARRIVED")}
                    >
                      {copy.arrive}
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() => store.transitionTask(task.id, "FAILED")}
                    >
                      {copy.fail}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function SettingsView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [name, setName] = useState(store.staff?.displayName ?? "")
  const [updateMessage, setUpdateMessage] = useState("")
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null)
  const bindings = store.bindings.filter((item) => item.staffId === store.staff?.id)
  useEffect(() => {
    void getPlatformInfo()
      .then(setPlatformInfo)
      .catch(() => setPlatformInfo(null))
  }, [])
  const checkUpdate = async () => {
    if (!isTauri()) {
      setUpdateMessage(copy.updateUnavailable)
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
          <a href="#security">{copy.security}</a>
          <a href="#bindings">{copy.bindings}</a>
          <a href="#about">{copy.about}</a>
        </nav>
        <div>
          <Section title={copy.profile}>
            <div id="profile" className="form-inline">
              <Field label={store.locale === "zh-CN" ? "显示名称" : "Display name"}>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={store.locale === "zh-CN" ? "角色" : "Role"}>
                <input disabled value={store.staff?.role ?? "—"} />
              </Field>
              <button
                className="button button-primary"
                onClick={() => {
                  store.updateStaff({ displayName: name })
                  toast.success(copy.save)
                }}
              >
                {copy.save}
              </button>
            </div>
          </Section>
          <Section title={copy.security}>
            <div id="security" className="settings-rows">
              <button>
                <ShieldCheck />
                <span>
                  <strong>{copy.changePassword}</strong>
                  <small>
                    {store.locale === "zh-CN" ? "最近更新于 2026-07-10" : "Last updated 2026-07-10"}
                  </small>
                </span>
                <ChevronRight />
              </button>
              <button>
                <Radio />
                <span>
                  <strong>{copy.sessions}</strong>
                  <small>
                    {store.locale === "zh-CN"
                      ? "当前桌面客户端 · 南京"
                      : "Current desktop client · Nanjing"}
                  </small>
                </span>
                <ChevronRight />
              </button>
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
                  <button className="text-button" onClick={() => store.unbindDevice(binding.id)}>
                    {store.locale === "zh-CN" ? "解绑" : "Unbind"}
                  </button>
                </div>
              ))}
              <select
                onChange={(e) => {
                  if (e.target.value) store.bindDevice(Number(e.target.value))
                  e.target.value = ""
                }}
                defaultValue=""
              >
                <option value="" disabled>
                  {store.locale === "zh-CN" ? "绑定其他设备" : "Bind another device"}
                </option>
                {store.uavs
                  .filter((uav) => !bindings.some((binding) => binding.uavId === uav.id))
                  .map((uav) => (
                    <option key={uav.id} value={uav.id}>
                      {uav.code}
                    </option>
                  ))}
              </select>
            </div>
          </Section>
          <Section title={copy.about}>
            <div id="about" className="settings-rows">
              <button
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
              </button>
              <button onClick={checkUpdate}>
                <RotateCcw />
                <span>
                  <strong>{copy.checkUpdate}</strong>
                  <small>{updateMessage || "v1.0.0"}</small>
                </span>
                <ChevronRight />
              </button>
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
              <button
                className="danger-row"
                onClick={() => {
                  if (process.env.NEXT_PUBLIC_API_MODE === "remote") {
                    void import("@/lib/api/client").then(({ api }) => api.logout())
                  }
                  store.logout()
                  window.location.href = "/login"
                }}
              >
                <X />
                <span>
                  <strong>{copy.logout}</strong>
                </span>
                <ChevronRight />
              </button>
            </div>
          </Section>
        </div>
      </div>
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
      if (process.env.NEXT_PUBLIC_API_MODE === "remote") {
        const { api } = await import("@/lib/api/client")
        const staff = await api.login(username, password)
        useProductStore.setState({ authenticated: true, staff })
      } else if (!store.login(username, password)) {
        throw new Error("invalid")
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
        <button
          className="locale-button"
          onClick={() => store.setLocale(store.locale === "zh-CN" ? "en" : "zh-CN")}
        >
          {store.locale === "zh-CN" ? "EN" : "中"}
        </button>
        <form onSubmit={submit}>
          <h2>{copy.login}</h2>
          <p>{copy.loginIntro}</p>
          <Field label={copy.username}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label={copy.password} error={error}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <button className="button button-primary button-wide" disabled={loading}>
            {loading ? (store.locale === "zh-CN" ? "登录中…" : "Signing in…") : copy.login}
          </button>
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
          © 2026 · ZHIYUAN OPERATIONS · API v1 ·{" "}
          {process.env.NEXT_PUBLIC_API_MODE === "remote" ? "REMOTE" : "SIMULATOR"}
        </footer>
      </main>
    </AppShell>
  )
}
