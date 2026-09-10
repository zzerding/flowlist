import { describe, expect, it } from "vitest"

import type { NodeRecord } from "../domain/nodeRecord"
import { buildChildrenIndex, flattenVisible } from "./outlineState"

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
