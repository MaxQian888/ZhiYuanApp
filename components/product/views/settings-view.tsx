"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  ChevronRight,
  Database,
  LocateFixed,
  Plane,
  Plus,
  Radio,
  RotateCcw,
  Save,
  ShieldCheck,
  UserCog,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import {
  ConfirmAction,
  Field,
  PageHeader,
  Section,
  StatusPill,
} from "@/components/product/primitives"
import { MfaPanel } from "@/components/product/views/mfa-panel"
import {
  executeAction,
  formatDate,
  PendingLabel,
  QueryLoading,
} from "@/components/product/view-kit"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { useTauriRuntime } from "@/hooks/use-tauri-runtime"
import { api } from "@/lib/api/client"
import { suppressSessionRecovery } from "@/lib/api/client"
import { type StaffAccount } from "@/lib/domain"
import { isRemoteApi } from "@/lib/env"
import { useCopy } from "@/lib/i18n-product"
import {
  type AppWindowPosition,
  checkForAppUpdate,
  getPlatformInfo,
  installAppUpdate,
  moveAppWindow,
  type PlatformInfo,
  restoreAppWindowState,
  saveAppWindowState,
} from "@/lib/tauri"
import { useProductStore } from "@/stores/product-store"

const staffAccountFormSchema = z
  .object({
    id: z.number().int().positive().optional(),
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9._-]+$/),
    displayName: z.string().trim().min(1).max(80),
    phone: z.string().regex(/^1[3-9]\d{9}$/),
    password: z
      .string()
      .trim()
      .refine((password) => !password || (password.length >= 8 && password.length <= 72)),
    role: z.enum(["admin", "manager"]),
    enabled: z.boolean(),
  })
  .superRefine((account, context) => {
    if (!account.id && !account.password) {
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: "An initial password is required",
      })
    }
  })

type StaffAccountForm = z.infer<typeof staffAccountFormSchema>

const profileFormSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^1[3-9]\d{9}$/),
})

type ProfileForm = z.infer<typeof profileFormSchema>

