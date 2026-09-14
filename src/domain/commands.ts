import { Effect } from "effect"

import type { LexicalContent, NodeRecord, NodeType } from "./nodeRecord"
import { lexicalToText } from "./nodeRecord"
import { ValidationError, validateCommand } from "./invariants"

// 校验逻辑（不变量判定、ValidationError、isDescendant）已迁至 invariants.ts，
// 此处 re-export 保持既有导入路径可用。
export { ValidationError, isDescendant } from "./invariants"

/**
 * 大纲命令与执行器（架构 §6.1/§9）。
 *
 * - 纯函数层：不触达 Worker / UI，`now` 由调用方注入，不调用 `Date.now()`；
 * - 一条命令产出字段级 forward/inverse patch（与 S1 `NodePatch` 形状兼容），
 *   保证 `apply(papply(nodes, cmd, now), inverseCmd, now)` 深比较等于原 nodes；
 * - `createdAt` / `updatedAt` / `revision` 不进 patch，由执行器在应用 patch 后
 *   统一推进（变更节点 `updatedAt = now`、`revision + 1`）。
 */

/** 字段级补丁：forward 是命令的前进效果，inverse 是撤销时的反向效果。 */
export interface NodePatch {
  readonly nodeId: string
  readonly field: string
  readonly forward: unknown
  readonly inverse: unknown
}

/** 大纲命令判别联合：id 由调用方生成后随命令携带，执行器不生成 id。 */
export type Command =
  | { readonly _tag: "Add"; readonly id: string; readonly parentId: string; readonly orderKey: string; readonly type: NodeType; readonly title: LexicalContent; readonly note?: LexicalContent }
  | { readonly _tag: "Edit"; readonly id: string; readonly title?: LexicalContent; readonly note?: LexicalContent; readonly type?: NodeType }
  | { readonly _tag: "Move"; readonly id: string; readonly newParentId: string; readonly newOrderKey: string }
  | { readonly _tag: "Delete"; readonly id: string }
  | { readonly _tag: "Complete"; readonly id: string; readonly completed: boolean }
  | { readonly _tag: "Collapse"; readonly id: string; readonly collapsed: boolean }

export interface CommandResult {
  readonly nextNodes: ReadonlyMap<string, NodeRecord>
  readonly patches: ReadonlyArray<NodePatch>
}

/**
 * 命令执行上下文。
 *
 * `siblings`：可选的同级组 orderKey 索引（parentId → 该父下已占 orderKey 集合）。
 * 传入则 orderKey 冲突检查 O(1)；不传则 validateCommand 回退线性扫整表 O(n)。
 * #4 Worker 层必须维护并传入该索引，以守住「局部校验 O(受影响范围)」约束。
 */
export interface CommandContext {
  readonly now: number
  readonly siblings?: ReadonlyMap<string, ReadonlySet<string>>
}

/** 把字段级 patch 应用到节点表，并统一推进变更节点的 `updatedAt`/`revision`。 */
const applyPatches = (
  nodes: ReadonlyMap<string, NodeRecord>,
  patches: ReadonlyArray<NodePatch>,
  now: number,
): ReadonlyMap<string, NodeRecord> => {
  const next = new Map(nodes)
  const touched = new Set<string>()
  for (const patch of patches) {
    const node = next.get(patch.nodeId)
    if (!node) continue
    next.set(patch.nodeId, { ...node, [patch.field]: patch.forward })
    touched.add(patch.nodeId)
  }
  for (const id of touched) {
    const node = next.get(id)
    if (!node) continue
    next.set(id, { ...node, updatedAt: now, revision: node.revision + 1 })
  }
  return next
}

