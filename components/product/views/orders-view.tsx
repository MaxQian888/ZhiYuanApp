"use client"

import { Plus } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import {
  Field,
  MetricStrip,
  PageHeader,
  Section,
  StatusPill,
} from "@/components/product/primitives"
import { executeAction, formatDate, PendingLabel, useUrlId } from "@/components/product/view-kit"
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
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

function OrderActions({ orderId }: { orderId: number }) {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const order = store.orders.find((item) => item.id === orderId)
  const [uavId, setUavId] = useState(store.uavs.find((item) => item.status === "ONLINE")?.id ?? 1)
  if (!order) return null
  return (
    <Section title={store.locale === "zh-CN" ? "订单操作" : "Order actions"}>
      <div className="action-line">
        <NativeSelect value={uavId} onChange={(event) => setUavId(Number(event.target.value))}>
          {store.uavs
            .filter((item) => item.status === "ONLINE")
            .map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.code} · {item.battery}%
              </NativeSelectOption>
            ))}
        </NativeSelect>
        <Button
          className="button button-primary"
          disabled={order.status !== "CREATED"}
          onClick={() =>
            void executeAction(
              () => store.dispatchOrder(orderId, uavId),
              store.locale,
              copy.dispatch
            )
          }
        >
          {copy.dispatch}
        </Button>
        <Button
          className="button button-danger"
          disabled={!["CREATED", "DISPATCHING"].includes(order.status)}
          onClick={() =>
            void executeAction(
              () => store.transitionOrder(orderId, "CANCELLED"),
              store.locale,
              copy.cancelOrder
            )
          }
        >
          {copy.cancelOrder}
        </Button>
      </div>
    </Section>
  )
}

