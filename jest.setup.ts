/**
 * Jest setup file
 * This file is executed before each test file
 */

import "@testing-library/jest-dom"
import React from "react"
import { TextDecoder, TextEncoder } from "node:util"

// jsdom ships neither encoder. Both are used by the SSE reader in lib/api/client.ts
// and by the desktop credential vault in lib/tauri.ts.
Object.assign(globalThis, {
  TextEncoder: globalThis.TextEncoder ?? TextEncoder,
  TextDecoder: globalThis.TextDecoder ?? TextDecoder,
})

// jsdom implements neither observer, and every floating shadcn/Radix surface
// (tooltip, popover, select, dialog) measures its anchor on open.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver

// jsdom has no layout engine, so these are unimplemented rather than missing.
Element.prototype.scrollIntoView ??= jest.fn()
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= jest.fn()
Element.prototype.releasePointerCapture ??= jest.fn()

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: jest.fn(),
  removeListener: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
})) as unknown as typeof window.matchMedia

process.env.NEXT_PUBLIC_API_MODE = "simulator"

type MockNextImageProps = React.ComponentPropsWithoutRef<"img"> & {
  priority?: boolean
  fill?: boolean
}

// Mock Next.js Image component
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: MockNextImageProps) => {
    const normalizedProps = { ...props }
    delete normalizedProps.priority
    delete normalizedProps.fill
    return React.createElement("img", normalizedProps)
  },
}))

// Mock Next.js router
jest.mock("next/navigation", () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      pathname: "/",
      query: {},
      asPath: "/",
    }
  },
  usePathname() {
    return "/"
  },
  useSearchParams() {
    return new URLSearchParams()
  },
}))

// Suppress console errors in tests (optional)
// global.console = {
//   ...console,
//   error: jest.fn(),
//   warn: jest.fn(),
// };
