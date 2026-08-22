import { render, screen } from "@testing-library/react"

jest.mock("@/components/product/product-page", () => ({
  ProductPage: ({ view }: { view: string }) => <main data-view={view} />,
}))

import AlertsPage from "./alerts/page"
import GoodsPage from "./goods/page"
import LoginPage from "./login/page"
import LogsPage from "./logs/page"
import MapPage from "./map/page"
import OrderDetailPage from "./orders/detail/page"
import OrdersPage from "./orders/page"
import PodsPage from "./pods/page"
import SettingsPage from "./settings/page"
import TasksPage from "./tasks/page"
import UavDetailPage from "./uavs/detail/page"
import UavsPage from "./uavs/page"
import UsersPage from "./users/page"
import VoicePage from "./voice/page"

/**
 * Every route is a thin wrapper that names one ProductPage view. The mapping is
 * the whole contract, so assert it route by route rather than smoke-rendering one.
 */
describe("route views", () => {
  it.each([
    [AlertsPage, "alerts"],
    [GoodsPage, "goods"],
    [LoginPage, "login"],
    [LogsPage, "logs"],
    [MapPage, "map"],
    [OrderDetailPage, "order-detail"],
    [OrdersPage, "orders"],
    [PodsPage, "pods"],
    [SettingsPage, "settings"],
    [TasksPage, "tasks"],
    [UavDetailPage, "uav-detail"],
    [UavsPage, "uavs"],
    [UsersPage, "users"],
    [VoicePage, "voice"],
  ])("opens the %#th route on the %s view", (Page, view) => {
    render(<Page />)
    expect(screen.getByRole("main")).toHaveAttribute("data-view", view)
  })
})
