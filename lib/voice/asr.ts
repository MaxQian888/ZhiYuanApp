/**
 * The speech-recognition port.
 *
 * Voice dispatch has to work in three quite different places — a browser tab, a Tauri
 * window, and a test — and the recognisers available in each have nothing in common. This
 * interface is what the voice view codes against so that swapping recognisers is a
 * configuration change rather than a rewrite.
 *
 * One rule binds every implementation: **captured audio lives in memory and is never
 * persisted.** No blob is written to disk, no recording is kept after the session ends, and
 * nothing is retained for "debugging". Operator voice is dispatch traffic, not a corpus. The
 * transcript is the artefact worth keeping, and that is what reaches the store.
 */

/** Why a session ended badly, in terms the UI can act on. */
export type AsrFailure =
  | "unsupported" // no recogniser in this runtime
  | "permission-denied" // the operator declined the microphone
  | "network" // the recogniser could not be reached
  | "no-speech" // capture worked, nothing was said
  | "failed" // anything else

export interface AsrCallbacks {
  /** Best guess so far. Fires repeatedly; the UI shows it but must not act on it. */
  onPartial?: (transcript: string) => void
  /** The recogniser's settled answer. This is what gets parsed into a command. */
  onFinal: (transcript: string) => void
  onFailure: (failure: AsrFailure) => void
  /** Always fires exactly once, whether the session succeeded, failed or was aborted. */
  onEnd: () => void
}

export interface AsrSession {
  /** Stop capturing and let the recogniser finish; a final transcript may still arrive. */
  stop(): void
  /** Stop capturing and discard whatever was in flight. No final transcript will arrive. */
  abort(): void
}

export interface AsrAdapter {
  readonly name: string
  /** Whether this runtime can actually run the recogniser, checked before offering the UI. */
  available(): boolean
  start(options: { locale: string }, callbacks: AsrCallbacks): Promise<AsrSession>
}

/**
 * The adapter used when voice capture is not configured or not possible.
 *
 * It reports unavailable and fails cleanly if started anyway, so the voice view has no
 * null-adapter branch to get wrong. The typed fallback in that view is always present, which
 * is what makes an absent recogniser a degradation rather than an outage.
 */
export const unavailableAsrAdapter: AsrAdapter = {
  name: "NONE",
  available: () => false,
  start: async (_options, callbacks) => {
    callbacks.onFailure("unsupported")
    callbacks.onEnd()
    return { stop: () => undefined, abort: () => undefined }
  },
}
