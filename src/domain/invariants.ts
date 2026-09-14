import { Data, Effect } from "effect"

import type { NodeRecord } from "./nodeRecord"
import { isTombstoned } from "./nodeRecord"
import type { Command } from "./commands"

/** 虚拟根节点 id（§6.1：根不是持久化行，只作为 parentId 的起点；与 state 层 ROOT_NODE_ID 同值）。 */
const ROOT_NODE_ID = "root"

/**
 * 大纲不变量与命令校验（架构 §6.3/§9、ADR-0001）。
 *
 * - `validateOutline`：全量状态校验，O(n)，仅测试与导入校验复用，运行时热路径禁用；
 * - `validateCommand`：命令级局部校验，O(受影响范围)——祖先链深度 + 同级组大小；
 * - `visibleNodes`：可见性派生（tombstone 分支整枝隐藏，§9.3）。
 *
 * 四不变量（issue #3）：
 * 1. 无环——每个节点沿 parentId 上行最终到达虚拟根，不会回到自身；
 * 2. 父唯一——parentId 指向存在的节点或虚拟根 `"root"`；
 * 3. 同一父下 orderKey 唯一——字符串全序下互异即严格有序；
 * 4. tombstone 后代不可见——tombstone 节点的后代存在但被视图隐藏是合法状态；
 *    非法的是命令试图操作 tombstone 节点（`tombstoneVisible`，见 validateCommand）。
 */

/** 命令校验失败（架构 §9：命令先验证不变量再产生补丁）。 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly kind:
    | "cycle"
    | "parentMissing"
    | "parentIsDescendant"
    | "orderKeyConflict"
    | "tombstoneVisible"
    | "malformedContent"
    | "nodeMissing"
  readonly detail: string
}> {}

const fail = (kind: ValidationError["kind"], detail: string) =>
  Effect.fail(new ValidationError({ kind, detail }))

/** 全量校验：O(n)。仅测试与导入校验复用（架构 §6.3），运行时热路径禁用。 */
export const validateOutline: (
  nodes: ReadonlyMap<string, NodeRecord>,
) => Effect.Effect<void, ValidationError> = (nodes) =>
  Effect.gen(function* () {
    // 不变量 2（父唯一）：parentId 指向存在的节点或虚拟根。
    for (const node of nodes.values()) {
      if (node.parentId !== ROOT_NODE_ID && !nodes.has(node.parentId)) {
        return yield* fail(
          "parentMissing",
          `validateOutline: 节点 ${node.id} 的父不存在: ${node.parentId}`,
        )
      }
    }
    // 不变量 1（无环）：沿父链上行必达虚拟根。记忆化上行，整体 O(n)。
    const reachesRoot = new Set<string>()
    for (const node of nodes.values()) {
      if (reachesRoot.has(node.id)) continue
      const path: string[] = []
      const onPath = new Set<string>()
      let currentId = node.id
      let ok = false
      while (!ok) {
        if (reachesRoot.has(currentId)) {
          ok = true
          break
        }
        if (onPath.has(currentId)) break // 回到路径中的节点 → 环
        const current = nodes.get(currentId)
        if (!current) break // 父缺失已由上一轮报告，防御性终止
        path.push(currentId)
        onPath.add(currentId)
        if (current.parentId === ROOT_NODE_ID) {
          ok = true
          break
        }
        currentId = current.parentId
      }
      if (!ok) {
        return yield* fail("cycle", `validateOutline: 节点 ${node.id} 沿父链回到自身（存在环）`)
      }
      for (const id of path) reachesRoot.add(id)
    }
    // 不变量 3（orderKey 唯一）：同一父下互不相同（字符串全序下互异即严格有序）。
    const seen = new Map<string, Set<string>>()
    for (const node of nodes.values()) {
      let keys = seen.get(node.parentId)
      if (!keys) {
        keys = new Set()
        seen.set(node.parentId, keys)
      }
      if (keys.has(node.orderKey)) {
        return yield* fail(
          "orderKeyConflict",
          `validateOutline: orderKey 冲突: ${node.parentId}/${node.orderKey}`,
        )
      }
      keys.add(node.orderKey)
    }
  })

/**
 * 判断 `maybeDescendantId` 是否为 `ancestorId` 的后代（不含自身）。
 * 沿父链上行，耗时即祖先链深度；调用方须保证表内无环（validateOutline 职责）。
 */
export const isDescendant = (
  nodes: ReadonlyMap<string, NodeRecord>,
  ancestorId: string,
  maybeDescendantId: string,
): boolean => {
  let current = nodes.get(maybeDescendantId)
  while (current) {
    if (current.parentId === ancestorId) return true
    current = nodes.get(current.parentId)
  }
  return false
}

/**
 * 同一父节点下 orderKey 冲突判定。
 *
 * - 传 `siblings` 索引（parentId → 该父下已占 orderKey 集合）：O(1) 查询；
 * - 不传：线性扫整表 O(n)——仅测试/低频路径可用，#4 Worker 层必须传索引。
 */
const orderKeyTaken = (
  nodes: ReadonlyMap<string, NodeRecord>,
  parentId: string,
  orderKey: string,
  excludeId: string,
  siblings?: ReadonlyMap<string, ReadonlySet<string>>,
): boolean => {
  if (siblings) return siblings.get(parentId)?.has(orderKey) ?? false
  for (const node of nodes.values()) {
    if (node.parentId === parentId && node.orderKey === orderKey && node.id !== excludeId) {
      return true
    }
  }
  return false
}

