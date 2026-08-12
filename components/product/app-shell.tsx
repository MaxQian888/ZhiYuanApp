"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
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
  Search,
  Settings,
  UserRound,
  Users,
  Warehouse,
} from "lucide-react"
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
import { useProductStore } from "@/stores/product-store"

const nav = [
  { href: "/", key: "dashboard", icon: Home },
  { href: "/uavs", key: "uavs", icon: Plane },
  { href: "/voice", key: "voice", icon: Mic },
  { href: "/alerts", key: "alerts", icon: AlertTriangle },
  { href: "/logs", key: "logs", icon: FileClock },
  { href: "/pods", key: "pods", icon: Warehouse },
  { href: "/users", key: "users", icon: Users },
  { href: "/goods", key: "goods", icon: Package },
  { href: "/orders", key: "orders", icon: ClipboardList },
  { href: "/tasks", key: "tasks", icon: Boxes },
  { href: "/settings", key: "settings", icon: Settings },
] as const

const mobileNav = [
  nav[0],
  nav[1],
  nav[2],
  { href: "/orders", key: "business", icon: Building2 } as const,
  { href: "/settings", key: "mine", icon: UserRound } as const,
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const locale = useProductStore((state) => state.locale)
  const setLocale = useProductStore((state) => state.setLocale)
  const uavs = useProductStore((state) => state.uavs)
  const users = useProductStore((state) => state.users)
  const orders = useProductStore((state) => state.orders)
  const goods = useProductStore((state) => state.goods)
  const copy = useCopy(locale)

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
    ],
    [copy, goods, locale, orders, uavs, users]
  )

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  return (
    <div className="app-frame">
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
        <button
          className="search-trigger"
          type="button"
          onClick={() => setOpen(true)}
          aria-label={copy.search}
        >
          <Search size={17} aria-hidden="true" />
          <span>{copy.search}</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="top-actions">
          <span className="connection">
            <i aria-hidden="true" />
            {copy.live} · {copy.simulator}
          </span>
          <button
            className="icon-action"
            type="button"
            onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
            aria-label="Switch language"
          >
            <Languages size={18} />
            <span>{locale === "zh-CN" ? "EN" : "中"}</span>
          </button>
        </div>
      </header>
      <aside className="side-nav" aria-label={locale === "zh-CN" ? "主导航" : "Primary navigation"}>
        {nav.map(({ href, key, icon: Icon }) => (
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
          </Link>
        ))}
        <div className="side-status">
          <Activity size={16} />
          <span>API</span>
          <strong>{process.env.NEXT_PUBLIC_API_MODE === "remote" ? "REMOTE" : "SIM"}</strong>
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
        <CommandInput placeholder={copy.search} />
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
