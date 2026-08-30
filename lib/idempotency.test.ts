import { IdempotencyIntent } from "@/lib/idempotency"

describe("IdempotencyIntent", () => {
  it("reuses a key while the logical intent is unchanged", () => {
    const intent = new IdempotencyIntent()

    expect(intent.keyFor("same-order")).toBe(intent.keyFor("same-order"))
  })

  it("abandons the key when the payload changes or the intent is cleared", () => {
    const intent = new IdempotencyIntent()
    const original = intent.keyFor("order-v1")

    expect(intent.keyFor("order-v2")).not.toBe(original)
    const changed = intent.keyFor("order-v2")
    intent.clear()
    expect(intent.keyFor("order-v2")).not.toBe(changed)
  })
})
