export function httpsUrl(value: string, name: string): URL
export function httpsOrigin(value: string, name: string): string
export function mergeConfig(
  base: Record<string, unknown>,
  addition: Record<string, unknown>
): Record<string, unknown>
export function addCspSources(baseCsp: string, additions: Record<string, string[]>): string
export function forwardedBuildArgs(args: string[]): string[]
export function runTauriBuild(options: {
  args: string[]
  env: NodeJS.ProcessEnv
  overlay: Record<string, unknown>
  projectRoot: string
}): void