export function SettingsView() {
  const store = useProductStore()
  const router = useRouter()
  const queryClient = useQueryClient()
  const copy = useCopy(store.locale)
  const [updateMessage, setUpdateMessage] = useState("")
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null)
  const desktopRuntime = useTauriRuntime()
  const [windowBusy, setWindowBusy] = useState(false)
  const [windowMessage, setWindowMessage] = useState("")
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof api.sessions>>>([])
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>(() =>
    store.staff ? [{ ...store.staff, enabled: true }] : []
  )
  const [staffLoading, setStaffLoading] = useState(isRemoteApi && store.staff?.role === "admin")
  const [staffSaving, setStaffSaving] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffAccountForm | null>(null)
  const staffForm = useForm<StaffAccountForm>({
    resolver: zodResolver(staffAccountFormSchema),
    defaultValues: {
      username: "",
      displayName: "",
      phone: "",
      password: "",
      role: "manager",
      enabled: true,
    },
  })
  const staffRole = useWatch({ control: staffForm.control, name: "role" })
  const staffEnabled = useWatch({ control: staffForm.control, name: "enabled" })
  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      displayName: store.staff?.displayName ?? "",
      phone: store.staff?.phone ?? "",
    },
  })
  const bindingHistory = store.bindings.filter(
    (item) => item.staffId === store.staff?.id && item.unboundAt
  )
  const bindings = store.bindings.filter(
    (item) => item.staffId === store.staff?.id && !item.unboundAt
  )
  const finishLogout = async () => {
    try {
      suppressSessionRecovery()
      await api.forgetAuthentication()
    } catch {
      toast.warning(
        store.locale === "zh-CN"
          ? "本地安全凭据未能完全移除，请关闭应用后重新打开。"
          : "Local security credentials could not be fully removed. Close and reopen the app."
      )
    } finally {
      queryClient.clear()
      store.logout()
      router.replace("/login")
    }
  }
  useEffect(() => {
    void getPlatformInfo()
      .then(setPlatformInfo)
      .catch(() => setPlatformInfo(null))
  }, [])
  useEffect(() => {
    if (store.staff?.role !== "admin" || !isRemoteApi) return
    let active = true
    void api
      .staffAccounts()
      .then((accounts) => {
        if (active) setStaffAccounts(accounts)
      })
      .catch((error: unknown) => {
        if (active) {
          const detail = error instanceof Error ? error.message : String(error)
          toast.error(
            store.locale === "zh-CN"
              ? `员工账号加载失败：${detail}`
              : `Unable to load staff accounts: ${detail}`
          )
        }
      })
      .finally(() => {
        if (active) setStaffLoading(false)
      })
    return () => {
      active = false
    }
  }, [store.locale, store.staff?.role])
  const openStaffEditor = (account?: StaffAccount) => {
    const values: StaffAccountForm = account
      ? { ...account, password: "" }
      : {
          username: "",
          displayName: "",
          phone: "",
          password: "",
          role: "manager",
          enabled: true,
        }
    staffForm.reset(values)
    setEditingStaff(values)
  }
  const saveStaffAccount = async (account: StaffAccountForm) => {
    const username = account.username.trim()
    const displayName = account.displayName.trim()
    const phone = account.phone.trim()
    const password = account.password.trim()
    setStaffSaving(true)
    const { role, enabled } = account
    const result = await executeAction(
      async () => {
        if (isRemoteApi) {
          return account.id
            ? api.updateStaffAccount(account.id, {
                username,
                ...(password ? { password } : {}),
                displayName,
                role,
                phone,
                enabled,
              })
            : api.createStaffAccount({ username, password, displayName, role, phone })
        }
        return {
          id: account.id ?? Math.max(0, ...staffAccounts.map((item) => item.id)) + 1,
          username,
          displayName,
          role,
          phone,
          enabled,
        } satisfies StaffAccount
      },
      store.locale,
      copy.save
    )
    setStaffSaving(false)
    if (!result.ok) return
    if (result.value.id === store.staff?.id) {
      if (password) {
        await finishLogout()
        return
      }
      useProductStore.setState({
        staff: {
          id: result.value.id,
          username: result.value.username,
          displayName: result.value.displayName,
          role: result.value.role,
          phone: result.value.phone,
        },
      })
      profileForm.reset({ displayName: result.value.displayName, phone: result.value.phone })
    }
    setStaffAccounts((accounts) =>
      account.id
        ? accounts.map((account) => (account.id === result.value.id ? result.value : account))
        : [...accounts, result.value]
    )
    setEditingStaff(null)
  }
  const disableStaffAccount = async (account: StaffAccount) => {
    const result = await executeAction(
      () =>
        isRemoteApi
          ? api.disableStaffAccount(account.id)
          : Promise.resolve({ ...account, enabled: false }),
      store.locale,
      store.locale === "zh-CN" ? "账号已停用" : "Account disabled"
    )
    if (!result.ok) return
    setStaffAccounts((accounts) =>
      accounts.map((item) => (item.id === result.value.id ? result.value : item))
    )
  }
  const checkUpdate = async () => {
    setCheckingUpdate(true)
    setAvailableUpdate(null)
    if (!desktopRuntime) {
      const result = await executeAction(api.version, store.locale)
      if (result.ok)
        setUpdateMessage(
          result.value.configured
            ? `${store.locale === "zh-CN" ? "当前版本" : "Current version"} ${result.value.currentVersion}`
            : copy.updateUnavailable
        )
      setCheckingUpdate(false)
      return
    }
    const result = await checkForAppUpdate()
    if (result.available && result.version) {
      setAvailableUpdate(result.version)
      setUpdateMessage(
        store.locale === "zh-CN"
          ? `发现新版本 ${result.version}`
          : `Version ${result.version} is available`
      )
    } else if (!result.configured) {
      setUpdateMessage(copy.updateUnavailable)
    } else {
      setUpdateMessage(
        store.locale === "zh-CN" && result.message.includes("latest")
          ? "当前已是最新配置版本"
          : result.message
      )
    }
    setCheckingUpdate(false)
  }
  const installUpdate = async () => {
    setInstallingUpdate(true)
    setUpdateProgress(0)
    const result = await installAppUpdate((downloaded, total) => {
      if (total) setUpdateProgress(Math.min(100, Math.round((downloaded / total) * 100)))
    })
    setInstallingUpdate(false)
    setUpdateProgress(result.installed ? 100 : 0)
    setUpdateMessage(
      result.installed
        ? store.locale === "zh-CN"
          ? `版本 ${result.version} 已安装，请重启应用完成更新。`
          : result.message
        : store.locale === "zh-CN"
          ? `更新安装失败：${result.message}`
          : result.message
    )
    if (result.installed) setAvailableUpdate(null)
  }
  const runWindowAction = async (action: () => Promise<boolean>, successMessage: string) => {
    setWindowBusy(true)
    try {
      const supported = await action()
      if (!supported) throw new Error("Desktop runtime is unavailable")
      setWindowMessage(successMessage)
      toast.success(successMessage)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const message =
        store.locale === "zh-CN" ? `窗口操作失败：${detail}` : `Window operation failed: ${detail}`
      setWindowMessage(message)
      toast.error(message)
    } finally {
      setWindowBusy(false)
    }
  }
  const windowPositions: Array<{
    value: AppWindowPosition
    zh: string
    en: string
    icon: typeof ArrowUpLeft
  }> = [
    { value: "top-left", zh: "左上", en: "Top left", icon: ArrowUpLeft },
    { value: "top-center", zh: "上方", en: "Top", icon: ArrowUp },
    { value: "top-right", zh: "右上", en: "Top right", icon: ArrowUpRight },
    { value: "left-center", zh: "左侧", en: "Left", icon: ArrowLeft },
    { value: "center", zh: "居中", en: "Center", icon: LocateFixed },
    { value: "right-center", zh: "右侧", en: "Right", icon: ArrowRight },
    { value: "bottom-left", zh: "左下", en: "Bottom left", icon: ArrowDownLeft },
    { value: "bottom-center", zh: "下方", en: "Bottom", icon: ArrowDown },
    { value: "bottom-right", zh: "右下", en: "Bottom right", icon: ArrowDownRight },
  ]
  return (
    <>
      <PageHeader
        title={copy.account}
        description={
          store.locale === "zh-CN"
            ? "管理员工资料、安全会话、设备绑定与客户端状态。"
            : "Manage staff profile, security sessions, device bindings, and client status."
        }
      />
      <div className="settings-layout">
        <nav>
          <a href="#profile">{copy.profile}</a>
          {store.staff?.role === "admin" && (
            <a href="#staff">{store.locale === "zh-CN" ? "员工账号" : "Staff accounts"}</a>
          )}
          <a href="#security">{copy.security}</a>
          <a href="#bindings">{copy.bindings}</a>
          {desktopRuntime && (
            <a href="#desktop">{store.locale === "zh-CN" ? "桌面窗口" : "Desktop window"}</a>
          )}
          <a href="#about">{copy.about}</a>
        </nav>
        <div>
          <Section title={copy.profile}>
            <div id="profile" className="form-inline">
              <Field
                label={store.locale === "zh-CN" ? "显示名称" : "Display name"}
                error={
                  profileForm.formState.errors.displayName
                    ? store.locale === "zh-CN"
                      ? "请输入不超过 80 个字符的显示名称"
                      : "Enter a display name up to 80 characters"
                    : undefined
                }
              >
                <Input
                  aria-invalid={Boolean(profileForm.formState.errors.displayName)}
                  {...profileForm.register("displayName")}
                />
              </Field>
              <Field
                label={store.locale === "zh-CN" ? "手机号" : "Phone"}
                error={
                  profileForm.formState.errors.phone
                    ? store.locale === "zh-CN"
                      ? "请输入有效的中国大陆手机号"
                      : "Enter a valid mainland China mobile number"
                    : undefined
                }
              >
                <Input
                  inputMode="tel"
                  aria-invalid={Boolean(profileForm.formState.errors.phone)}
                  {...profileForm.register("phone")}
                />
              </Field>
              <Field label={store.locale === "zh-CN" ? "角色" : "Role"}>
                <Input disabled value={store.staff?.role ?? "—"} />
              </Field>
              <Button
                className="button button-primary"
                onClick={profileForm.handleSubmit(
                  (profile) =>
                    void executeAction(
                      () => store.updateStaff(profile),
                      store.locale,
                      copy.save
                    ).then((result) => {
                      if (!result.ok) return
                      const current = useProductStore.getState().staff
                      if (!current) return
                      setStaffAccounts((accounts) =>
                        accounts.map((account) =>
                          account.id === current.id ? { ...account, ...current } : account
                        )
                      )
                    })
                )}
              >
                {copy.save}
              </Button>
            </div>
          </Section>
          {store.staff?.role === "admin" && (
            <Section
              title={store.locale === "zh-CN" ? "员工账号" : "Staff accounts"}
              action={
                <Button className="button button-primary" onClick={() => openStaffEditor()}>
                  <Plus />
                  {store.locale === "zh-CN" ? "新增员工" : "Add staff"}
                </Button>
              }
            >
              <div id="staff">
                {staffLoading ? (
                  <QueryLoading locale={store.locale} />
                ) : (
                  <div className="data-table compact">
                    <div className="table-head">
                      <span>{store.locale === "zh-CN" ? "员工" : "Staff"}</span>
                      <span>{store.locale === "zh-CN" ? "手机号" : "Phone"}</span>
                      <span>{store.locale === "zh-CN" ? "角色" : "Role"}</span>
                      <span>{copy.status}</span>
                      <span>{copy.action}</span>
                    </div>
                    {staffAccounts.map((account) => (
                      <div className="table-row" key={account.id}>
                        <span data-label={store.locale === "zh-CN" ? "员工" : "Staff"}>
                          <strong>{account.displayName}</strong>
                          <small>@{account.username}</small>
                        </span>
                        <span data-label={store.locale === "zh-CN" ? "手机号" : "Phone"}>
                          {account.phone}
                        </span>
                        <span data-label={store.locale === "zh-CN" ? "角色" : "Role"}>
                          {account.role}
                        </span>
                        <span data-label={copy.status}>
                          <StatusPill value={account.enabled ? "ENABLED" : "DISABLED"} />
                        </span>
                        <span data-label={copy.action}>
                          <Button
                            variant="link"
                            size="sm"
                            className="text-button"
                            onClick={() => openStaffEditor(account)}
                          >
                            {copy.edit}
                          </Button>
                          {account.enabled && account.id !== store.staff?.id && (
                            <ConfirmAction
                              trigger={
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="text-button danger-text"
                                >
                                  {store.locale === "zh-CN" ? "停用" : "Disable"}
                                </Button>
                              }
                              title={
                                store.locale === "zh-CN"
                                  ? "确认停用员工账号"
                                  : "Disable staff account?"
                              }
                              description={
                                store.locale === "zh-CN"
                                  ? `“${account.displayName}”将立即失去访问权限，所有刷新会话也会撤销。`
                                  : `${account.displayName} loses access immediately and all refresh sessions are revoked.`
                              }
                              cancelLabel={copy.cancel}
                              confirmLabel={store.locale === "zh-CN" ? "停用" : "Disable"}
                              onConfirm={() => disableStaffAccount(account)}
                            />
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}
          <Section title={copy.security}>
            <div id="security" className="settings-rows">
              <Button onClick={() => setPasswordOpen(true)}>
                <ShieldCheck />
                <span>
                  <strong>{copy.changePassword}</strong>
                  <small>
                    {store.locale === "zh-CN"
                      ? "修改密码将撤销全部活动会话"
                      : "Changing it revokes every active session"}
                  </small>
                </span>
                <ChevronRight />
              </Button>
              <Button
                onClick={() =>
                  void executeAction(api.sessions, store.locale).then((result) => {
                    if (result.ok) {
                      setSessions(result.value)
                      setSessionsOpen(true)
                    }
                  })
                }
              >
                <Radio />
                <span>
                  <strong>{copy.sessions}</strong>
                  <small>
                    {store.locale === "zh-CN"
                      ? "查看并撤销已登录的设备"
                      : "Review and revoke signed-in devices"}
                  </small>
                </span>
                <ChevronRight />
              </Button>
            </div>
          </Section>
          <MfaPanel />
          <Section title={copy.bindings}>
            <div id="bindings" className="binding-list">
              {bindings.map((binding) => (
                <div key={binding.id}>
                  <Plane />
                  <span>
                    <strong>{store.uavs.find((item) => item.id === binding.uavId)?.code}</strong>
                    <small>{formatDate(binding.boundAt, store.locale)}</small>
                  </span>
                  <Button
                    className="text-button"
                    onClick={() =>
                      void executeAction(() => store.unbindDevice(binding.id), store.locale)
                    }
                  >
                    {store.locale === "zh-CN" ? "解绑" : "Unbind"}
                  </Button>
                </div>
              ))}
              {bindingHistory.map((binding) => (
                <div key={binding.id}>
                  <X />
                  <span>
                    <strong>{store.uavs.find((item) => item.id === binding.uavId)?.code}</strong>
                    <small>
                      {store.locale === "zh-CN" ? "已解绑" : "Unbound"} ·{" "}
                      {formatDate(binding.unboundAt!, store.locale)}
                    </small>
                  </span>
                </div>
              ))}
              <NativeSelect
                onChange={(e) => {
                  if (e.target.value)
                    void executeAction(() => store.bindDevice(Number(e.target.value)), store.locale)
                  e.target.value = ""
                }}
                defaultValue=""
              >
                <NativeSelectOption value="" disabled>
                  {store.locale === "zh-CN" ? "绑定其他设备" : "Bind another device"}
                </NativeSelectOption>
                {store.uavs
                  .filter((uav) => !bindings.some((binding) => binding.uavId === uav.id))
                  .map((uav) => (
                    <NativeSelectOption key={uav.id} value={uav.id}>
                      {uav.code}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </div>
          </Section>
          {desktopRuntime && (
            <Section title={store.locale === "zh-CN" ? "桌面窗口" : "Desktop window"}>
              <div id="desktop" className="desktop-window-settings">
                <div className="desktop-setting-intro">
                  <span>
                    <strong>
                      {store.locale === "zh-CN" ? "无边框窗口布局" : "Frameless window layout"}
                    </strong>
                    <small>
                      {store.locale === "zh-CN"
                        ? "窗口尺寸、位置、最大化与全屏状态会在退出时自动保存。"
                        : "Size, position, maximized, and fullscreen state are saved automatically on exit."}
                    </small>
                  </span>
                  <StatusPill value={store.locale === "zh-CN" ? "桌面已启用" : "Desktop enabled"} />
                </div>
                <div
                  className="window-position-grid"
                  aria-label={store.locale === "zh-CN" ? "窗口定位" : "Window positioning"}
                >
                  {windowPositions.map(({ value, zh, en, icon: Icon }) => {
                    const label = store.locale === "zh-CN" ? zh : en
                    return (
                      <Button
                        key={value}
                        type="button"
                        variant="outline"
                        disabled={windowBusy}
                        aria-label={`${store.locale === "zh-CN" ? "移动窗口到" : "Move window to"} ${label}`}
                        onClick={() =>
                          void runWindowAction(
                            () => moveAppWindow(value),
                            store.locale === "zh-CN"
                              ? `窗口已移动到${label}`
                              : `Window moved to ${label.toLowerCase()}`
                          )
                        }
                      >
                        <Icon />
                        <span>{label}</span>
                      </Button>
                    )
                  })}
                </div>
                <div className="window-state-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={windowBusy}
                    onClick={() =>
                      void runWindowAction(
                        saveAppWindowState,
                        store.locale === "zh-CN"
                          ? "当前窗口布局已保存"
                          : "Current window layout saved"
                      )
                    }
                  >
                    <Save />
                    {store.locale === "zh-CN" ? "立即保存布局" : "Save layout now"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={windowBusy}
                    onClick={() =>
                      void runWindowAction(
                        restoreAppWindowState,
                        store.locale === "zh-CN" ? "已恢复上次保存的布局" : "Saved layout restored"
                      )
                    }
                  >
                    <RotateCcw />
                    {store.locale === "zh-CN" ? "恢复保存布局" : "Restore saved layout"}
                  </Button>
                </div>
                {windowMessage && <p className="window-action-status">{windowMessage}</p>}
              </div>
            </Section>
          )}
          <Section title={copy.about}>
            <div id="about" className="settings-rows">
              <Button
                onClick={() => {
                  store.clearNonAuthCache()
                  void queryClient
                    .resetQueries({
                      predicate: (query) => query.queryKey[0] !== "session",
                    })
                    .then(() => toast.success(copy.cacheCleared))
                }}
              >
                <Database />
                <span>
                  <strong>{copy.clearCache}</strong>
                  <small>
                    {store.locale === "zh-CN"
                      ? "保留登录与安全凭据"
                      : "Authentication credentials are preserved"}
                  </small>
                </span>
                <ChevronRight />
              </Button>
              <Button onClick={checkUpdate} disabled={checkingUpdate || installingUpdate}>
                {checkingUpdate ? <Spinner /> : <RotateCcw />}
                <span>
                  <strong>{copy.checkUpdate}</strong>
                  <small>{updateMessage || platformInfo?.appVersion || "v0.1.0"}</small>
                </span>
                <ChevronRight />
              </Button>
              {availableUpdate && (
                <div className="update-install-row">
                  <Button
                    className="button button-primary"
                    disabled={installingUpdate}
                    onClick={() => void installUpdate()}
                  >
                    {installingUpdate ? <Spinner /> : <RotateCcw />}
                    {installingUpdate
                      ? store.locale === "zh-CN"
                        ? `正在安装 ${updateProgress}%`
                        : `Installing ${updateProgress}%`
                      : store.locale === "zh-CN"
                        ? `下载并安装 ${availableUpdate}`
                        : `Download and install ${availableUpdate}`}
                  </Button>
                  {installingUpdate && <Progress value={updateProgress} />}
                </div>
              )}
              <div className="about-line">
                <span>
                  {copy.brand} · {copy.console}
                </span>
                <code>
                  {platformInfo
                    ? `${platformInfo.platform.toUpperCase()} ${platformInfo.architecture} · v${platformInfo.appVersion}`
                    : "WEB · API v1"}
                </code>
              </div>
              {platformInfo && (
                <dl className="desktop-system-info">
                  <div>
                    <dt>{store.locale === "zh-CN" ? "操作系统" : "Operating system"}</dt>
                    <dd>
                      {platformInfo.osType.toUpperCase()} {platformInfo.osVersion}
                    </dd>
                  </div>
                  <div>
                    <dt>{store.locale === "zh-CN" ? "系统家族" : "System family"}</dt>
                    <dd>{platformInfo.family}</dd>
                  </div>
                  <div>
                    <dt>{store.locale === "zh-CN" ? "处理器架构" : "Architecture"}</dt>
                    <dd>{platformInfo.architecture}</dd>
                  </div>
                  <div>
                    <dt>{store.locale === "zh-CN" ? "系统语言" : "System locale"}</dt>
                    <dd>
                      {platformInfo.locale ?? (store.locale === "zh-CN" ? "未知" : "Unknown")}
                    </dd>
                  </div>
                  <div>
                    <dt>{store.locale === "zh-CN" ? "可执行扩展名" : "Executable extension"}</dt>
                    <dd>
                      {platformInfo.executableExtension ||
                        (store.locale === "zh-CN" ? "无" : "None")}
                    </dd>
                  </div>
                  <div>
                    <dt>{store.locale === "zh-CN" ? "应用版本" : "App version"}</dt>
                    <dd>v{platformInfo.appVersion}</dd>
                  </div>
                </dl>
              )}
              <Button
                className="danger-row"
                disabled={loggingOut}
                data-state={loggingOut ? "loading" : undefined}
                onClick={() =>
                  void (async () => {
                    setLoggingOut(true)
                    if (isRemoteApi) {
                      try {
                        await api.logout()
                      } catch {
                        toast.warning(
                          store.locale === "zh-CN"
                            ? "服务端会话暂未撤销，已安全清除本机登录状态。"
                            : "The server session could not be revoked; local sign-in state was cleared."
                        )
                      }
                    }
                    await finishLogout()
                  })()
                }
              >
                {loggingOut ? <Spinner /> : <X />}
                <span>
                  <strong>
                    {loggingOut
                      ? store.locale === "zh-CN"
                        ? "正在退出…"
                        : "Signing out…"
                      : copy.logout}
                  </strong>
                </span>
                <ChevronRight />
              </Button>
            </div>
          </Section>
        </div>
      </div>
      <Dialog open={editingStaff !== null} onOpenChange={(open) => !open && setEditingStaff(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <UserCog />
              {editingStaff?.id
                ? store.locale === "zh-CN"
                  ? "编辑员工账号"
                  : "Edit staff account"
                : store.locale === "zh-CN"
                  ? "新增员工账号"
                  : "Add staff account"}
            </DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "管理员拥有全部权限；经理可监控、控制并处理订单与任务。"
                : "Administrators have full access; managers can monitor, control, and process operations."}
            </DialogDescription>
          </DialogHeader>
          <div className="form-grid">
            <Field
              label={store.locale === "zh-CN" ? "用户名" : "Username"}
              error={
                staffForm.formState.errors.username
                  ? store.locale === "zh-CN"
                    ? "请输入 3–32 位字母、数字或 . _ -"
                    : "Use 3–32 letters, numbers, or . _ -"
                  : undefined
              }
            >
              <Input
                autoComplete="off"
                aria-invalid={Boolean(staffForm.formState.errors.username)}
                {...staffForm.register("username")}
              />
            </Field>
            <Field
              label={store.locale === "zh-CN" ? "显示名称" : "Display name"}
              error={
                staffForm.formState.errors.displayName
                  ? store.locale === "zh-CN"
                    ? "请输入显示名称"
                    : "Enter a display name"
                  : undefined
              }
            >
              <Input
                aria-invalid={Boolean(staffForm.formState.errors.displayName)}
                {...staffForm.register("displayName")}
              />
            </Field>
            <Field
              label={store.locale === "zh-CN" ? "手机号" : "Phone"}
              error={
                staffForm.formState.errors.phone
                  ? store.locale === "zh-CN"
                    ? "请输入有效的中国大陆手机号"
                    : "Enter a valid mainland China mobile number"
                  : undefined
              }
            >
              <Input
                inputMode="tel"
                aria-invalid={Boolean(staffForm.formState.errors.phone)}
                {...staffForm.register("phone")}
              />
            </Field>
            <Field
              label={
                editingStaff?.id
                  ? store.locale === "zh-CN"
                    ? "重置密码（可选）"
                    : "Reset password (optional)"
                  : store.locale === "zh-CN"
                    ? "初始密码"
                    : "Initial password"
              }
              error={
                staffForm.formState.errors.password
                  ? store.locale === "zh-CN"
                    ? "至少需要 8 个字符"
                    : "Use at least 8 characters"
                  : undefined
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(staffForm.formState.errors.password)}
                {...staffForm.register("password")}
              />
            </Field>
            <Field label={store.locale === "zh-CN" ? "角色" : "Role"}>
              <NativeSelect
                value={staffRole}
                disabled={editingStaff?.id === store.staff?.id}
                onChange={(event) =>
                  staffForm.setValue("role", event.target.value as StaffAccount["role"], {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                <NativeSelectOption value="manager">manager</NativeSelectOption>
                <NativeSelectOption value="admin">admin</NativeSelectOption>
              </NativeSelect>
            </Field>
            {editingStaff?.id && (
              <Field label={copy.status}>
                <NativeSelect
                  value={staffEnabled ? "enabled" : "disabled"}
                  disabled={editingStaff.id === store.staff?.id}
                  onChange={(event) =>
                    staffForm.setValue("enabled", event.target.value === "enabled", {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <NativeSelectOption value="enabled">
                    {store.locale === "zh-CN" ? "启用" : "Enabled"}
                  </NativeSelectOption>
                  <NativeSelectOption value="disabled">
                    {store.locale === "zh-CN" ? "停用" : "Disabled"}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setEditingStaff(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={staffSaving}
              onClick={staffForm.handleSubmit(saveStaffAccount)}
            >
              <PendingLabel
                pending={staffSaving}
                pendingLabel={store.locale === "zh-CN" ? "保存中…" : "Saving…"}
              >
                {copy.save}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.changePassword}</DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "修改后将撤销所有活动会话，并要求重新登录。"
                : "Changing the password revokes every active session and requires a new login."}
            </DialogDescription>
          </DialogHeader>
          <Field label={store.locale === "zh-CN" ? "当前密码" : "Current password"}>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field
            label={store.locale === "zh-CN" ? "新密码" : "New password"}
            error={
              newPassword && newPassword.length < 8
                ? store.locale === "zh-CN"
                  ? "至少需要 8 个字符"
                  : "Use at least 8 characters"
                : undefined
            }
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setPasswordOpen(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={!currentPassword || newPassword.length < 8}
              onClick={() =>
                void executeAction(
                  () => api.changePassword(currentPassword, newPassword),
                  store.locale,
                  copy.save
                ).then(async (result) => {
                  if (!result.ok) return
                  await finishLogout()
                })
              }
            >
              {copy.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.sessions}</DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "撤销不认识的设备会立即阻止其刷新登录状态。"
                : "Revoke an unknown device to prevent it from refreshing its login."}
            </DialogDescription>
          </DialogHeader>
          <div className="binding-list">
            {sessions.map((session) => (
              <div key={session.id}>
                <Radio />
                <span>
                  <strong>{session.userAgent}</strong>
                  <small>
                    {session.ipAddress} · {formatDate(session.createdAt, store.locale)}
                    {session.current ? ` · ${store.locale === "zh-CN" ? "当前" : "Current"}` : ""}
                  </small>
                </span>
                <ConfirmAction
                  trigger={
                    <Button variant="link" size="sm" className="text-button danger-text">
                      {store.locale === "zh-CN" ? "撤销" : "Revoke"}
                    </Button>
                  }
                  title={store.locale === "zh-CN" ? "确认撤销会话" : "Revoke session?"}
                  description={
                    session.current
                      ? store.locale === "zh-CN"
                        ? "这是当前会话，撤销后将立即退出登录。"
                        : "This is the current session. Revoking it signs you out immediately."
                      : store.locale === "zh-CN"
                        ? "该设备将无法继续刷新登录状态。"
                        : "This device will no longer be able to refresh its session."
                  }
                  cancelLabel={copy.cancel}
                  confirmLabel={store.locale === "zh-CN" ? "确认撤销" : "Revoke"}
                  onConfirm={() => {
                    void executeAction(() => api.revokeSession(session.id), store.locale).then(
                      async (result) => {
                        if (!result.ok) return
                        setSessions((items) => items.filter((item) => item.id !== session.id))
                        if (session.current) {
                          await finishLogout()
                        }
                      }
                    )
                  }}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
