import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const policyPath = new URL("../src-tauri/audit-policy.json", import.meta.url)
const policy = JSON.parse(readFileSync(policyPath, "utf8"))
const reviewedAt = new Date(`${policy.reviewedAt}T00:00:00Z`)
const maximumExpiry = new Date(reviewedAt)
maximumExpiry.setUTCDate(maximumExpiry.getUTCDate() + 90)
const today = new Date()
const exceptions = new Map()

for (const exception of policy.exceptions) {
  const declaredExpiry = new Date(`${exception.expiresAt}T00:00:00Z`)
  const expiry = new Date(`${exception.expiresAt}T23:59:59Z`)
  if (!exception.owner || !exception.reason || !exception.dependencyPath)
    throw new Error(`${exception.id} lacks owner, reason, or dependency path`)
  if (declaredExpiry > maximumExpiry)
    throw new Error(`${exception.id} exceeds the 90-day exception limit`)
  if (expiry < today) throw new Error(`${exception.id} exception expired on ${exception.expiresAt}`)
  if (exceptions.has(exception.id)) throw new Error(`${exception.id} is duplicated in the policy`)
  exceptions.set(exception.id, exception)
}

const result = spawnSync("cargo", ["audit", "--file", "src-tauri/Cargo.lock", "--json"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
})
if (!result.stdout) throw new Error(result.stderr || "cargo audit returned no report")
const report = JSON.parse(result.stdout)

if (report.vulnerabilities.count > 0) {
  const ids = report.vulnerabilities.list.map((item) => item.advisory.id).join(", ")
  throw new Error(`Rust vulnerabilities are blocking: ${ids}`)
}

const warnings = Object.values(report.warnings).flat()
const observed = new Set(warnings.map((item) => item.advisory.id))
const unexpected = [...observed].filter((id) => !exceptions.has(id))
const stale = [...exceptions.keys()].filter((id) => !observed.has(id))
if (unexpected.length) throw new Error(`Unreviewed Rust advisories: ${unexpected.join(", ")}`)
if (stale.length) throw new Error(`Remove resolved Rust exceptions: ${stale.join(", ")}`)

console.log(`Rust audit passed: 0 vulnerabilities, ${observed.size} reviewed warnings`)
