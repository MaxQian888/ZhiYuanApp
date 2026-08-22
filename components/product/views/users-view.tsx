"use client"

import { MapPin, Plus } from "lucide-react"
import { useState } from "react"
import {
  ConfirmAction,
  Field,
  PageHeader,
  Section,
  StatusPill,
} from "@/components/product/primitives"
import { executeAction, formatDate, PendingLabel } from "@/components/product/view-kit"
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
import { type ManagedUser } from "@/lib/domain"
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

function AddressDialog({ userId, onClose }: { userId: number | null; onClose: () => void }) {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const user = store.users.find((item) => item.id === userId)
  const [detail, setDetail] = useState("")
  const [receiverName, setReceiverName] = useState("")
  const [receiverPhone, setReceiverPhone] = useState("")
  const [latitude, setLatitude] = useState("")
  const [longitude, setLongitude] = useState("")
  const [editingAddressId, setEditingAddressId] = useState<number | undefined>()
  const [saving, setSaving] = useState(false)
  if (!userId || !user) return null
  const resetAddressForm = () => {
    setEditingAddressId(undefined)
    setReceiverName("")
    setReceiverPhone("")
    setDetail("")
    setLatitude("")
    setLongitude("")
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {user.username} · {store.locale === "zh-CN" ? "收货地址" : "Addresses"}
          </DialogTitle>
          <DialogDescription>
            {store.locale === "zh-CN"
              ? "新增地址会设为默认地址，并取消原默认地址。"
              : "The new address becomes default and replaces the previous default."}
          </DialogDescription>
        </DialogHeader>
        <div className="address-list">
          {user.addresses.map((item) => (
            <div key={item.id}>
              <MapPin />
              <span>
                <strong>
                  {item.receiverName} · {item.receiverPhone}
                </strong>
                <small>{item.detail}</small>
              </span>
              {item.isDefault && <StatusPill value="DEFAULT" />}
              <span className="address-actions">
                <Button
                  className="text-button"
                  onClick={() => {
                    setEditingAddressId(item.id)
                    setReceiverName(item.receiverName)
                    setReceiverPhone(item.receiverPhone)
                    setDetail(item.detail)
                    setLatitude(String(item.latitude))
                    setLongitude(String(item.longitude))
                  }}
                >
                  {copy.edit}
                </Button>
                {!item.isDefault && (
                  <Button
                    className="text-button"
                    onClick={() =>
                      void executeAction(
                        () => store.setDefaultAddress(userId, item.id),
                        store.locale,
                        copy.save
                      )
                    }
                  >
                    {store.locale === "zh-CN" ? "设为默认" : "Set default"}
                  </Button>
                )}
                <ConfirmAction
                  trigger={
                    <Button variant="link" size="sm" className="text-button danger-text">
                      {copy.delete}
                    </Button>
                  }
                  title={store.locale === "zh-CN" ? "确认删除地址" : "Delete address?"}
                  description={
                    store.locale === "zh-CN"
                      ? `将永久删除“${item.detail}”。`
                      : `This permanently deletes “${item.detail}”.`
                  }
                  cancelLabel={copy.cancel}
                  confirmLabel={copy.delete}
                  onConfirm={() => {
                    void executeAction(
                      () => store.deleteAddress(userId, item.id),
                      store.locale,
                      copy.delete
                    )
                  }}
                />
              </span>
            </div>
          ))}
        </div>
        <div className="form-grid">
          <Field label={store.locale === "zh-CN" ? "收件人" : "Receiver"}>
            <Input
              value={receiverName}
              placeholder={user.username}
              onChange={(event) => setReceiverName(event.target.value)}
            />
          </Field>
          <Field
            label={store.locale === "zh-CN" ? "收件手机号" : "Receiver phone"}
            error={
              receiverPhone && !/^1\d{10}$/.test(receiverPhone)
                ? store.locale === "zh-CN"
                  ? "请输入有效手机号"
                  : "Enter a valid phone number"
                : undefined
            }
          >
            <Input
              value={receiverPhone}
              placeholder={user.phone}
              onChange={(event) => setReceiverPhone(event.target.value)}
            />
          </Field>
        </div>
        <Field label={store.locale === "zh-CN" ? "详细地址" : "Address detail"}>
          <Input value={detail} onChange={(event) => setDetail(event.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label={store.locale === "zh-CN" ? "纬度" : "Latitude"}>
            <Input
              type="number"
              min="-90"
              max="90"
              step="0.000001"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
            />
          </Field>
          <Field label={store.locale === "zh-CN" ? "经度" : "Longitude"}>
            <Input
              type="number"
              min="-180"
              max="180"
              step="0.000001"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="button button-secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            className="button button-primary"
            disabled={
              saving ||
              !detail.trim() ||
              !latitude.trim() ||
              !longitude.trim() ||
              !Number.isFinite(Number(latitude)) ||
              !Number.isFinite(Number(longitude)) ||
              Number(latitude) < -90 ||
              Number(latitude) > 90 ||
              Number(longitude) < -180 ||
              Number(longitude) > 180
            }
            data-state={saving ? "loading" : undefined}
            onClick={() =>
              void (async () => {
                if (!detail.trim()) return
                setSaving(true)
                const result = await executeAction(
                  () =>
                    store.saveAddress(userId, {
                      id: editingAddressId,
                      receiverName: receiverName.trim() || user.username,
                      receiverPhone: receiverPhone.trim() || user.phone,
                      detail,
                      latitude: Number(latitude),
                      longitude: Number(longitude),
                      isDefault:
                        user.addresses.find((address) => address.id === editingAddressId)
                          ?.isDefault ?? true,
                    }),
                  store.locale,
                  copy.save
                )
                setSaving(false)
                if (result.ok) resetAddressForm()
              })()
            }
          >
            <PendingLabel
              pending={saving}
              pendingLabel={store.locale === "zh-CN" ? "保存中…" : "Saving…"}
            >
              {editingAddressId ? copy.save : copy.add}
            </PendingLabel>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UsersView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [editing, setEditing] = useState<Partial<ManagedUser> | null>(null)
  const [addressUser, setAddressUser] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!editing?.username || !/^1\d{10}$/.test(editing.phone ?? "")) return
    setSaving(true)
    const result = await executeAction(
      () => store.saveUser({ id: editing.id, username: editing.username!, phone: editing.phone! }),
      store.locale,
      copy.save
    )
    setSaving(false)
    if (result.ok) setEditing(null)
  }
  return (
    <>
      <PageHeader
        title={copy.users}
        description={
          store.locale === "zh-CN"
            ? "管理配送用户与地址；每位用户只允许一个默认地址。"
            : "Manage delivery users and enforce one default address per user."
        }
        actions={
          <Button className="button button-primary" onClick={() => setEditing({})}>
            <Plus />
            {copy.add}
          </Button>
        }
      />
      <Section title={`${copy.users} · ${store.users.length}`}>
        <div className="data-table compact">
          <div className="table-head">
            <span>{copy.users}</span>
            <span>{store.locale === "zh-CN" ? "手机号" : "Phone"}</span>
            <span>{store.locale === "zh-CN" ? "地址" : "Addresses"}</span>
            <span>{copy.updated}</span>
            <span>{copy.action}</span>
          </div>
          {store.users.map((user) => (
            <div className="table-row" key={user.id}>
              <span data-label={copy.users}>
                <strong>{user.username}</strong>
                <small>USR-{String(user.id).padStart(4, "0")}</small>
              </span>
              <span data-label="Phone">{user.phone}</span>
              <span data-label="Addresses">
                <Button
                  variant="link"
                  size="sm"
                  className="text-button"
                  onClick={() => setAddressUser(user.id)}
                >
                  {user.addresses.length} · {copy.edit}
                </Button>
              </span>
              <span data-label={copy.updated}>{formatDate(user.createdAt, store.locale)}</span>
              <span data-label={copy.action}>
                <Button
                  variant="link"
                  size="sm"
                  className="text-button"
                  onClick={() => setEditing(user)}
                >
                  {copy.edit}
                </Button>
                <ConfirmAction
                  trigger={
                    <Button variant="link" size="sm" className="text-button danger-text">
                      {copy.delete}
                    </Button>
                  }
                  title={store.locale === "zh-CN" ? "确认删除用户" : "Delete user?"}
                  description={
                    store.locale === "zh-CN"
                      ? `用户“${user.username}”及其地址将被永久删除。`
                      : `${user.username} and associated addresses will be permanently deleted.`
                  }
                  cancelLabel={copy.cancel}
                  confirmLabel={copy.delete}
                  onConfirm={() => {
                    void executeAction(() => store.deleteUser(user.id), store.locale, copy.delete)
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      </Section>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? copy.edit : copy.add} {copy.users}
            </DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "手机号必须为 11 位大陆手机号。"
                : "Phone must be an 11-digit mainland China number."}
            </DialogDescription>
          </DialogHeader>
          <Field label={copy.users}>
            <Input
              value={editing?.username ?? ""}
              onChange={(event) =>
                setEditing((value) => ({ ...value, username: event.target.value }))
              }
            />
          </Field>
          <Field
            label={store.locale === "zh-CN" ? "手机号" : "Phone"}
            error={
              editing?.phone && !/^1\d{10}$/.test(editing.phone)
                ? store.locale === "zh-CN"
                  ? "请输入有效手机号"
                  : "Enter a valid phone number"
                : undefined
            }
          >
            <Input
              value={editing?.phone ?? ""}
              onChange={(event) => setEditing((value) => ({ ...value, phone: event.target.value }))}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setEditing(null)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={saving}
              data-state={saving ? "loading" : undefined}
              onClick={() => void save()}
            >
              <PendingLabel
                pending={saving}
                pendingLabel={store.locale === "zh-CN" ? "保存中…" : "Saving…"}
              >
                {copy.save}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddressDialog userId={addressUser} onClose={() => setAddressUser(null)} />
    </>
  )
}
