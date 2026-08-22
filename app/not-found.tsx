import Link from "next/link"
import { Button } from "@/components/ui/button"

/**
 * A route that does not exist.
 *
 * Under `output: "export"` this becomes 404.html, which is also what the Tauri window shows
 * when a deep link points at a route the bundled build does not contain — the most likely
 * way anyone reaches this page in practice.
 */
export default function NotFound() {
  return (
    <div className="route-error">
      <span className="brand-mark">鸢</span>
      <h1>页面不存在 · No such page</h1>
      <p className="route-error-detail">
        该地址没有对应的页面。 · This address does not match any view in the console.
      </p>
      <div className="route-error-actions">
        <Button className="button button-primary" asChild>
          <Link href="/">返回总览 · Dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