/** Lexical JSON 相等判定：子集内结构可用深度相等比较（事实源是 JSON，不是 HTML）。 */
const contentEquals = (a: LexicalContent, b: LexicalContent | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export const executeCommand = (
  nodes: ReadonlyMap<string, NodeRecord>,
  command: Command,
  ctx: CommandContext,
): Effect.Effect<CommandResult, ValidationError> =>
  Effect.gen(function* () {
    // 先按不变量校验命令（§9），失败路径与 kind 见 invariants.ts；本函数只产出 patch。
    yield* validateCommand(nodes, command, ctx.siblings)
    switch (command._tag) {
      case "Add": {
        const record: NodeRecord = {
          id: command.id,
          parentId: command.parentId,
          orderKey: command.orderKey,
          type: command.type,
          title: command.title,
          ...(command.note ? { note: command.note } : {}),
          titleText: lexicalToText(command.title),
          ...(command.note ? { noteText: lexicalToText(command.note) } : {}),
          completed: false,
          collapsed: false,
          revision: 0,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        }
        const patch: NodePatch = {
          nodeId: command.id,
          field: "node",
          forward: record,
          inverse: null,
        }
        const next = new Map(nodes)
        next.set(command.id, record)
        return { nextNodes: next, patches: [patch] }
      }
      case "Edit": {
        const node = nodes.get(command.id)!
        if (command.title === undefined && command.note === undefined && command.type === undefined) {
          return { nextNodes: nodes, patches: [] }
        }
        const patches: Array<NodePatch> = []
        if (command.type !== undefined && command.type !== node.type) {
          patches.push({ nodeId: node.id, field: "type", forward: command.type, inverse: node.type })
        }
        if (command.title !== undefined && !contentEquals(command.title, node.title)) {
          const nextTitleText = lexicalToText(command.title)
          patches.push({ nodeId: node.id, field: "title", forward: command.title, inverse: node.title })
          if (nextTitleText !== node.titleText) {
            patches.push({ nodeId: node.id, field: "titleText", forward: nextTitleText, inverse: node.titleText })
          }
        }
        if (command.note !== undefined && !contentEquals(command.note, node.note)) {
          const nextNoteText = lexicalToText(command.note)
          const inverseNote = node.note
          patches.push({ nodeId: node.id, field: "note", forward: command.note, inverse: inverseNote })
          const inverseNoteText = inverseNote === undefined ? undefined : node.noteText
          if (nextNoteText !== node.noteText) {
            patches.push({ nodeId: node.id, field: "noteText", forward: nextNoteText, inverse: inverseNoteText })
          }
        }
        if (patches.length === 0) return { nextNodes: nodes, patches: [] }
        return { nextNodes: applyPatches(nodes, patches, ctx.now), patches }
      }
      case "Move": {
        const node = nodes.get(command.id)!
        // 子树移动只改根节点的两个字段，后代零写入（§6.1/§9）。
        const patches: Array<NodePatch> = []
        if (command.newParentId !== node.parentId) {
          patches.push({ nodeId: node.id, field: "parentId", forward: command.newParentId, inverse: node.parentId })
        }
        if (command.newOrderKey !== node.orderKey) {
          patches.push({ nodeId: node.id, field: "orderKey", forward: command.newOrderKey, inverse: node.orderKey })
        }
        if (patches.length === 0) return { nextNodes: nodes, patches: [] }
        return { nextNodes: applyPatches(nodes, patches, ctx.now), patches }
      }
      case "Delete": {
        const node = nodes.get(command.id)!
        // 子树删除只写根节点的 tombstonedAt，后代不动（§9.3）。
        const patch: NodePatch = {
          nodeId: node.id,
          field: "tombstonedAt",
          forward: ctx.now,
          inverse: undefined,
        }
        return { nextNodes: applyPatches(nodes, [patch], ctx.now), patches: [patch] }
      }
      case "Complete": {
        const node = nodes.get(command.id)!
        if (command.completed === node.completed) return { nextNodes: nodes, patches: [] }
        const patch: NodePatch = {
          nodeId: node.id,
          field: "completed",
          forward: command.completed,
          inverse: node.completed,
        }
        return { nextNodes: applyPatches(nodes, [patch], ctx.now), patches: [patch] }
      }
      case "Collapse": {
        const node = nodes.get(command.id)!
        if (command.collapsed === node.collapsed) return { nextNodes: nodes, patches: [] }
        const patch: NodePatch = {
          nodeId: node.id,
          field: "collapsed",
          forward: command.collapsed,
          inverse: node.collapsed,
        }
        return { nextNodes: applyPatches(nodes, [patch], ctx.now), patches: [patch] }
      }
    }
  })
