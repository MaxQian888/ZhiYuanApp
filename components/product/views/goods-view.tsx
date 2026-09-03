"use client"

import { useQuery } from "@tanstack/react-query"
import { Plus, Search } from "lucide-react"
import { useState } from "react"
import {
  ConfirmAction,
  EmptyState,
  Field,
  MetricStrip,
  PageHeader,
  PaginationControls,
  Section,
  StatusPill,
} from "@/components/product/primitives"
import {
  executeAction,
  PendingLabel,
  QueryError,
  QueryLoading,
} from "@/components/product/view-kit"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { api } from "@/lib/api/client"
import { type Goods, onHandStock } from "@/lib/domain"
import { isRemoteApi } from "@/lib/env"
import { useCopy } from "@/lib/i18n-product"
import { useProductStore } from "@/stores/product-store"

const categoryKeys = ["food", "medicine", "life", "industry"] as const

/**
 * Display names for the four goods categories.
 *
 * The stored value stays the English key, because it is what the API filters on. Only the
 * label is translated, so a Chinese console stops showing "MEDICINE" in the middle of a
 * Chinese sentence.
 */
const categoryNames: Record<(typeof categoryKeys)[number], Record<"zh-CN" | "en", string>> = {
  food: { "zh-CN": "食品", en: "Food" },
  medicine: { "zh-CN": "医药", en: "Medicine" },
  life: { "zh-CN": "生活", en: "Life" },
  industry: { "zh-CN": "工业", en: "Industry" },
}

