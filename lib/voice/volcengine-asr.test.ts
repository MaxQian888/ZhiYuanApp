import { selectAsrAdapter } from "@/lib/voice"
import { unavailableAsrAdapter, withAsrFallback, type AsrCallbacks } from "@/lib/voice/asr"
import { browserAsrAdapter } from "@/lib/voice/browser-asr"
import { createVolcengineAsrAdapter, pcm16 } from "@/lib/voice/volcengine-asr"

const GATEWAY = "wss://asr.test/api/v1/asr/ws?session=opaque"
const reserve = jest.fn(async () => ({ websocketUrl: GATEWAY }))

class FakeSocket {
  static last: FakeSocket | undefined
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  binaryType = ""
  readyState = 0
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  close = jest.fn(() => {
    this.readyState = 3
  })
  constructor(public url: string) {
    FakeSocket.last = this
  }
  send(payload: unknown) {
    this.sent.push(payload)
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  deliver(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

class FakeProcessor {
  onaudioprocess:
    ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null = null
  connect = jest.fn()
  disconnect = jest.fn()
  emit(samples: Float32Array) {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } })
  }
}

class FakeSource {
  connect = jest.fn()
  disconnect = jest.fn()
}

class FakeAudioContext {
  static last: FakeAudioContext | undefined
  sampleRate = 48_000
  destination = {}
  source = new FakeSource()
  processor = new FakeProcessor()
  close = jest.fn(async () => undefined)
  createMediaStreamSource = jest.fn(() => this.source)
  createScriptProcessor = jest.fn(() => this.processor)
  constructor() {
    FakeAudioContext.last = this
  }
}

const track = { stop: jest.fn() }
const stream = { getTracks: () => [track] }
const scope = globalThis as unknown as Record<string, unknown>

function callbacks(): AsrCallbacks & Record<string, jest.Mock> {
  return {
    onPartial: jest.fn(),
    onFinal: jest.fn(),
    onFailure: jest.fn(),
    onEnd: jest.fn(),
  } as AsrCallbacks & Record<string, jest.Mock>
}

beforeEach(() => {
  track.stop.mockClear()
  reserve.mockClear()
  FakeSocket.last = undefined
  FakeAudioContext.last = undefined
  scope.WebSocket = FakeSocket
  scope.AudioContext = FakeAudioContext
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => stream) },
  })
})

describe("createVolcengineAsrAdapter", () => {
  it("is available only with a session factory and PCM capture runtime", () => {
    expect(createVolcengineAsrAdapter(undefined).available()).toBe(false)
    expect(createVolcengineAsrAdapter(reserve).available()).toBe(true)
  })

  it("reports a declined microphone without reserving a gateway ticket", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn(async () => Promise.reject(new Error("denied"))) },
    })
    const spy = callbacks()

    await createVolcengineAsrAdapter(reserve).start({ locale: "zh-CN" }, spy)

    expect(spy.onFailure).toHaveBeenCalledWith("permission-denied")
    expect(reserve).not.toHaveBeenCalled()
  })

  it("releases the microphone when the authenticated session reservation fails", async () => {
    const spy = callbacks()
    await createVolcengineAsrAdapter(async () => Promise.reject(new Error("offline"))).start(
      { locale: "zh-CN" },
      spy
    )

    expect(track.stop).toHaveBeenCalled()
    expect(spy.onFailure).toHaveBeenCalledWith("network")
    expect(FakeSocket.last).toBeUndefined()
  })

  it("announces 16 kHz PCM before connecting the capture graph", async () => {
    await createVolcengineAsrAdapter(reserve).start({ locale: "zh-CN" }, callbacks())
    FakeSocket.last!.open()

    expect(JSON.parse(FakeSocket.last!.sent[0] as string)).toEqual({
      type: "start",
      locale: "zh-CN",
      mimeType: "audio/pcm;rate=16000",
    })
    expect(FakeAudioContext.last!.source.connect).toHaveBeenCalled()
  })

  it("downsamples each audio callback and sends it without retaining a recording", async () => {
    await createVolcengineAsrAdapter(reserve).start({ locale: "zh-CN" }, callbacks())
    FakeSocket.last!.open()
    FakeAudioContext.last!.processor.emit(new Float32Array([1, 0.5, 0, -0.5, -1, 0]))

    const audio = FakeSocket.last!.sent.at(-1)
    expect(audio).toBeInstanceOf(ArrayBuffer)
    expect((audio as ArrayBuffer).byteLength).toBe(4)
  })

  it("surfaces partial text, settles on final text, and releases capture", async () => {
    const spy = callbacks()
    await createVolcengineAsrAdapter(reserve).start({ locale: "zh-CN" }, spy)
    FakeSocket.last!.open()

    FakeSocket.last!.deliver({ type: "partial", text: "无人机一号" })
    FakeSocket.last!.deliver({ type: "final", text: "无人机一号起飞" })

    expect(spy.onPartial).toHaveBeenCalledWith("无人机一号")
    expect(spy.onFinal).toHaveBeenCalledWith("无人机一号起飞")
    expect(track.stop).toHaveBeenCalled()
    expect(spy.onEnd).toHaveBeenCalledTimes(1)
  })

  it("stops capture while leaving the socket open for the final transcript", async () => {
    const spy = callbacks()
    const session = await createVolcengineAsrAdapter(reserve).start({ locale: "zh-CN" }, spy)
    FakeSocket.last!.open()

    session.stop()

    expect(track.stop).toHaveBeenCalled()
    expect(JSON.parse(FakeSocket.last!.sent.at(-1) as string)).toEqual({ type: "stop" })
    expect(spy.onEnd).not.toHaveBeenCalled()
  })

  it("aborts without accepting a later transcript", async () => {
    const spy = callbacks()
    const session = await createVolcengineAsrAdapter(reserve).start({ locale: "zh-CN" }, spy)
    FakeSocket.last!.open()

    session.abort()
    FakeSocket.last!.deliver({ type: "final", text: "ignored" })

    expect(spy.onFinal).not.toHaveBeenCalled()
    expect(spy.onEnd).toHaveBeenCalledTimes(1)
  })

  it("maps declared and transport failures without exposing provider details", async () => {
    const declared = callbacks()
    await createVolcengineAsrAdapter(reserve).start({ locale: "zh-CN" }, declared)
    FakeSocket.last!.open()
    FakeSocket.last!.deliver({ type: "error", reason: "no-speech" })
    expect(declared.onFailure).toHaveBeenCalledWith("no-speech")

    const transport = callbacks()
    await createVolcengineAsrAdapter(reserve).start({ locale: "zh-CN" }, transport)
    FakeSocket.last!.open()
    FakeSocket.last!.onerror?.()
    expect(transport.onFailure).toHaveBeenCalledWith("network")
  })
})

