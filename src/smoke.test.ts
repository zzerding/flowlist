import { describe, expect, it } from "vitest"
import fc from "fast-check"

// 接缝 1 冒烟：fast-check 就绪。真正的领域不变量测试随 domain 模块落地。
describe("scaffold", () => {
  it("fast-check runs deterministically", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(Math.abs(n)).toBeGreaterThanOrEqual(0)
      }),
    )
  })
})
