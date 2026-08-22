import { createVolcengineAsrAdapter } from "@/lib/voice/volcengine-asr"
import { selectAsrAdapter } from "@/lib/voice"
import { browserAsrAdapter } from "@/lib/voice/browser-asr"
import { unavailableAsrAdapter, type AsrCallbacks } from "@/lib/voice/asr"

const GATEWAY = "wss://asr.test/stream"

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

class FakeRecorder {
  static last: FakeRecorder | undefined
  state = "inactive"
  mimeType = "audio/webm;codecs=opus"
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  start = jest.fn(() => {
    this.state = "recording"
  })
  stop = jest.fn(() => {
    this.state = "inactive"
  })
  constructor() {
    FakeRecorder.last = this
  }
}

const track = { stop: jest.fn() }
const stream = { getTracks: () => [track] }

function spyCallbacks(): AsrCallbacks & Record<string, jest.Mock> {
  return {
    onPartial: jest.fn(),
    onFinal: jest.fn(),
    onFailure: jest.fn(),
    onEnd: jest.fn(),
  } as AsrCallbacks & Record<string, jest.Mock>
}

const scope = globalThis as unknown as Record<string, unknown>

beforeEach(() => {
  track.stop.mockClear()
  FakeSocket.last = undefined
  FakeRecorder.last = undefined
  scope.WebSocket = FakeSocket
  scope.MediaRecorder = FakeRecorder
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => stream) },
  })
})

describe("createVolcengineAsrAdapter", () => {
  it("is unavailable without a gateway, because the browser never reaches Volcengine directly", () => {
    expect(createVolcengineAsrAdapter(undefined).available()).toBe(false)
    expect(createVolcengineAsrAdapter(GATEWAY).available()).toBe(true)
  })

  it("fails cleanly when started with no gateway configured", async () => {
    const callbacks = spyCallbacks()
    await createVolcengineAsrAdapter(undefined).start({ locale: "zh-CN" }, callbacks)
    expect(callbacks.onFailure).toHaveBeenCalledWith("unsupported")
    expect(callbacks.onEnd).toHaveBeenCalled()
  })

  it("reports a declined microphone as permission-denied and opens no socket", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: jest.fn(async () => {
          throw new Error("denied")
        }),
      },
    })
    const callbacks = spyCallbacks()

    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, callbacks)

    expect(callbacks.onFailure).toHaveBeenCalledWith("permission-denied")
    expect(FakeSocket.last).toBeUndefined()
  })

  it("announces the session before recording starts", async () => {
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, spyCallbacks())
    FakeSocket.last!.open()

    expect(JSON.parse(FakeSocket.last!.sent[0] as string)).toMatchObject({
      type: "start",
      locale: "zh-CN",
      mimeType: "audio/webm;codecs=opus",
    })
    expect(FakeRecorder.last!.start).toHaveBeenCalledWith(250)
  })

  it("streams each audio chunk straight to the socket without retaining it", async () => {
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, spyCallbacks())
    FakeSocket.last!.open()
    const buffer = new ArrayBuffer(8)

    await FakeRecorder.last!.ondataavailable!({
      data: { size: 8, arrayBuffer: async () => buffer } as Blob,
    })

    expect(FakeSocket.last!.sent).toContain(buffer)
  })

  it("drops an empty chunk rather than sending a zero-length frame", async () => {
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, spyCallbacks())
    FakeSocket.last!.open()
    const before = FakeSocket.last!.sent.length

    await FakeRecorder.last!.ondataavailable!({
      data: { size: 0, arrayBuffer: async () => new ArrayBuffer(0) } as Blob,
    })

    expect(FakeSocket.last!.sent).toHaveLength(before)
  })

  it("surfaces partial transcripts and settles on the final one", async () => {
    const callbacks = spyCallbacks()
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, callbacks)
    FakeSocket.last!.open()

    FakeSocket.last!.deliver({ type: "partial", text: "无人机一号" })
    expect(callbacks.onPartial).toHaveBeenCalledWith("无人机一号")

    FakeSocket.last!.deliver({ type: "final", text: "无人机一号起飞" })
    expect(callbacks.onFinal).toHaveBeenCalledWith("无人机一号起飞")
  })

  it("releases the microphone as soon as the session settles", async () => {
    // A leaked track keeps the browser's recording indicator lit after the console believes
    // capture has stopped — the one failure an operator cannot debug.
    const callbacks = spyCallbacks()
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, callbacks)
    FakeSocket.last!.open()

    FakeSocket.last!.deliver({ type: "final", text: "无人机一号起飞" })

    expect(track.stop).toHaveBeenCalled()
    expect(FakeRecorder.last!.stop).toHaveBeenCalled()
    expect(FakeSocket.last!.close).toHaveBeenCalled()
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
  })

  it("releases the microphone when the session is aborted mid-capture", async () => {
    const callbacks = spyCallbacks()
    const session = await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, callbacks)
    FakeSocket.last!.open()

    session.abort()

    expect(track.stop).toHaveBeenCalled()
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
  })

  it("reports a gateway error and a socket failure as distinct outcomes", async () => {
    const callbacks = spyCallbacks()
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, callbacks)
    FakeSocket.last!.open()

    FakeSocket.last!.deliver({ type: "error", reason: "no-speech" })
    expect(callbacks.onFailure).toHaveBeenCalledWith("no-speech")

    const second = spyCallbacks()
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, second)
    FakeSocket.last!.open()
    FakeSocket.last!.onerror?.()
    expect(second.onFailure).toHaveBeenCalledWith("network")
  })

  it("maps an unrecognised gateway reason onto the generic failure", async () => {
    const callbacks = spyCallbacks()
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, callbacks)
    FakeSocket.last!.open()

    FakeSocket.last!.deliver({ type: "error", reason: "quota-exceeded" })

    expect(callbacks.onFailure).toHaveBeenCalledWith("failed")
  })

  it("ignores a frame it cannot read instead of tearing the session down", async () => {
    const callbacks = spyCallbacks()
    await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, callbacks)
    FakeSocket.last!.open()

    FakeSocket.last!.onmessage?.({ data: "{not json" })
    FakeSocket.last!.onmessage?.({ data: new ArrayBuffer(4) })

    expect(callbacks.onFailure).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
  })

  it("asks the gateway to finish when stopped, keeping the socket open for the final result", async () => {
    const callbacks = spyCallbacks()
    const session = await createVolcengineAsrAdapter(GATEWAY).start({ locale: "zh-CN" }, callbacks)
    FakeSocket.last!.open()

    session.stop()

    expect(JSON.parse(FakeSocket.last!.sent.at(-1) as string)).toEqual({ type: "stop" })
    expect(callbacks.onEnd).not.toHaveBeenCalled()

    FakeSocket.last!.deliver({ type: "final", text: "无人机一号起飞" })
    expect(callbacks.onFinal).toHaveBeenCalledWith("无人机一号起飞")
  })
})

describe("selectAsrAdapter", () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
  })

  it("defaults to the browser recogniser, which is what the console has always used", () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_ASR_PROVIDER: undefined }
    expect(selectAsrAdapter()).toBe(browserAsrAdapter)
  })

  it("opts into Volcengine when configured", () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ASR_PROVIDER: "volcengine",
      NEXT_PUBLIC_ASR_GATEWAY_URL: GATEWAY,
    }
    expect(selectAsrAdapter().name).toBe("VOLCENGINE")
  })

  it("can be turned off entirely, leaving the typed fallback", () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_ASR_PROVIDER: "none" }
    expect(selectAsrAdapter()).toBe(unavailableAsrAdapter)
  })
})
