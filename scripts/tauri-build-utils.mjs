import { spawnSync } from "node:child_process"

export function httpsUrl(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`)
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${name} must be an HTTPS URL without embedded credentials`)
  }
  return url
}

export function httpsOrigin(value, name) {
  return httpsUrl(value, name).origin
}

export function mergeConfig(base, addition) {
  const output = { ...base }
  for (const [key, value] of Object.entries(addition)) {
    output[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeConfig(output[key] ?? {}, value)
        : value
  }
  return output
}

export function addCspSources(baseCsp, additions) {
  const directives = new Map(
    baseCsp
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => Boolean(name))
      .map(([name, ...sources]) => [name, sources])
  )
  for (const [name, sources] of Object.entries(additions)) {
    const existing = directives.get(name)
    if (!existing) throw new Error(`Base Tauri CSP is missing ${name}`)
    directives.set(name, [...new Set([...existing, ...sources])])
  }
  return [...directives]
    .map(([name, sources]) => `${name}${sources.length ? ` ${sources.join(" ")}` : ""}`)
    .join("; ")
}

export function forwardedBuildArgs(args) {
  return args[0] === "--" ? args.slice(1) : args
}

export function runTauriBuild({ args, env, overlay, projectRoot }) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const result = spawnSync(
    pnpm,
    ["exec", "tauri", "build", "--config", JSON.stringify(overlay), ...forwardedBuildArgs(args)],
    { cwd: projectRoot, env, stdio: "inherit" }
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
