import { renderHook } from "@testing-library/react"
import { messages, useCopy } from "@/lib/i18n-product"

describe("product copy", () => {
  it("ships exactly the two supported locales", () => {
    expect(Object.keys(messages).sort()).toEqual(["en", "zh-CN"])
  })

  it("keeps both locales on the same key set so a lookup can never fall through", () => {
    const chinese = Object.keys(messages["zh-CN"]).sort()
    const english = Object.keys(messages.en).sort()
    expect(english).toEqual(chinese)
  })

  it("has no blank strings in either locale", () => {
    for (const [locale, dictionary] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(`${locale}.${key}: ${value}`).not.toMatch(/: *$/)
      }
    }
  })

  it("returns the dictionary for the requested locale", () => {
    const { result: chinese } = renderHook(() => useCopy("zh-CN"))
    expect(chinese.current.brand).toBe("智鸢")
    expect(chinese.current.login).toBe("登录")

    const { result: english } = renderHook(() => useCopy("en"))
    expect(english.current.login).toBe("Sign in")
    expect(english.current.brand).not.toBe(chinese.current.brand)
  })
})
