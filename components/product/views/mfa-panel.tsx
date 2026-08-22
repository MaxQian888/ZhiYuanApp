"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, KeyRound, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, Section } from "@/components/product/primitives"
import { executeAction, PendingLabel } from "@/components/product/view-kit"
import { api } from "@/lib/api/client"
import { isRemoteApi } from "@/lib/env"
import { useProductStore } from "@/stores/product-store"

type Stage = "idle" | "enrolling" | "confirming" | "regenerating" | "disabling"

/** Groups a Base32 secret so it can be typed by hand without losing your place. */
function grouped(secret: string) {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ")
}

/**
 * Second-factor enrolment and management.
 *
 * <p>Enrolment is shown as the two steps it actually is: a secret is generated, and only a
 * working code turns it on. Presenting it as one action would hide the fact that an operator
 * can walk away between them without locking themselves out.
 */
export function MfaPanel() {
  const store = useProductStore()
  const queryClient = useQueryClient()
  const zh = store.locale === "zh-CN"
  const [stage, setStage] = useState<Stage>("idle")
  const [secret, setSecret] = useState<string | null>(null)
  const [uri, setUri] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  // Shown exactly once. They exist only in this component's state, and closing the dialog
  // is the last chance to write them down — which the dialog says out loud.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  const status = useQuery({
    queryKey: ["mfa-status"],
    queryFn: api.mfaStatus,
    enabled: isRemoteApi,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mfa-status"] })

  const begin = useMutation({
    mutationFn: api.beginMfaEnrolment,
    onSuccess: (enrolment) => {
      setSecret(enrolment.secret)
      setUri(enrolment.provisioningUri)
      setStage("confirming")
      setError("")
    },
  })

  const close = () => {
    setStage("idle")
    setSecret(null)
    setUri(null)
    setCode("")
    setError("")
  }

  const submit = async (action: () => Promise<unknown>, onDone: () => void) => {
    setError("")
    try {
      await action()
      onDone()
      void refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  if (!isRemoteApi) {
    return (
      <Section title={zh ? "二次验证" : "Second factor"}>
        <p className="settings-note">
          {zh
            ? "模拟器模式没有后端，二次验证需要连接真实平台。"
            : "Simulator mode has no backend; the second factor needs a real platform."}
        </p>
      </Section>
    )
  }

  const enabled = status.data?.enabled ?? false
  const remaining = status.data?.remainingRecoveryCodes ?? 0

  return (
    <Section title={zh ? "二次验证" : "Second factor"}>
      <div className="settings-rows">
        <Button
          onClick={() => (enabled ? setStage("regenerating") : begin.mutate())}
          disabled={begin.isPending || status.isPending}
        >
          <ShieldCheck />
          <span>
            <strong>
              {enabled
                ? zh
                  ? "二次验证已启用"
                  : "Second factor is on"
                : zh
                  ? "启用二次验证"
                  : "Turn on the second factor"}
            </strong>
            <small>
              {enabled
                ? zh
                  ? `剩余 ${remaining} 个恢复码 · 点击重新生成`
                  : `${remaining} recovery codes left · tap to reissue`
                : zh
                  ? "登录时除密码外还需要验证器应用中的验证码"
                  : "Sign-in will also ask for a code from your authenticator"}
            </small>
          </span>
        </Button>
        {enabled && (
          <Button onClick={() => setStage("disabling")}>
            <KeyRound />
            <span>
              <strong>{zh ? "关闭二次验证" : "Turn the second factor off"}</strong>
              <small>
                {zh ? "需要输入一个当前验证码" : "Requires a current verification code"}
              </small>
            </span>
          </Button>
        )}
      </div>

      {/* Step two of enrolment: the secret exists but guards nothing until this succeeds. */}
      <Dialog open={stage === "confirming"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{zh ? "扫描或输入密钥" : "Scan or type the key"}</DialogTitle>
            <DialogDescription>
              {zh
                ? "在验证器应用中添加此账户，然后输入它显示的 6 位验证码。"
                : "Add this account to your authenticator, then enter the six-digit code it shows."}
            </DialogDescription>
          </DialogHeader>
          <div className="mfa-secret">
            <code>{secret ? grouped(secret) : ""}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(secret ?? "")}
            >
              <Copy />
              {zh ? "复制" : "Copy"}
            </Button>
          </div>
          {uri && (
            <a className="mfa-uri" href={uri}>
              {zh ? "在验证器应用中打开" : "Open in an authenticator app"}
            </a>
          )}
          <Field label={zh ? "验证码" : "Verification code"} error={error}>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {zh ? "取消" : "Cancel"}
            </Button>
            <Button
              className="button button-primary"
              onClick={() =>
                void submit(
                  async () => setRecoveryCodes((await api.confirmMfaEnrolment(code)).recoveryCodes),
                  close
                )
              }
            >
              {zh ? "确认启用" : "Turn it on"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stage === "regenerating"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{zh ? "重新生成恢复码" : "Reissue recovery codes"}</DialogTitle>
            <DialogDescription>
              {zh
                ? "现有的恢复码会全部作废。需要输入一个当前验证码。"
                : "Every existing recovery code stops working. Requires a current code."}
            </DialogDescription>
          </DialogHeader>
          <Field label={zh ? "验证码" : "Verification code"} error={error}>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {zh ? "取消" : "Cancel"}
            </Button>
            <Button
              className="button button-primary"
              onClick={() =>
                void submit(
                  async () =>
                    setRecoveryCodes((await api.regenerateRecoveryCodes(code)).recoveryCodes),
                  close
                )
              }
            >
              {zh ? "重新生成" : "Reissue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stage === "disabling"} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{zh ? "关闭二次验证" : "Turn the second factor off"}</DialogTitle>
            <DialogDescription>
              {zh
                ? "此后只需密码即可登录该账户。"
                : "After this, a password alone signs in to this account."}
            </DialogDescription>
          </DialogHeader>
          <Field label={zh ? "验证码" : "Verification code"} error={error}>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {zh ? "取消" : "Cancel"}
            </Button>
            <Button
              className="button button-danger"
              onClick={() =>
                void submit(
                  () =>
                    executeAction(
                      () => api.disableMfa(code),
                      store.locale,
                      zh ? "二次验证已关闭" : "Second factor turned off"
                    ).then((result) => {
                      if (!result.ok) throw new Error(zh ? "验证码无效" : "Invalid code")
                    }),
                  close
                )
              }
            >
              <PendingLabel pending={false} pendingLabel="">
                {zh ? "关闭" : "Turn off"}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The one and only time these exist in readable form. */}
      <Dialog
        open={recoveryCodes !== null}
        onOpenChange={(open) => !open && setRecoveryCodes(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{zh ? "恢复码" : "Recovery codes"}</DialogTitle>
            <DialogDescription>
              {zh
                ? "请立即保存。关闭此窗口后将无法再次查看，每个恢复码只能使用一次。"
                : "Save these now. They cannot be shown again, and each one works once."}
            </DialogDescription>
          </DialogHeader>
          <ul className="mfa-recovery-codes">
            {(recoveryCodes ?? []).map((recoveryCode) => (
              <li key={recoveryCode}>
                <code>{recoveryCode}</code>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void navigator.clipboard?.writeText((recoveryCodes ?? []).join("\n"))}
            >
              <Copy />
              {zh ? "全部复制" : "Copy all"}
            </Button>
            <Button className="button button-primary" onClick={() => setRecoveryCodes(null)}>
              {zh ? "我已保存" : "I have saved them"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
