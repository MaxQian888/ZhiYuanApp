// NOTE: The Tauri production CSP is set in src-tauri/tauri.conf.json.
// If you call an external API from the browser, add its origin to the
// `connect-src` directive there, otherwise the request will be blocked.
import type { Metadata } from "next"
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google"
import { ProductProviders } from "@/components/product/providers"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"
import "./product.css"

/*
 * One superfamily, three roles.
 *
 * Plex was drawn for technical documentation, and its sans and mono share proportions and
 * skeletons. Setting a fleet table in Plex Sans and its RFID tags in Plex Mono keeps the
 * two aligned on the same baseline rhythm, which two unrelated families never manage.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
})

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "智鸢 · 无人机运营控制台",
  description: "无人机、休眠仓、订单与配送任务的一体化运营控制台",
  applicationName: "智鸢运营平台",
  icons: {
    icon: [
      { url: "/zhiyuan-app-icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
        <TooltipProvider delayDuration={900}>
          <ProductProviders>{children}</ProductProviders>
        </TooltipProvider>
      </body>
    </html>
  )
}
