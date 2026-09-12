import { describe, expect, it } from "vitest"
import { Effect } from "effect"

import type { NodeRecord } from "../domain/nodeRecord"
import {
  buildChildrenIndex,
  emptyVisibleWindow,
  extendVisibleWindow,
  flattenVisible,
  firstEditableRowId,
  visibleWindowExhausted,
} from "./outlineState"

/**
 * 可视行派生契约(架构 §14.3:折叠跳过子树、tombstone 不可见)。
 */

const node = (id: string, parentId: string, orderKey: string, o: Partial<NodeRecord> = {}): NodeRecord => ({
  id,
  parentId,
  orderKey,
  type: "bullet",
  title: { root: { type: "root", version: 1, children: [] } },
  titleText: id,
  completed: false,
  collapsed: false,
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  ...o,
})

describe("flattenVisible / buildChildrenIndex", () => {
  it("按 orderKey 排序同级,深度正确", () => {
    const nodes = [
      node("b", "root", "b"),
      node("a", "root", "a"),
      node("a1", "a", "a0"),
    ]
    const childrenOf = buildChildrenIndex(nodes)
    const rows = flattenVisible(childrenOf)
    expect(rows.map((r) => `${r.id}:${r.depth}`)).toEqual(["a:0", "a1:1", "b:0"])
  })

  it("折叠节点跳过整棵子树(数据仍在,只是不可见)", () => {
    const nodes = [
      node("a", "root", "a", { collapsed: true }),
      node("a1", "a", "a0"),
      node("a1b", "a1", "a0z"),
      node("b", "root", "b"),
    ]
    const childrenOf = buildChildrenIndex(nodes)
    const rows = flattenVisible(childrenOf)
    expect(rows.map((r) => r.id)).toEqual(["a", "b"])
  })

  it("tombstone 不可见(包括子树入口本身)", () => {
    const nodes = [
      node("a", "root", "a", { tombstonedAt: 1 }),
      node("a1", "a", "a0"),
      node("b", "root", "b"),
    ]
    const childrenOf = buildChildrenIndex(nodes)
    const rows = flattenVisible(childrenOf)
    expect(rows.map((r) => r.id)).toEqual(["b"])
  })
})

/** 用内存节点集合充当数据层（loadChildren），验证游标扩展的纯语义。 */
const childrenLoader = (nodes: ReadonlyArray<NodeRecord>) => {
  const index = buildChildrenIndex(nodes)
  let calls = 0
  const loader = (parentId: string) => {
    calls++
    return Effect.succeed<ReadonlyArray<NodeRecord>>(index.get(parentId) ?? [])
  }
  return { loader, calls: () => calls }
}

describe("extendVisibleWindow（懒加载可视窗口，架构 §8）", () => {
  it("分次扩展永远等于全量行表的前缀（不重复、不遗漏）", async () => {
    const nodes = [
      node("a", "root", "a"),
      node("a1", "a", "a0"),
      node("a2", "a", "a1"),
      node("b", "root", "b"),
      node("b1", "b", "b0"),
      node("c", "root", "c"),
    ]
    const { loader } = childrenLoader(nodes)
    const full = flattenVisible(buildChildrenIndex(nodes))

    let state = emptyVisibleWindow()
    for (const target of [1, 2, 4, 6, 100]) {
      state = await Effect.runPromise(extendVisibleWindow(state, loader, target))
      expect(state.rows).toEqual(full.slice(0, state.rows.length))
    }
    expect(state.rows).toEqual(full)
    expect(visibleWindowExhausted(state)).toBe(true)
  })

  it("只读触及可视窗口所需的父节点（不全表取数）", async () => {
    const nodes = [
      node("a", "root", "a", { collapsed: true }),
      node("b", "root", "b"),
      node("b1", "b", "b0"),
      node("hidden", "a", "a0"),
    ]
    const { loader, calls } = childrenLoader(nodes)
    // 窗口只需 2 行：只要一次 root 查询 + 一次 b 的子查询；a 折叠不查子节点
    const state = await Effect.runPromise(extendVisibleWindow(emptyVisibleWindow(), loader, 2))
    expect(state.rows.map((r) => r.id)).toEqual(["a", "b"])
    expect(calls()).toBe(2)
    // 折叠子树与窗口外的节点都没进内存表
    expect(state.nodes.has("hidden")).toBe(false)
    expect(state.nodes.has("b1")).toBe(false)
    expect(state.nodes.size).toBe(2)
  })

  it("默认光标行取首个体量正常的真实行（避开 seed 校准巨型节点）", () => {
    const rows = [
      { id: "n0", depth: 0 },
      { id: "n1", depth: 0 },
    ]
    const nodes = new Map<string, NodeRecord>([
      ["n0", node("n0", "root", "a0", { titleText: "长".repeat(20_000) })],
      ["n1", node("n1", "root", "a1", { titleText: "会议纪要" })],
    ])
    expect(firstEditableRowId(rows, nodes)).toBe("n1")
    // 全部超限时退回真实首行（入口仍来自真实数据，非幽灵）
    nodes.set("n1", node("n1", "root", "a1", { titleText: "长".repeat(20_000) }))
    expect(firstEditableRowId(rows, nodes)).toBe("n0")
    expect(firstEditableRowId([], nodes)).toBeNull()
  })
})
