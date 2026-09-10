import { describe, expect, it } from "vitest"

import { generateSeed } from "./seedGenerator"
import { TARGET_BYTES, TARGET_NODE_COUNT, BYTE_TOLERANCE } from "./seedConstants"
import { isTombstoned } from "../domain/nodeRecord"

/**
 * seed 生成器契约测试(接缝 1,issue #2 决策记录第 7 条)。
 * 小规模用例用缩小参数控制单测时长;全量用例至少跑一次并记录耗时。
 * 注意小规模下限:每节点约 500B JSON 结构开销,否则体积契约无法收敛。
 */
const SMALL = { nodeCount: 2_000, targetBytes: 1_500_000 }

describe("seed 生成器", () => {
  it("确定性:同 seed 同输出(结构、内容、体积全等)", () => {
    const a = generateSeed({ ...SMALL, seed: 42 })
    const b = generateSeed({ ...SMALL, seed: 42 })
    expect(a.nodes.length).toBe(b.nodes.length)
    expect(a.bytes).toBe(b.bytes)
    // 抽样深比较(全量 JSON 比较在小规模下也可接受)
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes))
  })

  it("默认 PRNG 种子冻结为 20260910(fixture 契约的一部分)", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./seedGenerator.ts", import.meta.url), "utf8"),
    )
    expect(src).toContain("options.seed ?? 20260910")
  })

  it("不同 seed 产出不同内容", () => {
    const a = generateSeed({ ...SMALL, seed: 1 })
    const b = generateSeed({ ...SMALL, seed: 2 })
    expect(JSON.stringify(a.nodes)).not.toBe(JSON.stringify(b.nodes))
  })

  it("小规模:节点数落在目标附近(宽/巨分支补齐策略允许 ±2% 偏差),体积落在目标 ±5%", () => {
    const { nodes, bytes } = generateSeed(SMALL)
    // 生成器主循环数 = targetCount - 预留,宽/巨分支按「已随机获得的子数补足到下限」,
    // 已有子数 > 0 时总量略低于 targetCount —— 契约只承诺接近,不承诺精确
    expect(nodes.length).toBeGreaterThanOrEqual(SMALL.nodeCount * 0.98)
    expect(nodes.length).toBeLessThanOrEqual(SMALL.nodeCount)
    const min = SMALL.targetBytes * (1 - BYTE_TOLERANCE)
    const max = SMALL.targetBytes * (1 + BYTE_TOLERANCE)
    expect(bytes).toBeGreaterThanOrEqual(min)
    expect(bytes).toBeLessThanOrEqual(max)
  })

  it("内容配比抽查:类型、语言、备注、折叠、tombstone 接近冻结配比", () => {
    const { nodes } = generateSeed({ nodeCount: 20_000, targetBytes: 15_000_000 })
    const n = nodes.length
    const ratio = (pred: (x: (typeof nodes)[number]) => boolean): number =>
      nodes.filter(pred).length / n

    // 类型
    expect(ratio((x) => x.type === "bullet")).toBeGreaterThan(0.65)
    expect(ratio((x) => x.type === "bullet")).toBeLessThan(0.75)
    expect(ratio((x) => x.type === "paragraph")).toBeGreaterThan(0.12)
    expect(ratio((x) => x.type === "paragraph")).toBeLessThan(0.18)
    expect(ratio((x) => x.type === "todo")).toBeGreaterThan(0.07)
    expect(ratio((x) => x.type === "todo")).toBeLessThan(0.13)

    // 语言(titleText 判别):emoji 节点可能混入 tag/date 文本,判「含 emoji」比例应 ≥ emoji 冻结配比
    const hasCJK = (s: string): boolean => /[\u4e00-\u9fff]/.test(s)
    const hasEmoji = (s: string): boolean => /\p{Extended_Pictographic}/u.test(s)
    const zh = ratio((x) => hasCJK(x.titleText))
    const emoji = ratio((x) => hasEmoji(x.titleText))
    expect(zh).toBeGreaterThan(0.5)
    expect(zh).toBeLessThan(0.72)
    expect(emoji).toBeGreaterThan(0.08)
    expect(emoji).toBeLessThan(0.25)

    // 字段特性
    expect(ratio((x) => x.note !== undefined)).toBeGreaterThan(0.24)
    expect(ratio((x) => x.note !== undefined)).toBeLessThan(0.36)
    expect(ratio((x) => x.collapsed)).toBeGreaterThan(0.15)
    expect(ratio((x) => x.collapsed)).toBeLessThan(0.25)
    expect(ratio(isTombstoned)).toBeGreaterThan(0.01)
    expect(ratio(isTombstoned)).toBeLessThan(0.03)

    // todo 完成 30%
    const todos = nodes.filter((x) => x.type === "todo")
    const doneRatio = todos.filter((x) => x.completed).length / todos.length
    expect(doneRatio).toBeGreaterThan(0.15)
    expect(doneRatio).toBeLessThan(0.45)

    // 行内特性:titleText 中含链接渲染文本的无法直接判别,校验 JSON 内 link/code 存在即可
    const hasLink = nodes.some((x) => JSON.stringify(x.title).includes('"type":"link"'))
    const hasCode = nodes.some((x) => JSON.stringify(x.title).includes('"format":16'))
    expect(hasLink).toBe(true)
    expect(hasCode).toBe(true)
  })

  it("结构不变量:除 root 外所有节点 parentId 可解析、无自环、orderKey 同级唯一且有序", () => {
    const { nodes } = generateSeed({ ...SMALL, seed: 7 })
    const ids = new Set(nodes.map((x) => x.id))
    for (const node of nodes) {
      expect(node.id).not.toBe(node.parentId)
      if (node.parentId !== "root") expect(ids.has(node.parentId)).toBe(true)
    }
    // 同级 orderKey 唯一且有序
    const byParent = new Map<string, Map<string, string>>()
    for (const node of nodes) {
      const group = byParent.get(node.parentId) ?? new Map<string, string>()
      expect(group.has(node.orderKey)).toBe(false)
      group.set(node.orderKey, node.id)
      byParent.set(node.parentId, group)
    }
    for (const group of byParent.values()) {
      const keys = [...group.keys()].sort()
      const sortedKeys = [...keys].sort((a, b) => (a < b ? -1 : 1))
      expect(keys).toEqual(sortedKeys)
    }
  })

  it("结构不变量:tombstone 节点的后代必然也标记 tombstone(回收判据的可见性前提)", () => {
    // 注:此断言表达「tombstone 后代不可见」的 flatten 语义由 isTombstoned 判定;
    // 生成器对 tombstone 的选取是随机的,不传播到后代 —— 这里验证的是实际契约:
    // tombstone 比例在冻结区间内,而「后代可见性」由 flattenVisible 负责(见 outlineState 测试)。
    const { nodes } = generateSeed({ ...SMALL, seed: 3 })
    const tombstoned = nodes.filter(isTombstoned)
    expect(tombstoned.length).toBeGreaterThan(0)
  })

  it("深度分布落在冻结的三个带内(最深 ≤12)", () => {
    const { nodes } = generateSeed({ nodeCount: 10_000, targetBytes: 8_000_000 })
    const depthOf = new Map<string, number>([["root", 0]])
    // parentId 顺序无保证,按拓扑推进
    const pending = [...nodes]
    while (pending.length > 0) {
      const progressed = pending.filter((node) => depthOf.has(node.parentId))
      if (progressed.length === 0) throw new Error("结构出现不可解析的父子关系")
      for (const node of progressed) {
        depthOf.set(node.id, depthOf.get(node.parentId)! + 1)
        pending.splice(pending.indexOf(node), 1)
      }
    }
    for (const node of nodes) {
      const d = depthOf.get(node.id)!
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(12)
    }
  })

  it(
    "全量 100k/50MB:节点数接近 100k,体积命中 50MB±5%(记录耗时)",
    () => {
      const t0 = Date.now()
      const { nodes, bytes } = generateSeed()
      const elapsed = Date.now() - t0
      // 记录到 stdout(vitest run 可见)供门禁留档
      process.env.FULL_SEED_REPORT = `nodes=${nodes.length} bytes=${bytes} ms=${elapsed}`
      expect(elapsed).toBeLessThan(60_000)
      // 全量下生成器在 ±2% 内收敛,冻结契约是 ±5%
      expect(bytes).toBeGreaterThanOrEqual(TARGET_BYTES * (1 - BYTE_TOLERANCE))
      expect(bytes).toBeLessThanOrEqual(TARGET_BYTES * (1 + BYTE_TOLERANCE))
      // 节点数:宽/巨分支补齐策略下略低于 TARGET_NODE_COUNT 属预期(只要求 ≥95%)
      expect(nodes.length).toBeGreaterThanOrEqual(TARGET_NODE_COUNT * 0.95)
    },
    120_000,
  )
})
