import { getAsrGatewayUrl, getAsrProvider } from "@/lib/env"
import { unavailableAsrAdapter, type AsrAdapter } from "@/lib/voice/asr"
import { browserAsrAdapter } from "@/lib/voice/browser-asr"
import { createVolcengineAsrAdapter } from "@/lib/voice/volcengine-asr"

export type { AsrAdapter, AsrCallbacks, AsrFailure, AsrSession } from "@/lib/voice/asr"

/**
 * Picks the recogniser from configuration, falling back to the unavailable one.
 *
 * The fallback is not a failure mode: the voice view's typed input works regardless, so an
 * unconfigured recogniser costs convenience, not capability.
 */
export function selectAsrAdapter(): AsrAdapter {
  const provider = getAsrProvider()
  if (provider === "browser") return browserAsrAdapter
  if (provider === "volcengine") return createVolcengineAsrAdapter(getAsrGatewayUrl())
  return unavailableAsrAdapter
}
