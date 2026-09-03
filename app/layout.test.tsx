jest.mock("next/font/google", () => ({
  IBM_Plex_Sans: () => ({ variable: "--font-plex-sans" }),
  IBM_Plex_Mono: () => ({ variable: "--font-plex-mono" }),
}))

jest.mock("@/components/product/providers", () => ({
  ProductProviders: ({ children }: { children: React.ReactNode }) => children,
}))

import { renderToStaticMarkup } from "react-dom/server"
import RootLayout, { metadata } from "./layout"

describe("RootLayout", () => {
  it("exports product metadata", () => {
    expect(metadata).toMatchObject({
      title: "智鸢 · 无人机运营控制台",
      description: "无人机、休眠仓、订单与配送任务的一体化运营控制台",
    })
  })

  it("renders the Chinese document with all font roles", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>content</main>
      </RootLayout>
    )
    expect(markup).toContain('<html lang="zh-CN"')
    expect(markup).toContain("--font-plex-sans")
    expect(markup).toContain("--font-plex-mono")
    expect(markup).toContain("<main>content</main>")
  })
})
