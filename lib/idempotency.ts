/** Creates keys that also work in embedded webviews without crypto.randomUUID. */
export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Holds one key for one logical operator intent until it succeeds or is cancelled. */
export class IdempotencyIntent {
  private signature = ""
  private currentKey = ""

  keyFor(signature: string): string {
    if (!this.currentKey || this.signature !== signature) {
      this.signature = signature
      this.currentKey = createIdempotencyKey()
    }
    return this.currentKey
  }

  clear(): void {
    this.signature = ""
    this.currentKey = ""
  }
}