/**
 * 局部校验：O(受影响范围)——祖先链深度 + 同级组大小，不扫描整棵树。
 * `executeCommand` 执行前调用；失败 kind 与触发条件同切片 1。
 *
 * `siblings` 为可选预构建索引（parentId → 该父下已占 orderKey 集合）：
 * 传入则 orderKey 冲突检查 O(1)；不传则回退线性扫并退化为 O(n)，
 * 调用方（#4 Worker 层）必须传索引以守住复杂度约束。
 */
export const validateCommand: (
  nodes: ReadonlyMap<string, NodeRecord>,
  command: Command,
  siblings?: ReadonlyMap<string, ReadonlySet<string>>,
) => Effect.Effect<void, ValidationError> = (nodes, command, siblings) =>
  Effect.gen(function* () {
    switch (command._tag) {
      case "Add": {
        // Add 的父节点可以是虚拟根（不在 nodes 表中）。
        if (command.parentId !== ROOT_NODE_ID && !nodes.has(command.parentId)) {
          return yield* fail("parentMissing", `Add: 父节点不存在: ${command.parentId}`)
        }
        if (orderKeyTaken(nodes, command.parentId, command.orderKey, command.id, siblings)) {
          return yield* fail(
            "orderKeyConflict",
            `Add: orderKey 冲突: ${command.parentId}/${command.orderKey}`,
          )
        }
        return
      }
      case "Edit": {
        const node = nodes.get(command.id)
        if (!node) return yield* fail("nodeMissing", `Edit: 节点不存在: ${command.id}`)
        if (isTombstoned(node)) {
          return yield* fail("tombstoneVisible", `Edit: 节点已删除: ${command.id}`)
        }
        return
      }
      case "Move": {
        const node = nodes.get(command.id)
        if (!node) return yield* fail("nodeMissing", `Move: 节点不存在: ${command.id}`)
        if (isTombstoned(node)) {
          return yield* fail("tombstoneVisible", `Move: 节点已删除: ${command.id}`)
        }
        // 目标父可以是虚拟根；实体父必须存在，且不能是自身或自身后代（防环）。
        if (command.newParentId !== ROOT_NODE_ID) {
          if (!nodes.has(command.newParentId)) {
            return yield* fail("parentMissing", `Move: 目标父节点不存在: ${command.newParentId}`)
          }
          if (command.newParentId === command.id || isDescendant(nodes, command.id, command.newParentId)) {
            return yield* fail(
              // 目标父是自身后代：与「父链回到自身」不同——目标父存在且拓扑合法，
              // 只是移动会制造环；二者 kind 区分（§16 ValidationError 清单）。
              command.newParentId === command.id ? "cycle" : "parentIsDescendant",
              `Move: 目标父 ${command.newParentId} 是节点 ${command.id} 自身或其后代`,
            )
          }
        }
        // 目标 (parentId, orderKey) 恰为节点当前占位时：线性路径经 excludeId 排除自身，
        // 索引路径无法区分持有者，直接视为不冲突（同父 orderKey 唯一由 validateOutline 保证）。
        const selfSlot =
          node.parentId === command.newParentId && node.orderKey === command.newOrderKey
        const taken = orderKeyTaken(
          nodes,
          command.newParentId,
          command.newOrderKey,
          command.id,
          siblings,
        )
        if (taken && !(siblings && selfSlot)) {
          return yield* fail(
            "orderKeyConflict",
            `Move: orderKey 冲突: ${command.newParentId}/${command.newOrderKey}`,
          )
        }
        return
      }
      case "Delete": {
        const node = nodes.get(command.id)
        if (!node) return yield* fail("nodeMissing", `Delete: 节点不存在: ${command.id}`)
        if (isTombstoned(node)) {
          return yield* fail("tombstoneVisible", `Delete: 节点已删除: ${command.id}`)
        }
        return
      }
      case "Complete": {
        const node = nodes.get(command.id)
        if (!node) return yield* fail("nodeMissing", `Complete: 节点不存在: ${command.id}`)
        if (isTombstoned(node)) {
          return yield* fail("tombstoneVisible", `Complete: 节点已删除: ${command.id}`)
        }
        return
      }
      case "Collapse": {
        const node = nodes.get(command.id)
        if (!node) return yield* fail("nodeMissing", `Collapse: 节点不存在: ${command.id}`)
        if (isTombstoned(node)) {
          return yield* fail("tombstoneVisible", `Collapse: 节点已删除: ${command.id}`)
        }
        return
      }
    }
  })

/**
 * 可见性派生（§9.3）：从 `startId`（默认虚拟根）出发返回可见后代节点，
 * 跳过 tombstone 分支（其后代存在但整枝隐藏）。结果按同级 orderKey 的
 * 字符串比较序深度优先排列。`startId` 本身不含在结果中；tombstoned 或
 * 不存在的 `startId` 返回空。
 */
export const visibleNodes = (
  nodes: ReadonlyMap<string, NodeRecord>,
  startId: string = ROOT_NODE_ID,
): ReadonlyArray<NodeRecord> => {
  const childrenOf = new Map<string, NodeRecord[]>()
  for (const node of nodes.values()) {
    const group = childrenOf.get(node.parentId)
    if (group) group.push(node)
    else childrenOf.set(node.parentId, [node])
  }
  const byOrderKey = (a: NodeRecord, b: NodeRecord): number =>
    a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0

  const result: NodeRecord[] = []
  const visit = (parentId: string): void => {
    const children = childrenOf.get(parentId)
    if (!children) return
    for (const child of [...children].sort(byOrderKey)) {
      if (isTombstoned(child)) continue
      result.push(child)
      visit(child.id)
    }
  }
  if (startId !== ROOT_NODE_ID) {
    const start = nodes.get(startId)
    if (!start || isTombstoned(start)) return result
  }
  visit(startId)
  return result
}
