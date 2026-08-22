import { browserAsrAdapter } from "@/lib/voice/browser-asr"
import type { AsrCallbacks } from "@/lib/voice/asr"

type ResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }

/** Stands in for the browser's recogniser; the tests drive its callbacks by hand. */
class FakeRecognition {
  static last: FakeRecognition | undefined
  lang = ""
  continuous = false
  interimResults = false
  onresult: ((event: ResultEvent) => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onend: (() => void) | null = null
  start = jest.fn()
  stop = jest.fn()
  abort = jest.fn()
  constructor() {
    FakeRecognition.last = this
  }
  emit(transcript: string, isFinal: boolean) {
    this.onresult?.({ results: [Object.assign([{ transcript }], { isFinal })] })
  }
}

function spyCallbacks(): AsrCallbacks & Record<string, jest.Mock> {
  return {
    onPartial: jest.fn(),
    onFinal: jest.fn(),
    onFailure: jest.fn(),
    onEnd: jest.fn(),
  } as AsrCallbacks & Record<string, jest.Mock>
}

const scope = window as unknown as { SpeechRecognition?: unknown }

beforeEach(() => {
  FakeRecognition.last = undefined
  scope.SpeechRecognition = FakeRecognition
})

afterEach(() => {
  delete scope.SpeechRecognition
})

describe("browserAsrAdapter", () => {
  it("reports availability from the runtime, not from configuration", () => {
    expect(browserAsrAdapter.available()).toBe(true)
    delete scope.SpeechRecognition
    expect(browserAsrAdapter.available()).toBe(false)
  })

  it("fails cleanly when started in a runtime with no recogniser", async () => {
    delete scope.SpeechRecognition
    const callbacks = spyCallbacks()

    await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    expect(callbacks.onFailure).toHaveBeenCalledWith("unsupported")
    expect(callbacks.onEnd).toHaveBeenCalled()
  })

  it("passes the locale through and starts listening", async () => {
    await browserAsrAdapter.start({ locale: "en-US" }, spyCallbacks())

    expect(FakeRecognition.last!.lang).toBe("en-US")
    expect(FakeRecognition.last!.start).toHaveBeenCalled()
  })

  it("reports an interim result as a partial and a final one as final", async () => {
    const callbacks = spyCallbacks()
    await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    FakeRecognition.last!.emit("无人机一号", false)
    expect(callbacks.onPartial).toHaveBeenCalledWith("无人机一号")
    expect(callbacks.onFinal).not.toHaveBeenCalled()

    FakeRecognition.last!.emit("无人机一号起飞", true)
    expect(callbacks.onFinal).toHaveBeenCalledWith("无人机一号起飞")
  })

  it("promotes the last interim result when the session ends without a final one", async () => {
    // An operator who stops early can leave the last phrase interim. Discarding it would
    // throw away something the recogniser genuinely heard, and nothing is dispatched
    // without confirmation regardless.
    const callbacks = spyCallbacks()
    await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    FakeRecognition.last!.emit("无人机二号降落", false)
    FakeRecognition.last!.onend?.()

    expect(callbacks.onFinal).toHaveBeenCalledWith("无人机二号降落")
    expect(callbacks.onEnd).toHaveBeenCalled()
  })

  it("does not deliver the same transcript twice when a final result already arrived", async () => {
    const callbacks = spyCallbacks()
    await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    FakeRecognition.last!.emit("无人机一号起飞", true)
    FakeRecognition.last!.onend?.()

    expect(callbacks.onFinal).toHaveBeenCalledTimes(1)
  })

  it("ignores an empty transcript rather than reporting silence as a result", async () => {
    const callbacks = spyCallbacks()
    await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    FakeRecognition.last!.emit("   ", true)

    expect(callbacks.onFinal).not.toHaveBeenCalled()
    expect(callbacks.onPartial).not.toHaveBeenCalled()
  })

  it.each([
    ["not-allowed", "permission-denied"],
    ["service-not-allowed", "permission-denied"],
    ["network", "network"],
    ["no-speech", "no-speech"],
    ["audio-capture", "failed"],
    [undefined, "failed"],
  ])("translates the %s error into %s", async (error, expected) => {
    const callbacks = spyCallbacks()
    await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    FakeRecognition.last!.onerror?.({ error: error as string })

    expect(callbacks.onFailure).toHaveBeenCalledWith(expected)
  })

  it("drops a result that arrives after the caller abandoned the session", async () => {
    // Navigating away mid-recognition must not dispatch a command the operator has already
    // walked away from.
    const callbacks = spyCallbacks()
    const session = await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    session.abort()
    FakeRecognition.last!.emit("无人机一号起飞", true)
    FakeRecognition.last!.onerror?.({ error: "network" })
    FakeRecognition.last!.onend?.()

    expect(FakeRecognition.last!.abort).toHaveBeenCalled()
    expect(callbacks.onFinal).not.toHaveBeenCalled()
    expect(callbacks.onFailure).not.toHaveBeenCalled()
  })

  it("stopping lets the recogniser finish rather than discarding it", async () => {
    const callbacks = spyCallbacks()
    const session = await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    session.stop()
    FakeRecognition.last!.emit("无人机一号起飞", true)

    expect(FakeRecognition.last!.stop).toHaveBeenCalled()
    expect(callbacks.onFinal).toHaveBeenCalledWith("无人机一号起飞")
  })

  it("reports a failure when the recogniser refuses to start", async () => {
    const callbacks = spyCallbacks()
    scope.SpeechRecognition = class extends FakeRecognition {
      start = jest.fn(() => {
        throw new Error("already started")
      })
    }

    await browserAsrAdapter.start({ locale: "zh-CN" }, callbacks)

    expect(callbacks.onFailure).toHaveBeenCalledWith("failed")
    expect(callbacks.onEnd).toHaveBeenCalled()
  })
})

describe("unavailableAsrAdapter", () => {
  it("fails cleanly if started, so callers need no null-adapter branch", async () => {
    const { unavailableAsrAdapter } = await import("@/lib/voice/asr")
    const callbacks = spyCallbacks()

    const session = await unavailableAsrAdapter.start({ locale: "zh-CN" }, callbacks)
    session.stop()
    session.abort()

    expect(unavailableAsrAdapter.available()).toBe(false)
    expect(callbacks.onFailure).toHaveBeenCalledWith("unsupported")
    expect(callbacks.onEnd).toHaveBeenCalled()
  })
})