describe("pcm16", () => {
  it("emits signed little-endian samples at the target rate", () => {
    const pcm = new DataView(pcm16(new Float32Array([-1, 0, 1, 0]), 32_000))
    expect(pcm.getInt16(0, true)).toBe(-32768)
    expect(pcm.getInt16(2, true)).toBe(32767)
  })
})

describe("withAsrFallback", () => {
  it("falls back to browser recognition after a gateway network failure", async () => {
    const spy = callbacks()
    const fallback = {
      name: "BROWSER",
      available: () => true,
      start: jest.fn(async (_options: { locale: string }, next: AsrCallbacks) => {
        next.onFinal("浏览器结果")
        next.onEnd()
        return { stop: jest.fn(), abort: jest.fn() }
      }),
    }
    const primary = {
      name: "VOLCENGINE",
      available: () => true,
      start: async (_options: { locale: string }, next: AsrCallbacks) => {
        next.onFailure("network" as const)
        next.onEnd()
        return { stop: jest.fn(), abort: jest.fn() }
      },
    }

    await withAsrFallback(primary, fallback).start({ locale: "zh-CN" }, spy)
    await Promise.resolve()

    expect(fallback.start).toHaveBeenCalled()
    expect(spy.onFinal).toHaveBeenCalledWith("浏览器结果")
    expect(spy.onFailure).not.toHaveBeenCalled()
    expect(spy.onEnd).toHaveBeenCalledTimes(1)
  })

  it("surfaces a post-stop failure and prefers browser recognition on the next attempt", async () => {
    const spy = callbacks()
    let primaryCallbacks: AsrCallbacks | undefined
    const primaryStop = jest.fn()
    const primary = {
      name: "VOLCENGINE",
      available: () => true,
      start: async (_options: { locale: string }, next: AsrCallbacks) => {
        primaryCallbacks = next
        return { stop: primaryStop, abort: jest.fn() }
      },
    }
    const fallback = {
      name: "BROWSER",
      available: () => true,
      start: jest.fn(async () => ({ stop: jest.fn(), abort: jest.fn() })),
    }
    const adapter = withAsrFallback(primary, fallback)

    const first = await adapter.start({ locale: "zh-CN" }, spy)
    first.stop()
    primaryCallbacks!.onFailure("network")
    primaryCallbacks!.onEnd()

    expect(spy.onFailure).toHaveBeenCalledWith("network")
    expect(fallback.start).not.toHaveBeenCalled()

    await adapter.start({ locale: "zh-CN" }, callbacks())
    expect(fallback.start).toHaveBeenCalledTimes(1)
  })

  it("does not hide permission failures and delegates abort to the active primary session", async () => {
    const spy = callbacks()
    const abort = jest.fn()
    const primary = {
      name: "VOLCENGINE",
      available: () => true,
      start: async (_options: { locale: string }, next: AsrCallbacks) => {
        next.onFailure("permission-denied" as const)
        return { stop: jest.fn(), abort }
      },
    }
    const fallback = {
      name: "BROWSER",
      available: () => true,
      start: jest.fn(async () => ({ stop: jest.fn(), abort: jest.fn() })),
    }

    const session = await withAsrFallback(primary, fallback).start({ locale: "zh-CN" }, spy)
    session.abort()

    expect(spy.onFailure).toHaveBeenCalledWith("permission-denied")
    expect(fallback.start).not.toHaveBeenCalled()
    expect(abort).toHaveBeenCalled()
  })
})

describe("selectAsrAdapter", () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
  })

  it("defaults to the browser recogniser", () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_ASR_PROVIDER: undefined }
    expect(selectAsrAdapter()).toBe(browserAsrAdapter)
  })

  it("opts into the authenticated server gateway", () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_ASR_PROVIDER: "volcengine" }
    expect(selectAsrAdapter().name).toBe("VOLCENGINE+BROWSER")
  })

  it("can be turned off entirely", () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_ASR_PROVIDER: "none" }
    expect(selectAsrAdapter()).toBe(unavailableAsrAdapter)
  })
})
