import { describe, expect, it } from "vitest"

import {
  BYTE_TOLERANCE,
  COLLAPSED_RATIO,
  DATE_SEPARATORS,
  DEPTH_BANDS,
  HUGE_BRANCH_COUNT,
  HUGE_BRANCH_MIN_CHILDREN,
  INLINE_CODE_RATIO,
  INLINE_FORMAT_RATIO,
  LANGUAGE_RATIOS,
  LINK_RATIO,
  LONG_TEXT_RATIO,
  MAX_DEPTH,
  NOTE_RATIO,
  TAG_RATIO,
  TARGET_BYTES,
  TARGET_NODE_COUNT,
  TOMBSTONE_RATIO,
  TODO_COMPLETED_RATIO,
  TYPE_RATIOS,
  WIDE_BRANCH_COUNT,
  WIDE_BRANCH_MIN_CHILDREN,
} from "./seedConstants"

/**
 * 冻结契约守卫(issue #2 决策记录第 7 条):
 * 这些断言的作用是「配比一旦被改动,测试立刻红,提醒必须重跑全部性能门禁」。
 * 修改本测试 = 修改冻结契约,须走契约变更流程。
 */
describe("seedConstants 冻结契约", () => {
  it("目标规模为 100k 节点 / 50MB ±5%", () => {
    expect(TARGET_NODE_COUNT).toBe(100_000)
    expect(TARGET_BYTES).toBe(50 * 1024 * 1024)
    expect(BYTE_TOLERANCE).toBe(0.05)
  })

  it("深度带:1–3 占 40%、4–6 占 40%、7–10 占 20%,最深 12", () => {
    expect(DEPTH_BANDS).toEqual([
      { minDepth: 1, maxDepth: 3, weight: 0.4 },
      { minDepth: 4, maxDepth: 6, weight: 0.4 },
      { minDepth: 7, maxDepth: 10, weight: 0.2 },
    ])
    expect(MAX_DEPTH).toBe(12)
  })

  it("宽/巨分支:300 个宽分支 ≥100 子,10 个 ≥1000 子", () => {
    expect(WIDE_BRANCH_COUNT).toBe(300)
    expect(WIDE_BRANCH_MIN_CHILDREN).toBe(100)
    expect(HUGE_BRANCH_COUNT).toBe(10)
    expect(HUGE_BRANCH_MIN_CHILDREN).toBe(1000)
  })

  it("类型配比:bullet 70 / paragraph 15 / todo 10 / 其余 5;todo 完成 30%", () => {
    expect(TYPE_RATIOS).toEqual({ bullet: 0.7, paragraph: 0.15, todo: 0.1, other: 0.05 })
    expect(TODO_COMPLETED_RATIO).toBe(0.3)
  })

  it("语言配比:中文 60 / 英文 30 / emoji 10", () => {
    expect(LANGUAGE_RATIOS).toEqual({ chinese: 0.6, english: 0.3, emoji: 0.1 })
  })

  it("行内与字段特性配比", () => {
    expect(LONG_TEXT_RATIO).toBe(0.05)
    expect(INLINE_FORMAT_RATIO).toBe(0.2)
    expect(LINK_RATIO).toBe(0.05)
    expect(INLINE_CODE_RATIO).toBe(0.05)
    expect(NOTE_RATIO).toBe(0.3)
    expect(TAG_RATIO).toBe(0.1)
    expect(COLLAPSED_RATIO).toBe(0.2)
    expect(TOMBSTONE_RATIO).toBe(0.02)
  })

  it("日期分隔符为 - / . / 三种", () => {
    expect(DATE_SEPARATORS).toEqual(["-", "/", "."])
  })
})
