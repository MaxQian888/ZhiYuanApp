import { render, screen } from "@testing-library/react"
import Home from "./page"

jest.mock("@/components/product/product-page", () => ({
  ProductPage: ({ view }: { view: string }) => <main data-view={view}>智鸢运行总览</main>,
}))

describe("Home Page", () => {
  it("opens the operations dashboard", () => {
    render(<Home />)
    expect(screen.getByRole("main")).toHaveAttribute("data-view", "dashboard")
    expect(screen.getByText("智鸢运行总览")).toBeInTheDocument()
  })
})
