import type { MetadataRoute } from "next"

export const dynamic = "force-static"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "智鸢运营平台",
    short_name: "智鸢",
    description: "无人机、休眠仓、订单与配送任务的一体化运营控制台",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f9fd",
    theme_color: "#1267e8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/zhiyuan-app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  }
}
