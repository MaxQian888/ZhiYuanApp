"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Activity,
  AlertTriangle,
  Boxes,
  Building2,
  ClipboardList,
  Command as CommandIcon,
  FileClock,
  Home,
  Languages,
  Mic,
  Package,
  Plane,
  RefreshCw,
  Search,
  Settings,
  UserRound,
  Users,
  Warehouse,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { DesktopTitlebar } from "@/components/product/desktop-titlebar"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useCopy } from "@/lib/i18n-product"
import { api } from "@/lib/api/client"
import { isRemoteApi } from "@/lib/env"
import { syncResourceKeys } from "@/lib/sync-state"
import { useTauriRuntime } from "@/hooks/use-tauri-runtime"
import { extractSingleInstanceRoute, listenForSecondInstance } from "@/lib/tauri"
import { useProductStore } from "@/stores/product-store"

const nav = [
  { href: "/", key: "dashboard", icon: Home, code: "01" },
  { href: "/uavs", key: "uavs", icon: Plane, code: "02" },
  { href: "/voice", key: "voice", icon: Mic, code: "03" },
  { href: "/alerts", key: "alerts", icon: AlertTriangle, code: "04" },
  { href: "/logs", key: "logs", icon: FileClock, code: "05" },
  { href: "/pods", key: "pods", icon: Warehouse, code: "06" },
  { href: "/users", key: "users", icon: Users, code: "07" },
  { href: "/goods", key: "goods", icon: Package, code: "08" },
  { href: "/orders", key: "orders", icon: ClipboardList, code: "09" },
  { href: "/tasks", key: "tasks", icon: Boxes, code: "10" },
  { href: "/settings", key: "settings", icon: Settings, code: "11" },
] as const

const navGroups = [
  { label: { "zh-CN": "监控", en: "Monitor" }, items: nav.slice(0, 4) },
  { label: { "zh-CN": "运维", en: "Operations" }, items: nav.slice(4, 6) },
  { label: { "zh-CN": "业务", en: "Business" }, items: nav.slice(6, 10) },
  { label: { "zh-CN": "系统", en: "System" }, items: nav.slice(10) },
] as const

