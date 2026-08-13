"use client"

import Image from "next/image"
import { Minus, Square, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCopy } from "@/lib/i18n-product"
import { closeAppWindow, minimizeAppWindow, toggleMaximizeAppWindow } from "@/lib/tauri"
import { useProductStore } from "@/stores/product-store"

export function DesktopTitlebar() {
  const locale = useProductStore((state) => state.locale)
  const copy = useCopy(locale)
  const labels =
    locale === "zh-CN"
      ? { minimize: "最小化窗口", maximize: "最大化或还原窗口", close: "关闭窗口" }
      : {
          minimize: "Minimize window",
          maximize: "Maximize or restore window",
          close: "Close window",
        }

  return (
    <div
      className="desktop-titlebar"
      aria-label={locale === "zh-CN" ? "桌面窗口栏" : "Desktop window bar"}
    >
      <div
        className="desktop-titlebar-drag"
        data-tauri-drag-region=""
        onDoubleClick={() => void toggleMaximizeAppWindow()}
      >
        <Image src="/zhiyuan-app-icon.svg" alt="" width={18} height={18} draggable={false} />
        <strong data-tauri-drag-region="">{copy.brand}</strong>
        <span data-tauri-drag-region="">{copy.console}</span>
      </div>
      <div className="desktop-window-controls">
        <WindowControl label={labels.minimize} onClick={minimizeAppWindow}>
          <Minus />
        </WindowControl>
        <WindowControl label={labels.maximize} onClick={toggleMaximizeAppWindow}>
          <Square />
        </WindowControl>
        <WindowControl label={labels.close} onClick={closeAppWindow} close>
          <X />
        </WindowControl>
      </div>
    </div>
  )
}

function WindowControl({
  label,
  onClick,
  close = false,
  children,
}: {
  label: string
  onClick: () => Promise<boolean>
  close?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={close ? "desktop-window-control is-close" : "desktop-window-control"}
          aria-label={label}
          onClick={() =>
            void onClick().catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error)
              toast.error(`${label}: ${detail}`)
            })
          }
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
