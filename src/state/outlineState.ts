import { Effect } from "effect"
import { Atom } from "effect/unstable/reactivity"

import type { NodeRecord } from "../domain/nodeRecord"
import { isTombstoned } from "../domain/nodeRecord"

/**
 * 大纲视图状态（原型范围）：
 * - 可视行扁平化（depth 展开，折叠跳过子树）；
 * - 懒加载可视窗口（架构 §8：只有首屏和虚拟窗口邻近节点进主线程缓存）；
 * - 活动编辑节点（全应用唯一 Lexical 实例挂在哪一行、哪个字段）；
 * - 展开的备注（同一时刻至多一行）。
 *
 * Focus/面包屑的完整语义归后续切片；原型用扁平树视图展示可视行。
 */

export interface VisibleRow {
  readonly id: string
  readonly depth: number
}

/** 大纲根节点 id（§6.1：根不是持久化行，只作为 parentId 的起点）。 */
export const ROOT_NODE_ID = "root"

/** 展开整棵可见树：跳过折叠节点的子树与 tombstone。 */
export const flattenVisible = (
  childrenOf: ReadonlyMap<string, ReadonlyArray<NodeRecord>>,
  rootId = ROOT_NODE_ID,
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

/** 首屏真实行是否已就绪：false 时 rows 为空渲染加载占位（非可编辑）。 */
export const startupReadyAtom = Atom.make(false)

/**
 * 可视窗口的 DFS 游标帧：按 `flattenVisible` 顺序继续枚举时需要记住
 * 「哪个父节点的子节点列表消费到第几个」。
 */
interface VisibleFrame {
  readonly parentId: string
  readonly depth: number
  readonly children: ReadonlyArray<NodeRecord>
  next: number
}

/**
 * 可视窗口状态（行表 + 已加载节点 + 继续枚举的游标）。
 *
 * 关键约束：**永不整体读取 nodes 表**。实测 100k/50MB 一次全表读
 * （原生 IndexedDB `openKeyCursor` 也需 ~95s 冷启动，热读仅 ~2s）是旧
 * `reload ≈110s` 的根源；架构 §8 也只允许首屏与邻近节点进主线程缓存。
 */
export interface VisibleWindowState {
  readonly rows: ReadonlyArray<VisibleRow>
  readonly nodes: ReadonlyMap<string, NodeRecord>
  readonly frames: ReadonlyArray<VisibleFrame>
  readonly rootLoaded: boolean
}

export const emptyVisibleWindow = (): VisibleWindowState => ({
  rows: [],
  nodes: new Map(),
  frames: [],
  rootLoaded: false,
})

/** 可见树已枚举完（继续扩展只会得到空行）。 */
export const visibleWindowExhausted = (state: VisibleWindowState): boolean =>
  state.rootLoaded && state.frames.length === 0

/**
 * 把可见行扩展到至少 `targetRows` 行（或整棵可见树枚举完）。
 * 枚举顺序与 `flattenVisible` 一致（orderKey 升序、跳过折叠子树与 tombstone），
 * 因此结果永远是全量行表的**前缀**：可分次调用，不重复、不遗漏。
 * `loadChildren` 注入数据读取（数据层职责），本函数保持无 IO，便于单测。
 */
export const extendVisibleWindow = <E>(
  state: VisibleWindowState,
  loadChildren: (parentId: string) => Effect.Effect<ReadonlyArray<NodeRecord>, E>,
  targetRows: number,
): Effect.Effect<VisibleWindowState, E> =>
  Effect.gen(function* () {
    const rows = [...state.rows]
    const nodes = new Map(state.nodes)
    const frames = state.frames.map((frame) => ({ ...frame }))
    let rootLoaded = state.rootLoaded

    while (rows.length < targetRows) {
      const top = frames[frames.length - 1]
      if (top === undefined) {
        if (rootLoaded) break // 可见树到底
        const children = yield* loadChildren(ROOT_NODE_ID)
        rootLoaded = true
        if (children.length > 0) {
          frames.push({ parentId: ROOT_NODE_ID, depth: 0, children, next: 0 })
        }
        continue
      }
      if (top.next >= top.children.length) {
        frames.pop()
        continue
      }
      const child = top.children[top.next]!
      top.next += 1
      if (isTombstoned(child)) continue
      rows.push({ id: child.id, depth: top.depth })
      nodes.set(child.id, child)
      if (!child.collapsed) {
        const children = yield* loadChildren(child.id)
        if (children.length > 0) {
          frames.push({ parentId: child.id, depth: top.depth + 1, children, next: 0 })
        }
      }
    }

    return { rows, nodes, frames, rootLoaded }
  })

/** 可视窗口（唯一事实来源）；行表与内存节点表由它派生。 */
export const visibleWindowAtom = Atom.make<VisibleWindowState>({
  rows: [],
  nodes: new Map(),
  frames: [],
  rootLoaded: false,
})

/** 内存节点表：只有已加载的可视窗口节点（补丁乐观更新）。 */
export const nodesAtom: Atom.Atom<ReadonlyMap<string, NodeRecord>> = Atom.map(
  visibleWindowAtom,
  (state: VisibleWindowState) => state.nodes,
)

/** 行表：已枚举的可视行（全量行表的前缀）。 */
export const outlineRowsAtom: Atom.Atom<ReadonlyArray<VisibleRow>> = Atom.map(
  visibleWindowAtom,
  (state: VisibleWindowState) => state.rows,
)

/**
 * 首个可编辑真实行：titleText 超过此长度的行视为 seed 体积校准产物/病态内容
 * （100k/50MB fixture 校准节点序列化 ~11.6MB，激活会触发分钟级主线程阻塞——
 * e2e/README.md 坑 2），不作为首屏默认光标行。
 */
export const DEFAULT_EDIT_TITLE_TEXT_LIMIT = 10_000

/**
 * 首屏默认光标行（架构 §8 步骤 4：渲染首屏并挂载活动编辑器）：
 * 首个体量正常的可见行；全部超限时退回首行，保证入口仍来自真实数据。
 */
export const firstEditableRowId = (
  rows: ReadonlyArray<VisibleRow>,
  nodes: ReadonlyMap<string, NodeRecord>,
): string | null => {
  for (const row of rows) {
    const node = nodes.get(row.id)
    if (node && node.titleText.length <= DEFAULT_EDIT_TITLE_TEXT_LIMIT) return row.id
  }
  return rows[0]?.id ?? null
}
