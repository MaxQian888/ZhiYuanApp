"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { DesktopTitlebar } from "@/components/product/desktop-titlebar"
import { Field } from "@/components/product/primitives"
import { PendingLabel } from "@/components/product/view-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTauriRuntime } from "@/hooks/use-tauri-runtime"
import { api, ApiError } from "@/lib/api/client"
import { resumeSessionRecovery } from "@/lib/api/client"
import { isRemoteApi } from "@/lib/env"
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

export function LoginView() {
  const store = useProductStore()
  const router = useRouter()
  const desktopRuntime = useTauriRuntime()
  const copy = useCopy(store.locale)
  const [username, setUsername] = useState(isRemoteApi ? "" : "admin")
  const [password, setPassword] = useState(isRemoteApi ? "" : "admin123")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  // Set once the password is accepted but a second factor is still owed. Holding it in
  // state rather than storage keeps it where it belongs: this tab, for the next minute.
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const zh = store.locale === "zh-CN"

  const describe = (failure: unknown) => {
    // A lockout is not a wrong password, and telling an operator to try harder when the
    // answer is "wait four minutes" wastes both their time and their remaining attempts.
    if (failure instanceof ApiError && failure.status === 429) return failure.message
    if (failure instanceof ApiError && challenge) return failure.message
    return copy.loginError
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      if (isRemoteApi) {
        const outcome = challenge
          ? await api.verifyMfa(challenge, code)
          : await api.login(username, password)
        if (outcome.kind === "second-factor") {
          setChallenge(outcome.mfaToken)
          setCode("")
          setLoading(false)
          return
        }
        useProductStore.setState({ authenticated: true, staff: outcome.staff })
      } else {
        resumeSessionRecovery()
        if (!store.login(username, password)) throw new Error("invalid")
      }
      // replace, not push: a signed-in operator pressing Back should not land on the
      // login form they just cleared.
      router.replace("/")
    } catch (failure) {
      setError(describe(failure))
      setLoading(false)
      return
    }
    setLoading(false)
  }
  return (
    <div className={desktopRuntime ? "login-window is-desktop" : "login-window"}>
      {desktopRuntime && <DesktopTitlebar />}
      <main className="login-page">
        <section className="login-intro">
          <span className="brand-mark">鸢</span>
          <p>{copy.console}</p>
          <h1>{store.locale === "zh-CN" ? "看清状态，再下指令。" : "Read the state. Then act."}</h1>
          <div className="login-signals">
            <span>
              <i />
              {copy.live}
            </span>
            <span>{isRemoteApi ? "API v1" : "6 UAV"}</span>
            <span>{isRemoteApi ? "SSE" : "3 POD"}</span>
          </div>
        </section>
        <section className="login-form-panel">
          <Button
            className="locale-button"
            onClick={() => store.setLocale(store.locale === "zh-CN" ? "en" : "zh-CN")}
          >
            {store.locale === "zh-CN" ? "EN" : "中"}
          </Button>
          <form onSubmit={submit}>
            <h2>{challenge ? (zh ? "二次验证" : "Verification") : copy.login}</h2>
            <p>
              {challenge
                ? zh
                  ? "请输入验证器应用中的 6 位验证码，或一个恢复码。"
                  : "Enter the six-digit code from your authenticator, or a recovery code."
                : copy.loginIntro}
            </p>
            {challenge ? (
              <Field label={zh ? "验证码" : "Verification code"} error={error}>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  autoFocus
                />
              </Field>
            ) : (
              <>
                <Field label={copy.username}>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                  />
                </Field>
                <Field label={copy.password} error={error}>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </Field>
              </>
            )}
            <Button className="button button-primary button-wide" disabled={loading}>
              <PendingLabel
                pending={loading}
                pendingLabel={
                  challenge ? (zh ? "验证中…" : "Verifying…") : zh ? "登录中…" : "Signing in…"
                }
              >
                {challenge ? (zh ? "验证" : "Verify") : copy.login}
              </PendingLabel>
            </Button>
            {challenge && (
              <Button
                type="button"
                variant="link"
                className="text-button"
                onClick={() => {
                  setChallenge(null)
                  setCode("")
                  setError("")
                }}
              >
                {zh ? "返回登录" : "Back to sign in"}
              </Button>
            )}
            <small>
              {isRemoteApi
                ? store.locale === "zh-CN"
                  ? "请使用已授权的员工账号登录"
                  : "Sign in with an authorized staff account"
                : copy.loginDemo}
            </small>
          </form>
          <footer>© 2026 · ZHIYUAN OPERATIONS · v1.0.0</footer>
        </section>
      </main>
    </div>
  )
}
