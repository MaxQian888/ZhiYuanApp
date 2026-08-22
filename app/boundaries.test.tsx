import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderToStaticMarkup } from "react-dom/server"
import RouteError from "@/app/error"
import GlobalError from "@/app/global-error"
import NotFound from "@/app/not-found"

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

let consoleError: jest.SpyInstance

beforeEach(() => {
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  consoleError.mockRestore()
})

describe("RouteError", () => {
  it("shows the actual failure rather than hiding it behind a generic apology", () => {
    // Operators have a support channel. A message they can repeat is worth an hour of
    // someone's day; "something went wrong" is not.
    render(
      <RouteError error={new Error("Cannot read properties of undefined")} reset={jest.fn()} />
    )

    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText("Cannot read properties of undefined")).toBeInTheDocument()
  })

  it("shows the digest when the runtime supplies one", () => {
    const error = Object.assign(new Error("boom"), { digest: "a1b2c3" })
    render(<RouteError error={error} reset={jest.fn()} />)

    expect(screen.getByText("digest a1b2c3")).toBeInTheDocument()
  })

  it("offers a retry that re-renders the segment, and a way back to the dashboard", async () => {
    const user = userEvent.setup()
    const reset = jest.fn()
    render(<RouteError error={new Error("boom")} reset={reset} />)

    await user.click(screen.getByRole("button", { name: /Retry/ }))

    expect(reset).toHaveBeenCalled()
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("href", "/")
  })

  it("logs the error so it survives the operator navigating away", () => {
    const error = new Error("boom")
    render(<RouteError error={error} reset={jest.fn()} />)

    expect(consoleError).toHaveBeenCalledWith("Route error", error)
  })
})

describe("GlobalError", () => {
  // Rendered to markup rather than into the test DOM: it supplies its own <html> and <body>,
  // which is the whole point of it — the layout that would normally provide them is what
  // failed.
  const markup = () =>
    renderToStaticMarkup(<GlobalError error={new Error("layout exploded")} reset={jest.fn()} />)

  it("supplies the document itself, because the root layout is what failed", () => {
    expect(markup()).toContain("<html")
    expect(markup()).toContain("<body")
  })

  it("carries no imports or classes that the broken layout could have taken down with it", () => {
    // Inline styles only. A stylesheet or provider it depended on could be the failure.
    expect(markup()).toContain("style=")
    expect(markup()).not.toContain("class=")
  })

  it("states what failed and offers a retry", () => {
    expect(markup()).toContain("layout exploded")
    expect(markup()).toContain("Retry")
  })
})

describe("NotFound", () => {
  it("explains the address matched nothing and points back at the dashboard", () => {
    render(<NotFound />)

    expect(screen.getByRole("heading", { name: /No such page/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("href", "/")
  })
})
