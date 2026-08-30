import type { AsrAdapter, AsrCallbacks, AsrFailure, AsrSession } from "@/lib/voice/asr"

export interface AsrGatewaySession {
  websocketUrl: string
}

export type AsrSessionFactory = () => Promise<AsrGatewaySession>

interface GatewayMessage {
  type?: string
  text?: string
  reason?: string
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

function classify(reason: string | undefined): AsrFailure {
  if (reason === "permission-denied" || reason === "network" || reason === "no-speech") {
    return reason
  }
  return "failed"
}

function audioContextConstructor() {
  if (typeof window === "undefined") return undefined
  return window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
}

/** Downsamples browser audio and encodes signed 16-bit little-endian PCM. */
export function pcm16(input: Float32Array, sourceRate: number, targetRate = 16_000) {
  const ratio = sourceRate / targetRate
  const length = Math.max(1, Math.floor(input.length / ratio))
  const output = new ArrayBuffer(length * 2)
  const view = new DataView(output)
  for (let index = 0; index < length; index++) {
    const sample = Math.max(
      -1,
      Math.min(1, input[Math.min(input.length - 1, Math.floor(index * ratio))])
    )
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return output
}

export function createVolcengineAsrAdapter(
  createSession: AsrSessionFactory | undefined
): AsrAdapter {
  return {
    name: "VOLCENGINE",

    available: () =>
      Boolean(createSession) &&
      Boolean(audioContextConstructor()) &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),

    async start({ locale }, callbacks: AsrCallbacks): Promise<AsrSession> {
      const AudioContextType = audioContextConstructor()
      if (!createSession || !AudioContextType) {
        callbacks.onFailure("unsupported")
        callbacks.onEnd()
        return inert()
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        callbacks.onFailure("permission-denied")
        callbacks.onEnd()
        return inert()
      }

      let reservation: AsrGatewaySession
      try {
        reservation = await createSession()
      } catch {
        stream.getTracks().forEach((track) => track.stop())
        callbacks.onFailure("network")
        callbacks.onEnd()
        return inert()
      }

      const context = new AudioContextType()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const socket = new WebSocket(reservation.websocketUrl)
      socket.binaryType = "arraybuffer"
      let closed = false
      let captureStopped = false

      const stopCapture = () => {
        if (captureStopped) return
        captureStopped = true
        processor.disconnect()
        source.disconnect()
        stream.getTracks().forEach((track) => track.stop())
        void context.close()
      }

      const shutdown = () => {
        if (closed) return
        closed = true
        stopCapture()
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close()
        }
        callbacks.onEnd()
      }

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "start",
            locale: locale === "zh-CN" ? "zh-CN" : "en",
            mimeType: "audio/pcm;rate=16000",
          })
        )
        source.connect(processor)
        processor.connect(context.destination)
      }

      processor.onaudioprocess = (event) => {
        if (captureStopped || socket.readyState !== WebSocket.OPEN) return
        socket.send(pcm16(event.inputBuffer.getChannelData(0), context.sampleRate))
      }

      socket.onmessage = (event) => {
        if (closed || typeof event.data !== "string") return
        let message: GatewayMessage
        try {
          message = JSON.parse(event.data) as GatewayMessage
        } catch {
          return
        }
        if (message.type === "partial" && message.text) callbacks.onPartial?.(message.text)
        else if (message.type === "final" && message.text) {
          callbacks.onFinal(message.text)
          shutdown()
        } else if (message.type === "error") {
          callbacks.onFailure(classify(message.reason))
          shutdown()
        }
      }

      socket.onerror = () => {
        if (!closed) callbacks.onFailure("network")
        shutdown()
      }
      socket.onclose = () => shutdown()

      return {
        stop: () => {
          stopCapture()
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }))
        },
        abort: () => {
          shutdown()
        },
      }
    },
  }
}

function inert(): AsrSession {
  return { stop: () => undefined, abort: () => undefined }
}
