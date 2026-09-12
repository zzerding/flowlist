import { Effect } from "effect"

import type { NodeRecord } from "../domain/nodeRecord"

/** 数据服务形状（避免直接引用 service class；UndoStack 只需要 patchNode）。 */
export interface NodePatcher {
  readonly patchNode: (
    id: string,
    fields: Partial<NodeRecord>,
    expectedRevision: number,
  ) => Effect.Effect<boolean, unknown>
}

/**
 * 简化应用撤销栈（决策记录第 2 条）：
 * - forward / inverse patch 对，不限 100 步（完整 100 步语义归 issue #3）；
 * - 切换节点时编辑器内补丁提交进此栈，Lexical 历史作废；
 * - 切换节点后 undo 不得作用于错误节点：undo 严格按提交顺序回放，且每个
 *   patch 记录 nodeId，undo 时恢复的目标节点唯一确定。
 */

/** 单字段前向/逆向补丁：保存命令提交前后的字段快照。 */
export interface NodePatch {
  readonly nodeId: string
  readonly field: "title" | "note" | "completed" | "collapsed" | "type"
  readonly forward: unknown
  readonly inverse: unknown
}

export interface UndoEntry {
  readonly patches: ReadonlyArray<NodePatch>
}

export class UndoStack {
  private readonly entries: UndoEntry[] = []
  private cursor = 0 // 指向下一个可撤销位置（栈顶之后）

  push(entry: UndoEntry): void {
    // 截断重做分支
    this.entries.length = this.cursor
    this.entries.push(entry)
    this.cursor = this.entries.length
  }

  get size(): number {
    return this.cursor
  }

  get canUndo(): boolean {
    return this.cursor > 0
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length
  }

  popForUndo(): UndoEntry | null {
    if (!this.canUndo) return null
    this.cursor--
    return this.entries[this.cursor] ?? null
  }

  popForRedo(): UndoEntry | null {
    if (!this.canRedo) return null
    const entry = this.entries[this.cursor] ?? null
    this.cursor++
    return entry
  }

  clear(): void {
    this.entries.length = 0
    this.cursor = 0
  }
}

/**
 * 把一条 undo entry 应用到内存节点表并生成 Dexie 写入（forward 或 inverse）。
 * 纯函数：不改 state.nodes 之外的东西，返回新 Map。
 */
export const applyUndoEntry = (
  nodes: ReadonlyMap<string, NodeRecord>,
  entry: UndoEntry,
  direction: "forward" | "inverse",
): Map<string, NodeRecord> => {
  const next = new Map(nodes)
  const fields = direction === "forward" ? "forward" : "inverse"
  for (const patch of entry.patches) {
    const node = next.get(patch.nodeId)
    if (!node) continue
    next.set(patch.nodeId, {
      ...node,
      [patch.field]: patch[fields],
      revision: node.revision + 1,
      updatedAt: Date.now(),
    } as NodeRecord)
  }
  return next
}

/** 将 undo entry 的补丁写入 Dexie（保存确认走 measure 埋点由调用方负责）。 */
export const persistUndoEntry = (
  store: NodePatcher,
  nodes: ReadonlyMap<string, NodeRecord>,
  entry: UndoEntry,
  direction: "forward" | "inverse",
): Effect.Effect<void, unknown> =>
  Effect.forEach(
    entry.patches,
    (patch) => {
      const node = nodes.get(patch.nodeId)
      if (!node) return Effect.succeed(null)
      const value = direction === "forward" ? patch.forward : patch.inverse
      return store.patchNode(patch.nodeId, { [patch.field]: value } as Partial<NodeRecord>, node.revision)
    },
    { discard: true },
  )

export const undoStack = new UndoStack()