export function OrdersView({ detail = false }: { detail?: boolean }) {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const id = useUrlId(store.orders[0]?.id ?? 1)
  const order = store.orders.find((item) => item.id === id) ?? store.orders[0]
  const [creating, setCreating] = useState(false)
  const [userId, setUserId] = useState(store.users.find((user) => user.addresses.length)?.id ?? 0)
  const selectedUser = store.users.find((user) => user.id === userId)
  const [addressId, setAddressId] = useState(selectedUser?.addresses[0]?.id ?? 0)
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [saving, setSaving] = useState(false)
  if (detail)
    return (
      <>
        <PageHeader
          title={order.orderNo}
          description={`${copy.orders} · ${formatDate(order.createdAt, store.locale)}`}
          actions={<StatusPill value={order.status} />}
        />
        <MetricStrip
          items={[
            {
              label: store.locale === "zh-CN" ? "订单金额" : "Total",
              value: `¥${order.totalPrice.toFixed(2)}`,
            },
            {
              label: copy.users,
              value: store.users.find((item) => item.id === order.userId)?.username ?? "—",
            },
            {
              label: copy.tasks,
              value: store.tasks.find((item) => item.orderId === order.id)?.taskStatus ?? "—",
            },
          ]}
        />
        <Section title={store.locale === "zh-CN" ? "订单明细" : "Order items"}>
          <div className="definition-list">
            {order.items.map((item) => (
              <div key={item.id}>
                <dt>
                  {item.goodsName} × {item.count}
                </dt>
                <dd>¥{(item.price * item.count).toFixed(2)}</dd>
              </div>
            ))}
          </div>
        </Section>
        {order.addressSnapshot && (
          <Section title={store.locale === "zh-CN" ? "配送地址快照" : "Delivery address snapshot"}>
            <div className="definition-list">
              <div>
                <dt>{order.addressSnapshot.receiverName}</dt>
                <dd>{order.addressSnapshot.receiverPhone}</dd>
              </div>
              <div>
                <dt>{store.locale === "zh-CN" ? "详细地址" : "Address"}</dt>
                <dd>{order.addressSnapshot.detail}</dd>
              </div>
            </div>
          </Section>
        )}
        <OrderActions orderId={order.id} />
      </>
    )
  return (
    <>
      <PageHeader
        title={copy.orders}
        description={
          store.locale === "zh-CN"
            ? "从创建、调度、配送到完成追踪订单。"
            : "Track orders from creation through dispatch and delivery."
        }
        actions={
          <Button className="button button-primary" onClick={() => setCreating(true)}>
            <Plus />
            {copy.add}
          </Button>
        }
      />
      <Section title={`${copy.orders} · ${store.orders.length}`}>
        <div className="data-table compact orders-table">
          <div className="table-head">
            <span>{copy.orders}</span>
            <span>{copy.users}</span>
            <span>{store.locale === "zh-CN" ? "金额" : "Total"}</span>
            <span>{copy.status}</span>
            <span>{copy.updated}</span>
            <span>{copy.action}</span>
          </div>
          {store.orders.map((item) => (
            <div className="table-row" key={item.id}>
              <span data-label={copy.orders}>
                <strong>{item.orderNo}</strong>
              </span>
              <span data-label={copy.users}>
                {store.users.find((user) => user.id === item.userId)?.username}
              </span>
              <span data-label="Total">¥{item.totalPrice.toFixed(2)}</span>
              <span data-label={copy.status}>
                <StatusPill value={item.status} />
              </span>
              <span data-label={copy.updated}>{formatDate(item.createdAt, store.locale)}</span>
              <span data-label={copy.action}>
                <Link className="text-link" href={`/orders/detail?id=${item.id}`}>
                  {copy.details} →
                </Link>
              </span>
            </div>
          ))}
        </div>
      </Section>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{store.locale === "zh-CN" ? "创建订单" : "Create order"}</DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "选择用户、地址和商品数量；库存将在创建成功后扣减。"
                : "Select a user, address, and quantities. Stock is deducted after creation."}
            </DialogDescription>
          </DialogHeader>
          <Field label={copy.users}>
            <NativeSelect
              value={userId}
              onChange={(event) => {
                const nextUserId = Number(event.target.value)
                const nextUser = store.users.find((user) => user.id === nextUserId)
                setUserId(nextUserId)
                setAddressId(nextUser?.addresses[0]?.id ?? 0)
              }}
            >
              {store.users
                .filter((user) => user.addresses.length)
                .map((user) => (
                  <NativeSelectOption key={user.id} value={user.id}>
                    {user.username} · {user.phone}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          <Field label={store.locale === "zh-CN" ? "配送地址" : "Delivery address"}>
            <NativeSelect
              value={addressId}
              onChange={(event) => setAddressId(Number(event.target.value))}
            >
              {selectedUser?.addresses.map((address) => (
                <NativeSelectOption key={address.id} value={address.id}>
                  {address.detail}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="order-editor">
            {store.goods
              .filter((goods) => goods.status === 1 && goods.stock > 0)
              .map((goods) => (
                <label key={goods.id}>
                  <span>
                    <strong>{goods.name}</strong>
                    <small>
                      ¥{goods.price.toFixed(2)} · {store.locale === "zh-CN" ? "可用" : "Available"}{" "}
                      {goods.stock}
                    </small>
                  </span>
                  <Input
                    type="number"
                    min="0"
                    max={goods.stock}
                    value={quantities[goods.id] ?? 0}
                    onChange={(event) =>
                      setQuantities((value) => ({
                        ...value,
                        [goods.id]: Math.max(0, Math.min(goods.stock, Number(event.target.value))),
                      }))
                    }
                    aria-label={`${goods.name} quantity`}
                  />
                </label>
              ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="button button-secondary"
              onClick={() => setCreating(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              className="button button-primary"
              disabled={
                saving ||
                !userId ||
                !addressId ||
                !Object.values(quantities).some((count) => count > 0)
              }
              data-state={saving ? "loading" : undefined}
              onClick={() => {
                const items = Object.entries(quantities)
                  .filter(([, count]) => count > 0)
                  .map(([goodsId, count]) => ({ goodsId: Number(goodsId), count }))
                setSaving(true)
                void executeAction(
                  () => store.createOrder(userId, addressId, items),
                  store.locale,
                  copy.save
                ).then((result) => {
                  setSaving(false)
                  if (!result.ok) return
                  setCreating(false)
                  setQuantities({})
                })
              }}
            >
              <PendingLabel
                pending={saving}
                pendingLabel={store.locale === "zh-CN" ? "创建中…" : "Creating…"}
              >
                {copy.save}
              </PendingLabel>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