export function GoodsView() {
  const store = useProductStore()
  const copy = useCopy(store.locale)
  const [editing, setEditing] = useState<Partial<Goods> | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<Goods["category"] | "ALL">("ALL")
  const [page, setPage] = useState(1)
  const pageSize = 10
  const goodsRevision = store.goods
    .map((item) => `${item.id}:${item.name}:${item.category}:${item.stock}:${item.status}`)
    .join("|")
  const serverPage = useQuery({
    queryKey: ["goods-page", query, category, page, goodsRevision],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: String(pageSize) })
      if (query.trim()) params.set("q", query.trim())
      if (category !== "ALL") params.set("category", category)
      return api.goods(`?${params}`)
    },
    enabled: isRemoteApi,
    placeholderData: (previous) => previous,
  })
  const save = async () => {
    if (!editing?.name) return
    setSaving(true)
    const name = editing.name
    const result = await executeAction(
      () =>
        store.saveGoods({
          id: editing.id,
          name,
          category: editing.category ?? "life",
          price: Number(editing.price ?? 0),
          stock: Number(editing.stock ?? 0),
          weight: Number(editing.weight ?? 0),
          status: editing.status ?? 1,
        }),
      store.locale,
      copy.save
    )
    setSaving(false)
    if (result.ok) setEditing(null)
  }
  const categoryCounts = categoryKeys.map((key) => ({
    key,
    label: categoryNames[key][store.locale],
    value: store.goods.filter((item) => item.category === key).length,
  }))
  const filteredGoods = store.goods.filter(
    (item) =>
      (!query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase())) &&
      (category === "ALL" || item.category === category)
  )
  const total = isRemoteApi ? (serverPage.data?.total ?? 0) : filteredGoods.length
  const totalPages = isRemoteApi
    ? (serverPage.data?.totalPages ?? 1)
    : Math.max(1, Math.ceil(filteredGoods.length / pageSize))
  const rows = isRemoteApi
    ? (serverPage.data?.items ?? [])
    : filteredGoods.slice((page - 1) * pageSize, page * pageSize)
  const deleteSelectedGoods = async () => {
    const result = await executeAction(() => store.deleteGoods(selected), store.locale, copy.delete)
    if (!result.ok) return
    if (page > 1 && rows.every((item) => selected.includes(item.id))) {
      setPage((value) => value - 1)
    }
    setSelected([])
  }
  return (
    <>
      <PageHeader
        title={copy.goods}
        description={
          store.locale === "zh-CN"
            ? "管理商品、库存、分类与上下架状态。"
            : "Manage goods, stock, categories, and availability."
        }
        actions={
          <>
            <ConfirmAction
              trigger={
                <Button
                  variant="outline"
                  className="button button-secondary"
                  disabled={!selected.length}
                >
                  {copy.delete} ({selected.length})
                </Button>
              }
              title={store.locale === "zh-CN" ? "确认批量删除" : "Confirm bulk deletion"}
              description={
                store.locale === "zh-CN"
                  ? `将永久删除已选择的 ${selected.length} 个商品。`
                  : `This permanently deletes ${selected.length} selected goods.`
              }
              cancelLabel={copy.cancel}
              confirmLabel={copy.delete}
              onConfirm={deleteSelectedGoods}
            />
            <Button className="button button-primary" onClick={() => setEditing({})}>
              <Plus />
              {copy.add}
            </Button>
          </>
        }
      />
      <MetricStrip items={categoryCounts} />
      <Section
        title={`${copy.goods} · ${total}`}
        toolbar={
          <>
            <label className="search-field">
              <Search size={17} />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(1)
                }}
                placeholder={store.locale === "zh-CN" ? "搜索商品" : "Search goods"}
              />
            </label>
            <label>
              <span className="sr-only">{store.locale === "zh-CN" ? "分类" : "Category"}</span>
              <NativeSelect
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as Goods["category"] | "ALL")
                  setPage(1)
                }}
              >
                <NativeSelectOption value="ALL">
                  {store.locale === "zh-CN" ? "全部分类" : "All categories"}
                </NativeSelectOption>
                {categoryCounts.map((item) => (
                  <NativeSelectOption key={item.key} value={item.key}>
                    {item.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </>
        }
      >
        {isRemoteApi && serverPage.isError ? (
          <QueryError locale={store.locale} onRetry={() => void serverPage.refetch()} />
        ) : isRemoteApi && serverPage.isPending ? (
          <QueryLoading locale={store.locale} />
        ) : rows.length ? (
          <div className="data-table goods-table">
            <div className="table-head">
              <span>✓</span>
              <span>{copy.goods}</span>
              <span>{store.locale === "zh-CN" ? "分类" : "Category"}</span>
              <span>{store.locale === "zh-CN" ? "价格" : "Price"}</span>
              <span>{store.locale === "zh-CN" ? "可用库存" : "Available"}</span>
              <span>{store.locale === "zh-CN" ? "预留" : "Reserved"}</span>
              <span>{store.locale === "zh-CN" ? "在手" : "On hand"}</span>
              <span>{copy.status}</span>
              <span>{copy.action}</span>
            </div>
            {rows.map((item) => (
              <div className="table-row" key={item.id}>
                <span>
                  <label className="selection-control">
                    <Checkbox
                      checked={selected.includes(item.id)}
                      onCheckedChange={() =>
                        setSelected((value) =>
                          value.includes(item.id)
                            ? value.filter((id) => id !== item.id)
                            : [...value, item.id]
                        )
                      }
                      aria-label={`Select ${item.name}`}
                    />
                  </label>
                </span>
                <span data-label={copy.goods}>
                  <strong>{item.name}</strong>
                  <small>{item.weight} kg</small>
                </span>
                <span data-label={store.locale === "zh-CN" ? "分类" : "Category"}>
                  {categoryNames[item.category][store.locale]}
                </span>
                <span data-label={store.locale === "zh-CN" ? "价格" : "Price"}>
                  ¥{item.price.toFixed(2)}
                </span>
                <span data-label={store.locale === "zh-CN" ? "可用库存" : "Available"}>
                  {item.stock}
                </span>
                <span data-label={store.locale === "zh-CN" ? "预留" : "Reserved"}>
                  {item.reservedStock}
                </span>
                {/* Physical count. Available + reserved, so the two never drift apart. */}
                <span data-label={store.locale === "zh-CN" ? "在手" : "On hand"}>
                  {onHandStock(item)}
                </span>
                <span data-label={copy.status}>
                  <StatusPill value={item.status === 1 ? "ENABLED" : "DISABLED"} />
                </span>
                <span data-label={copy.action}>
                  <Button
                    className="text-button"
                    onClick={() =>
                      void executeAction(() => store.toggleGoods(item.id), store.locale)
                    }
                  >
                    {item.status ? copy.disable : copy.enable}
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-button"
                    onClick={() => setEditing(item)}
                  >
                    {copy.edit}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={copy.noResults} />
        )}
        <PaginationControls
          page={page}
          totalPages={totalPages}
          pending={serverPage.isFetching}
          locale={store.locale}
          onPageChange={setPage}
        />
      </Section>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? copy.edit : copy.add} {copy.goods}
            </DialogTitle>
            <DialogDescription>
              {store.locale === "zh-CN"
                ? "价格、库存和重量必须为非负数。"
                : "Price, stock, and weight must be non-negative."}
            </DialogDescription>
          </DialogHeader>
          <div className="form-grid">
            <Field label={copy.goods}>
              <Input
                value={editing?.name ?? ""}
                onChange={(e) => setEditing((v) => ({ ...v, name: e.target.value }))}
              />
            </Field>
            <Field label={store.locale === "zh-CN" ? "分类" : "Category"}>
              <NativeSelect
                value={editing?.category ?? "life"}
                onChange={(e) =>
                  setEditing((v) => ({ ...v, category: e.target.value as Goods["category"] }))
                }
              >
                {categoryKeys.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {categoryNames[value][store.locale]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field label={store.locale === "zh-CN" ? "价格" : "Price"}>
              <Input
                type="number"
                min="0"
                value={editing?.price ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, price: Number(e.target.value) }))}
              />
            </Field>
            <Field label={store.locale === "zh-CN" ? "库存" : "Stock"}>
              <Input
                type="number"
                min="0"
                value={editing?.stock ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, stock: Number(e.target.value) }))}
              />
            </Field>
            <Field label={store.locale === "zh-CN" ? "重量" : "Weight"}>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={editing?.weight ?? 0}
                onChange={(e) => setEditing((v) => ({ ...v, weight: Number(e.target.value) }))}
              />
            </Field>
          </div>
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
    </>
  )
}
