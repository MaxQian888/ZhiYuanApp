export function versionMismatches(canonical: string, versions: Record<string, string>): string[]
export function assertVersionSync(projectRoot: string): string
export function assertTagVersion(canonical: string, tag: string): string
export function azureSignCommand(options: {
  endpoint: string
  account: string
  profile: string
}): string
export function missingSigningConfiguration(
  platform: NodeJS.Platform,
  environment: Record<string, string | undefined>
): string[]
export function createReleaseOverlay(options: {
  channel: string
  publicKey: string
  updateBaseUrl: string
  frontendPrebuilt?: boolean
}): Record<string, unknown>
export function createDesktopCsp(
  baseCsp: string,
  options: { apiUrl: string; asrWebsocketUrl?: string }
): string
export function createUpdateManifest(options: {
  version: string
  notes: string
  publishedAt: string
  platforms: Array<{ target: string; url: string; signature: string }>
}): Record<string, unknown>
export function validatePromotableManifest(
  manifest: Record<string, unknown>
): Record<string, unknown>
