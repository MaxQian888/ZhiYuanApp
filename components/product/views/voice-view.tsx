"use client"

import { Check, Mic, Radio } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, PageHeader, Section, StatusPill } from "@/components/product/primitives"
import { executeAction, formatDate } from "@/components/product/view-kit"
import { parseVoiceCommand } from "@/lib/domain"
import { useCopy } from "@/lib/i18n-product"
import { selectAsrAdapter, type AsrFailure, type AsrSession } from "@/lib/voice"
import { useProductStore } from "@/stores/product-store"

export function VoiceView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [recording, setRecording] = useState(false)
  const [text, setText] = useState("")
  const [partial, setPartial] = useState("")
  const [error, setError] = useState("")
  const [parsed, setParsed] = useState<ReturnType<typeof parseVoiceCommand>>(null)
  const adapter = useMemo(() => selectAsrAdapter(), [])
  const session = useRef<AsrSession | null>(null)
  // Read once: whether a recogniser exists cannot change while the view is mounted, and
  // calling it during render on every keystroke would probe the runtime for nothing.
  const [supported] = useState(() => adapter.available())

  // Abandoning the session on unmount is what releases the microphone. Without it, navigating
  // away mid-recording leaves the browser's recording indicator lit and the capture running.
  useEffect(() => () => session.current?.abort(), [])

  const describe = (failure: AsrFailure) => {
    const zh = store.locale === "zh-CN"
    if (failure === "permission-denied")
      return zh ? "麦克风权限被拒绝。" : "Microphone permission denied."
    if (failure === "network")
      return zh
        ? "语音服务连接失败，请使用文本输入。"
        : "Speech service unreachable. Use text input."
    if (failure === "no-speech") return zh ? "没有听到语音。" : "No speech detected."
    return copy.unsupported
  }

  const parse = (value: string) => {
    const result = parseVoiceCommand(value, store.uavs)
    setParsed(result)
    setError(result ? "" : copy.ambiguous)
  }

  const record = async () => {
    if (recording) {
      // Stop, don't abort: the recogniser may still have a final transcript to deliver.
      session.current?.stop()
      return
    }
    if (!supported) {
      setError(copy.unsupported)
      return
    }
    setRecording(true)
    setError("")
    setPartial("")
    // A recogniser is allowed to finish before `start` resolves. Tracking that here keeps us
    // from storing a session that has already ended and aborting it later.
    let ended = false
    const started = await adapter.start(
      { locale: store.locale === "zh-CN" ? "zh-CN" : "en-US" },
      {
        onPartial: setPartial,
        onFinal: (transcript) => {
          setPartial("")
          setText(transcript)
          parse(transcript)
        },
        onFailure: (failure) => setError(describe(failure)),
        onEnd: () => {
          ended = true
          setRecording(false)
          setPartial("")
          session.current = null
        },
      }
    )
    session.current = ended ? null : started
  }

  return (
    <>
      <PageHeader title={copy.voiceTitle} description={copy.voiceDescription} />
      <div className="voice-workbench">
        <section className={recording ? "voice-stage is-recording" : "voice-stage"}>
          <div className="voice-rings">
            <Mic />
          </div>
          <strong>{recording ? copy.stopRecording : copy.startRecording}</strong>
          <Button className="button button-primary" onClick={() => void record()}>
            {recording ? <Radio /> : <Mic />}
            {recording ? copy.stopRecording : copy.startRecording}
          </Button>
          {partial && (
            <p className="voice-partial" aria-live="polite">
              {partial}
            </p>
          )}
          <small>
            {supported
              ? `${adapter.name} · ${store.locale === "zh-CN" ? "语音识别可用" : "recogniser available"}`
              : copy.unsupported}
          </small>
        </section>
        <section className="voice-form">
          <Field label={copy.textFallback} error={error}>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                store.locale === "zh-CN" ? "例如：无人机一号起飞" : "Example: stop UAV-02"
              }
            />
          </Field>
          <Button variant="outline" className="button button-secondary" onClick={() => parse(text)}>
            {copy.parse}
          </Button>
          {parsed && (
            <div className="parsed-command">
              <Check />
              <span>
                <strong>{store.uavs.find((item) => item.id === parsed.uavId)?.code}</strong>
                <code>{parsed.type}</code>
              </span>
              <Button
                className="button button-primary"
                onClick={() =>
                  void executeAction(
                    () => store.sendCommand(parsed.uavId, parsed.type, "VOICE", parsed.transcript),
                    store.locale,
                    copy.commandSent
                  ).then((result) => result.ok && setParsed(null))
                }
              >
                {copy.confirm}
              </Button>
            </div>
          )}
        </section>
      </div>
      <Section title={store.locale === "zh-CN" ? "语音与控制日志" : "Voice and command log"}>
        <div className="timeline">
          {store.commands
            .filter((item) => item.source === "VOICE")
            .map((item) => (
              <div key={item.id}>
                <Mic />
                <span>
                  <strong>{item.transcript}</strong>
                  <small>
                    {item.type} · {formatDate(item.createdAt, store.locale)}
                  </small>
                </span>
                <StatusPill value={item.status} />
              </div>
            ))}
        </div>
      </Section>
    </>
  )
}
