import type { AsrAdapter, AsrCallbacks, AsrFailure, AsrSession } from "@/lib/voice/asr"

/**
 * Volcengine (火山引擎) streaming speech recognition.
 *
 * The browser does not talk to Volcengine directly. It opens a websocket to our own gateway,
 * which holds the Volcengine app id and token and signs the upstream connection. Those are
 * server-side secrets and this app is a static export — a `NEXT_PUBLIC_` variable holding
 * them would be sitting in the bundle for anyone to read.
 *
 * The gateway protocol is deliberately small, because both ends of it are ours:
 *
 * ```
 * client → {"type":"start","locale":"zh-CN","mimeType":"audio/webm;codecs=opus"}
 * client → <binary audio frame>            repeated while capturing
 * client → {"type":"stop"}
 * server → {"type":"partial","text":"无人机一号"}
 * server → {"type":"final","text":"无人机一号起飞"}
 * server → {"type":"error","reason":"network"}
 * ```
 *
 * **Audio is streamed, never accumulated.** Each chunk the recorder produces is written to
 * the socket and then dropped; no array of blobs is kept, nothing is written to storage, and
 * the microphone tracks are stopped the moment the session ends — which is also what turns
 * off the browser's recording indicator, so the operator can see that capture really stopped.
 */

const CHUNK_INTERVAL_MS = 250

interface GatewayMessage {
  type?: string
  text?: string
  reason?: string
}

function classify(reason: string | undefined): AsrFailure {
  if (reason === "permission-denied" || reason === "network" || reason === "no-speech") {
    return reason
  }
  return "failed"
}

export function createVolcengineAsrAdapter(gatewayUrl: string | undefined): AsrAdapter {
  return {
    name: "VOLCENGINE",

    available: () =>
      Boolean(gatewayUrl) &&
      typeof window !== "undefined" &&
      typeof window.MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),

    async start({ locale }, callbacks: AsrCallbacks): Promise<AsrSession> {
      if (!gatewayUrl) {
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

      let closed = false
      let abandoned = false
      const socket = new WebSocket(gatewayUrl)
      socket.binaryType = "arraybuffer"
      const recorder = new MediaRecorder(stream)

      /**
       * Every exit path runs through here. Releasing the microphone matters more than
       * anything else in this function: a leaked track keeps the operator's recording
       * indicator lit and the microphone live after the console thinks it stopped.
       */
      const shutdown = () => {
        if (closed) return
        closed = true
        try {
          if (recorder.state !== "inactive") recorder.stop()
        } catch {
          // Already stopped; nothing to unwind.
        }
        stream.getTracks().forEach((track) => track.stop())
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close()
        }
        callbacks.onEnd()
      }

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "start", locale, mimeType: recorder.mimeType }))
        recorder.start(CHUNK_INTERVAL_MS)
      }

      recorder.ondataavailable = async (event) => {
        // Sent and forgotten. The chunk is not appended to anything.
        if (!event.data.size || socket.readyState !== WebSocket.OPEN) return
        socket.send(await event.data.arrayBuffer())
      }

      socket.onmessage = (event) => {
        if (abandoned || typeof event.data !== "string") return
        let message: GatewayMessage
        try {
          message = JSON.parse(event.data) as GatewayMessage
        } catch {
          return // A frame we cannot read is not worth tearing the session down for.
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
        if (!abandoned) callbacks.onFailure("network")
        shutdown()
      }
      socket.onclose = () => shutdown()

      return {
        stop: () => {
          if (recorder.state !== "inactive") recorder.stop()
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }))
          // The socket stays open briefly so the final transcript can still arrive.
        },
        abort: () => {
          abandoned = true
          shutdown()
        },
      }
    },
  }
}

function inert(): AsrSession {
  return { stop: () => undefined, abort: () => undefined }
}
