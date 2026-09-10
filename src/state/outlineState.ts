import { Atom } from "effect/unstable/reactivity"

import type { NodeRecord } from "../domain/nodeRecord"
import { isTombstoned } from "../domain/nodeRecord"

/**
 * 大纲视图状态（原型范围）：
 * - 可视行扁平化（depth 展开，折叠跳过子树）；
 * - 活动编辑节点（全应用唯一 Lexical 实例挂在哪一行、哪个字段）；
 * - 展开的备注（同一时刻至多一行）。
 *
 * Focus/面包屑的完整语义归后续切片；原型用扁平树视图展示全部可见行。
 */

export interface VisibleRow {
  readonly id: string
  readonly depth: number
}

/** 展开整棵可见树：跳过折叠节点的子树与 tombstone。 */
export const flattenVisible = (
  childrenOf: ReadonlyMap<string, ReadonlyArray<NodeRecord>>,
  rootId = "root",
): Array<VisibleRow> => {
  const out: Array<VisibleRow> = []
  const walk = (parentId: string, depth: number): void => {
    const children = childrenOf.get(parentId) ?? []
    for (const child of children) {
      if (isTombstoned(child)) continue
      out.push({ id: child.id, depth })
      if (!child.collapsed) walk(child.id, depth + 1)
    }
  }
  walk(rootId, 0)
  return out
}

/** 由节点数组构建 childrenOf 索引（同级已按 orderKey 排序）。 */
export const buildChildrenIndex = (
  nodes: ReadonlyArray<NodeRecord>,
): Map<string, Array<NodeRecord>> => {
  const childrenOf = new Map<string, Array<NodeRecord>>()
  for (const node of nodes) {
    if (node.parentId === "__tombstone__") continue
    const group = childrenOf.get(node.parentId) ?? []
    group.push(node)
    childrenOf.set(node.parentId, group)
  }
  for (const group of childrenOf.values()) {
    group.sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
  }
  return childrenOf
}

/** 活动编辑目标：field = title 或 note。 */
export interface ActiveEdit {
  readonly nodeId: string
  readonly field: "title" | "note"
}

export const activeEditAtom = Atom.make<ActiveEdit | null>(null)

/** 展开中的备注（至多一行，同 ActiveEdit.field === "note" 联动）。 */
export const expandedNoteAtom = Atom.make<string | null>(null)

/** 内存节点表（启动时从 Dexie 加载，补丁乐观更新）。 */
export const nodesAtom = Atom.make<ReadonlyMap<string, NodeRecord>>(new Map())

/** 可视行派生：由 nodesAtom 展开。 */
export const visibleRowsAtom = Atom.make((get): Array<VisibleRow> => {
  const nodes = get(nodesAtom)
  const childrenOf = buildChildrenIndex([...nodes.values()])
  return flattenVisible(childrenOf)
})