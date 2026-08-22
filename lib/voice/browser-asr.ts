import type { AsrAdapter, AsrCallbacks, AsrFailure, AsrSession } from "@/lib/voice/asr"

/**
 * The Web Speech API recogniser.
 *
 * Chrome and Safari expose this under different names and neither implements the spec
 * exactly, so the surface we depend on is kept as small as it can be: a language, three
 * callbacks and start/stop. Audio never reaches us at all here — the browser captures and
 * recognises internally and hands back text, which satisfies the in-memory-only rule by
 * construction.
 */

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
}

type RecognitionWindow = typeof globalThis & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

function constructor() {
  if (typeof window === "undefined") return undefined
  const scope = window as RecognitionWindow
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

/** Maps the spec's error strings onto our own, so the UI never sees a vendor string. */
function classify(error: string | undefined): AsrFailure {
  if (error === "not-allowed" || error === "service-not-allowed") return "permission-denied"
  if (error === "network") return "network"
  if (error === "no-speech") return "no-speech"
  return "failed"
}

export const browserAsrAdapter: AsrAdapter = {
  name: "BROWSER",

  available: () => constructor() !== undefined,

  async start({ locale }, callbacks: AsrCallbacks): Promise<AsrSession> {
    const Recognition = constructor()
    if (!Recognition) {
      callbacks.onFailure("unsupported")
      callbacks.onEnd()
      return { stop: () => undefined, abort: () => undefined }
    }

    const recognition = new Recognition()
    recognition.lang = locale
    recognition.continuous = false
    recognition.interimResults = true

    // Set once the caller abandons the session, so a late result from the recogniser is
    // dropped instead of dispatching a command the operator has already walked away from.
    let abandoned = false
    let settled = false
    let heard = ""

    const deliver = (transcript: string) => {
      settled = true
      heard = ""
      callbacks.onFinal(transcript)
    }

    recognition.onresult = (event) => {
      if (abandoned) return
      const results = Array.from(
        { length: event.results.length },
        (_, index) => event.results[index]
      )
      const transcript = results
        .map((result) => result[0]?.transcript ?? "")
        .join("")
        .trim()
      if (!transcript) return
      if (results.some((result) => result.isFinal)) deliver(transcript)
      else {
        heard = transcript
        callbacks.onPartial?.(transcript)
      }
    }
    recognition.onerror = (event) => {
      if (!abandoned) callbacks.onFailure(classify(event.error))
    }
    recognition.onend = () => {
      // Chrome and Safari mark a result final before ending, but an operator who stops early
      // can leave the last phrase interim. Dropping it would discard something the recogniser
      // genuinely heard, and nothing is dispatched without confirmation anyway.
      if (!abandoned && !settled && heard) deliver(heard)
      callbacks.onEnd()
    }

    try {
      recognition.start()
    } catch {
      // Chrome throws if start() is called while a session is already running.
      callbacks.onFailure("failed")
      callbacks.onEnd()
    }

    return {
      stop: () => recognition.stop(),
      abort: () => {
        abandoned = true
        recognition.abort()
      },
    }
  },
}
