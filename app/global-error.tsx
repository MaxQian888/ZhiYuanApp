"use client"

import { useEffect } from "react"

/**
 * The last line of defence: an error thrown by the root layout itself.
 *
 * This replaces the whole document, so it has to supply `<html>` and `<body>` — the layout
 * that would normally provide them is exactly what failed. For the same reason it carries
 * inline styles and no imports beyond React: any provider, font or stylesheet it depended on
 * could be the thing that is broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Root layout error", error)
  }, [error])

  return (
    <html lang="zh-CN">
      <body
        style={{
          display: "flex",
          minHeight: "100dvh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          margin: 0,
          background: "#0b0b0c",
          color: "#f5f5f4",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
          智鸢控制台无法启动 · The console failed to start
        </h1>
        <p style={{ maxWidth: "40rem", color: "#a1a1aa", fontSize: "0.875rem" }}>{error.message}</p>
        {error.digest && <code style={{ color: "#71717a" }}>digest {error.digest}</code>}
        <button
          type="button"
          onClick={reset}
          style={{
            border: "1px solid #f5f5f4",
            padding: "0.5rem 1.25rem",
            background: "transparent",
            color: "#f5f5f4",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          重试 · Retry
        </button>
      </body>
    </html>
  )
}