const mobileNav = [
  nav[0],
  nav[1],
  nav[2],
  { href: "/orders", key: "business", icon: Building2 } as const,
  { href: "/settings", key: "mine", icon: UserRound } as const,
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [remoteResults, setRemoteResults] = useState<Awaited<ReturnType<typeof api.search>>>([])
  const desktopRuntime = useTauriRuntime()
  const locale = useProductStore((state) => state.locale)
  const setLocale = useProductStore((state) => state.setLocale)
  const uavs = useProductStore((state) => state.uavs)
  const users = useProductStore((state) => state.users)
  const orders = useProductStore((state) => state.orders)
  const goods = useProductStore((state) => state.goods)
  const realtimeState = useProductStore((state) => state.realtimeState)
  const dataSyncPending = useProductStore((state) => state.dataSyncPending)
  const dataSyncErrors = useProductStore((state) => state.dataSyncErrors)
  const copy = useCopy(locale)
  const activeItem = nav.find(
    (item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
  )
  const routeLabel = activeItem ? copy[activeItem.key] : pathname === "/map" ? copy.map : null

  useEffect(() => {
    if (!desktopRuntime) return
    let active = true
    let stopListening: (() => void) | undefined
    void listenForSecondInstance((payload) => {
      const route = extractSingleInstanceRoute(payload.args)
      toast.info(
        locale === "zh-CN"
          ? route
            ? "已接收新的启动请求并打开目标页面"
            : "智鸢已在运行，现有窗口已恢复到前台"
          : route
            ? "A new launch request opened its target page"
            : "ZhiYuan is already running; this window is now in front"
      )
      if (route) router.push(route)
    })
      .then((unlisten) => {
        if (active) stopListening = unlisten
        else unlisten()
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        toast.error(
          locale === "zh-CN"
            ? `单实例事件监听失败：${detail}`
            : `Single-instance event listener failed: ${detail}`
        )
      })
    return () => {
      active = false
      stopListening?.()
    }
  }, [desktopRuntime, locale, router])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (!isRemoteApi || !query.trim()) {
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api
        .search(query.trim())
        .then((items) => !controller.signal.aborted && setRemoteResults(items))
        .catch(() => !controller.signal.aborted && setRemoteResults([]))
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  const searchGroups = useMemo(
    () => [
      {
        label: locale === "zh-CN" ? "页面" : "Pages",
        items: nav.map((item) => ({
          id: `page-${item.href}`,
          label: copy[item.key],
          meta: item.href,
          href: item.href,
        })),
      },
      ...(isRemoteApi && query.trim()
        ? [
            {
              label: locale === "zh-CN" ? "业务记录" : "Business records",
              items: (query.trim() ? remoteResults : []).map((item) => ({
                id: `${item.type}-${item.id}`,
                label: item.title,
                meta: item.type.toUpperCase(),
                href: item.href,
              })),
            },
          ]
        : [
            {
              label: copy.uavs,
              items: uavs.map((item) => ({
                id: `uav-${item.id}`,
                label: `${item.code} · ${item.name}`,
                meta: item.model,
                href: `/uavs/detail?id=${item.id}`,
              })),
            },
            {
              label: copy.users,
              items: users.map((item) => ({
                id: `user-${item.id}`,
                label: item.username,
                meta: item.phone,
                href: `/users?id=${item.id}`,
              })),
            },
            {
              label: copy.orders,
              items: orders.map((item) => ({
                id: `order-${item.id}`,
                label: item.orderNo,
                meta: item.status,
                href: `/orders/detail?id=${item.id}`,
              })),
            },
            {
              label: copy.goods,
              items: goods.map((item) => ({
                id: `goods-${item.id}`,
                label: item.name,
                meta: item.category,
                href: `/goods?id=${item.id}`,
              })),
            },
          ]),
    ],
    [copy, goods, locale, orders, query, remoteResults, uavs, users]
  )

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  return (
    <div className={desktopRuntime ? "app-frame is-desktop" : "app-frame"}>
      {desktopRuntime && <DesktopTitlebar />}
      <header className="command-bar">
        <Link href="/" className="brand" aria-label={`${copy.brand} ${copy.console}`}>
          <span className="brand-mark" aria-hidden="true">
            鸢
          </span>
          <span>
            <strong>{copy.brand}</strong>
            <small>{copy.console}</small>
          </span>
        </Link>
        <Button
          variant="outline"
          className="search-trigger"
          type="button"
          onClick={() => setOpen(true)}
          aria-label={copy.search}
        >
          <Search size={17} aria-hidden="true" />
          <span>{copy.search}</span>
          <kbd>⌘ K</kbd>
        </Button>
        <div className="top-actions">
          {routeLabel && (
            <span className="route-context" aria-hidden="true">
              OPS / {routeLabel}
            </span>
          )}
          <span className="connection">
            <i aria-hidden="true" />
            {realtimeState === "live"
              ? copy.live
              : realtimeState === "reconnecting"
                ? locale === "zh-CN"
                  ? "重连中"
                  : "Reconnecting"
                : locale === "zh-CN"
                  ? "离线"
                  : "Offline"}{" "}
            · {isRemoteApi ? "REMOTE API" : copy.simulator}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="icon-action"
            type="button"
            onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
            aria-label="Switch language"
          >
            <Languages size={18} />
            <span>{locale === "zh-CN" ? "EN" : "中"}</span>
          </Button>
        </div>
      </header>
      {isRemoteApi && (dataSyncPending || dataSyncErrors.length > 0) && (
        <Alert className="sync-strip" variant={dataSyncErrors.length ? "destructive" : "default"}>
          {dataSyncPending && !dataSyncErrors.length ? <Spinner /> : <AlertTriangle />}
          <AlertTitle>
            {dataSyncErrors.length
              ? locale === "zh-CN"
                ? "部分运营数据同步失败"
                : "Some operations data failed to sync"
              : locale === "zh-CN"
                ? "正在同步运营数据"
                : "Syncing operations data"}
          </AlertTitle>
          <AlertDescription>
            {dataSyncErrors.length
              ? `${locale === "zh-CN" ? "失败模块" : "Failed resources"}: ${dataSyncErrors.join(", ")}`
              : locale === "zh-CN"
                ? "完成前不会使用演示数据替代真实结果。"
                : "Demo records are never substituted for live results."}
          </AlertDescription>
          {dataSyncErrors.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void queryClient.refetchQueries({
                  predicate: (query) =>
                    syncResourceKeys.includes(
                      String(query.queryKey[0]) as (typeof syncResourceKeys)[number]
                    ),
                  type: "active",
                })
              }
            >
              <RefreshCw />
              {locale === "zh-CN" ? "重试" : "Retry"}
            </Button>
          )}
        </Alert>
      )}
      <aside className="side-nav" aria-label={locale === "zh-CN" ? "主导航" : "Primary navigation"}>
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label.en}>
            <span className="nav-group-label">{group.label[locale]}</span>
            {group.items.map(({ href, key, icon: Icon, code }) => (
              <Link
                key={href}
                href={href}
                className={
                  pathname === href || (href !== "/" && pathname.startsWith(href))
                    ? "nav-link is-active"
                    : "nav-link"
                }
              >
                <Icon size={18} aria-hidden="true" />
                <span>{copy[key]}</span>
                <small aria-hidden="true">{code}</small>
              </Link>
            ))}
          </div>
        ))}
        <div className="side-status">
          <Activity size={16} />
          <span>API</span>
          <strong>{isRemoteApi ? "REMOTE" : "SIM"}</strong>
        </div>
      </aside>
      <div className="app-content">{children}</div>
      <nav
        className="mobile-nav"
        aria-label={locale === "zh-CN" ? "移动导航" : "Mobile navigation"}
      >
        {mobileNav.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={
              pathname === href || (href !== "/" && pathname.startsWith(href))
                ? "mobile-link is-active"
                : "mobile-link"
            }
          >
            <Icon size={20} aria-hidden="true" />
            <span>{copy[key]}</span>
          </Link>
        ))}
      </nav>
      <CommandDialog
        className="product-command-dialog"
        open={open}
        onOpenChange={setOpen}
        title={copy.search}
        description={
          locale === "zh-CN"
            ? "搜索并打开页面或业务记录"
            : "Search and open pages or business records"
        }
      >
        <CommandInput
          placeholder={copy.search}
          value={query}
          onValueChange={(value) => {
            setQuery(value)
            if (!value.trim()) setRemoteResults([])
          }}
        />
        <CommandList>
          <CommandEmpty>{copy.noResults}</CommandEmpty>
          {searchGroups.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.meta}`}
                  onSelect={() => go(item.href)}
                >
                  <CommandIcon />
                  <span>{item.label}</span>
                  <CommandShortcut>{item.meta}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </div>
  )
}
