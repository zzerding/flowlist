import { Effect, Exit } from "effect"
import fc from "fast-check"
import { describe, expect, it } from "vitest"

import type { Command, CommandResult, NodePatch } from "./commands"
import { executeCommand } from "./commands"
import { validateOutline } from "./invariants"
import type { LexicalContent, NodeRecord, NodeType } from "./nodeRecord"
import { lexicalToText, LexicalContentError } from "./nodeRecord"

/**
 * 命令执行器契约测试（issue #3 切片 3）：
 * - command + inverse = 原状态（property，1000 runs）；
 * - 时间契约：变更节点 updatedAt = ctx.now、时间字段不进 patch；
 * - Move 只写根节点的两个字段，后代零写入；
 * - Delete 只写根的 tombstonedAt，后代不动；
 * - 每条命令至少一条成功 + 一条失败用例。
 */

const ROOT = "root"
const NODE_TYPES: NodeType[] = [
  "bullet",
  "h1",
  "h2",
  "h3",
  "paragraph",
  "todo",
  "quote",
  "code",
  "divider",
]

const makeTitle = (text: string): LexicalContent => ({
  root: {
    type: "root",
    version: 1,
    children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text }] }],
  },
})

const makeNode = (id: string, parentId: string, orderKey: string, tombstoned = false): NodeRecord => ({
  id,
  parentId,
  orderKey,
  type: "bullet",
  title: makeTitle(`title-${id}`),
  titleText: `title-${id}`,
  completed: false,
  collapsed: false,
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  ...(tombstoned ? { tombstonedAt: 0 } : {}),
})

const runOk = (nodes: ReadonlyMap<string, NodeRecord>, command: Command, now: number): CommandResult =>
  Effect.runSync(Effect.orDie(executeCommand(nodes, command, { now })))

const runFailKind = (nodes: ReadonlyMap<string, NodeRecord>, command: Command, now: number): string =>
  Exit.match(Effect.runSyncExit(executeCommand(nodes, command, { now })), {
    // Effect 4 rc.112：失败原因在 cause.reasons 中（_tag === "Fail" 的 reason 携带 error）
    onFailure: (cause) => {
      const raw = cause as unknown as { reasons?: Array<{ _tag: string; error?: { kind?: string } }> }
      const failure = raw.reasons?.find((f) => f._tag === "Fail")
      const kind = failure?.error?.kind
      if (kind === undefined) throw new Error(`预期 ValidationError 失败，实际 cause: ${JSON.stringify(cause)}`)
      return kind
    },
    onSuccess: () => {
      throw new Error(`预期命令失败，实际成功: ${JSON.stringify(command)}`)
    },
  })

/** 用 patches 的 inverse 值回放，撤销一次 executeCommand 的效果（Add 的 inverse = null → 删除节点）。 */
const applyInverse = (
  nodes: ReadonlyMap<string, NodeRecord>,
  patches: ReadonlyArray<NodePatch>,
): ReadonlyMap<string, NodeRecord> => {
  const next = new Map(nodes)
  for (const patch of patches) {
    const node = next.get(patch.nodeId)
    if (!node) continue
    if (patch.field === "node" && patch.inverse === null) {
      next.delete(patch.nodeId)
      continue
    }
    next.set(patch.nodeId, { ...node, [patch.field]: patch.inverse })
  }
  return next
}

/** 去掉执行器推进的时间字段：inverse 回放不推进时间/revision，这是契约允许的差异。 */
const stripTime = (nodes: ReadonlyMap<string, NodeRecord>): Map<string, NodeRecord> =>
  new Map(
    [...nodes].map(([id, n]) => {
      const c = { ...n }
      delete (c as Record<string, unknown>).updatedAt
      delete (c as Record<string, unknown>).revision
      delete (c as Record<string, unknown>).createdAt
      return [id, c] as const
    }),
  )

// ---------------------------------------------------------------------------
// 生成器：合法初始树（id 唯一、parentId 指向更早节点或 root、同父 orderKey 唯一、含 tombstone）
// ---------------------------------------------------------------------------

const treeArb = fc
  .uniqueArray(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => s !== ROOT && !s.startsWith("added-")),
      parentSlot: fc.nat(3),
      orderKey: fc.nat(999_999),
    }),
    { selector: (n) => n.id, minLength: 1, maxLength: 8 },
  )
  .map((specs) => {
    const nodes = new Map<string, NodeRecord>()
    for (const spec of specs) {
      const existing = [...nodes.values()]
      // parentSlot < n：挂到已有存活节点；否则挂 root。tombstone 节点不作为父。
      const liveParents = existing.filter((n) => n.tombstonedAt === undefined)
      const parentId = spec.parentSlot < liveParents.length ? liveParents[spec.parentSlot]!.id : ROOT
      const siblings = new Set(
        existing.filter((n) => n.parentId === parentId).map((n) => n.orderKey),
      )
      let orderKey = `k${spec.orderKey}`
      while (siblings.has(orderKey)) orderKey = `s${orderKey}`
      // 部分节点为 tombstone（parentSlot === 3 且 orderKey 为偶数）
      const tombstoned = spec.parentSlot === 3 && spec.orderKey % 2 === 0
      nodes.set(spec.id, makeNode(spec.id, parentId, orderKey, tombstoned))
    }
    return nodes
  })
  // 生成器自校验：产出的树必须通过全量校验（防止生成器本身坏了导致测试假绿）
  .filter((nodes) => Exit.isFailure(Effect.runSyncExit(Effect.flip(validateOutline(nodes)))))

/** 命令描述符：nodeIndex/argIndex 运行时对当前表内 id 取模解析（始终命中真实节点）。 */
const cmdSpecArb = fc.record({
  // 按任务要求加权：Add/Edit 多、Delete/Move 中、Complete/Collapse 少
  tag: fc.constantFrom("Add", "Edit", "Edit", "Move", "Move", "Delete", "Complete", "Collapse"),
  nodeIndex: fc.nat(7),
  argIndex: fc.nat(7),
  orderKey: fc.nat(9),
  typeIndex: fc.nat(NODE_TYPES.length - 1),
  text: fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s !== ""),
  flag: fc.boolean(),
})

/** 把命令描述符解析成具体 Command（索引在运行时对当前表内 id 取模解析）。 */
const buildCommand = (
  spec: { tag: string; orderKey: number; typeIndex: number; text: string; flag: boolean },
  target: string,
  argId: string,
  seqIndex: number,
): Command => {
  switch (spec.tag) {
    case "Add":
      return {
        _tag: "Add",
        id: `added-${seqIndex}`,
        parentId: argId,
        orderKey: `k${spec.orderKey}`,
        type: NODE_TYPES[spec.typeIndex]!,
        title: makeTitle(spec.text),
      }
    case "Edit":
      return { _tag: "Edit", id: target, title: makeTitle(spec.text) }
    case "Move":
      return { _tag: "Move", id: target, newParentId: argId, newOrderKey: `k${spec.orderKey}` }
    case "Delete":
      return { _tag: "Delete", id: target }
    case "Complete":
      return { _tag: "Complete", id: target, completed: spec.flag }
    default:
      return { _tag: "Collapse", id: target, collapsed: spec.flag }
  }
}

// ---------------------------------------------------------------------------
// 核心 property：command + inverse = 原状态
// ---------------------------------------------------------------------------

describe("executeCommand property: command + inverse = 原状态", () => {
  it("任意命令序列逐条执行，成功路径用 patches 的 inverse 回放后回到原状态（业务字段深比较）", () => {
    const prop = fc.property(
      treeArb,
      fc.array(cmdSpecArb, { maxLength: 12 }),
      fc.integer({ min: 0, max: 1000 }),
      (initialTree, seq, baseNow) => {
        const ids = [...initialTree.keys()]
        const pick = (i: number): string => ids[i % ids.length]!
        let nodes: ReadonlyMap<string, NodeRecord> = initialTree
        for (let i = 0; i < seq.length; i++) {
          const now = baseNow + i
          const spec = seq[i]!
          const target = pick(spec.nodeIndex)
          const argId = pick(spec.argIndex)
          const command = buildCommand(spec, target, argId, i)
          const before = nodes
          nodes = Exit.match(Effect.runSyncExit(executeCommand(nodes, command, { now })), {
            // 失败路径：状态保持不变（validateCommand 先行，这是 §9 契约）
            onFailure: () => before,
            onSuccess: ({ nextNodes, patches }) => {
              // 时间契约：变更节点 updatedAt === ctx.now（Add 的节点 createdAt 同理）
              const touchedIds = new Set(patches.map((p) => p.nodeId))
              for (const [id, node] of nextNodes) {
                if (touchedIds.has(id) && before.has(id)) {
                  expect(node.updatedAt).toBe(now)
                }
              }
              // 时间字段不进 patch（Add 的整记录 node patch 例外）
              for (const patch of patches) {
                if (patch.field !== "node") {
                  expect(["updatedAt", "revision", "createdAt"]).not.toContain(patch.field)
                }
              }
              // inverse 回放后业务字段回到执行前状态
              expect(stripTime(applyInverse(before, patches))).toEqual(stripTime(before))
              return nextNodes
            },
          })
        }
      },
    )
    fc.assert(prop, { numRuns: 1000, timeout: 60_000 })
  })
})

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

describe("Edit: malformedContent", () => {
  it("非法 LexicalContent → LexicalContentError（kind malformedContent 的等价 tag）", () => {
    const nodes = new Map<string, NodeRecord>([["a", makeNode("a", ROOT, "k0")]])
    const broken = { nope: true } as unknown as LexicalContent
    const command: Command = { _tag: "Edit", id: "a", title: broken }
    expect(() =>
      Effect.runSync(Effect.orDie(executeCommand(nodes, command, { now: 1 }))),
    ).toThrow()
    // 直接验证 lexicalToText 抛的是 LexicalContentError（而非裸 TypeError）
    expect(() => lexicalToText(broken)).toThrow(LexicalContentError)
  })
})

describe("Add", () => {
  it("成功：新节点入表、titleText 由 lexicalToText 派生、createdAt/updatedAt = now、revision = 0、tombstonedAt undefined", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const result = runOk(nodes, { _tag: "Add", id: "b", parentId: ROOT, orderKey: "k1", type: "todo", title: makeTitle("hello") }, 42)
    const added = result.nextNodes.get("b")!
    expect(added.titleText).toBe(lexicalToText(makeTitle("hello")))
    expect(added.createdAt).toBe(42)
    expect(added.updatedAt).toBe(42)
    expect(added.revision).toBe(0)
    expect(added.tombstonedAt).toBeUndefined()
    expect(added.completed).toBe(false)
    expect(added.collapsed).toBe(false)
    expect(result.nextNodes.get("a")).toBe(nodes.get("a"))
  })

  it("成功：inverse = null，回放删除新节点", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const result = runOk(nodes, { _tag: "Add", id: "b", parentId: ROOT, orderKey: "k1", type: "bullet", title: makeTitle("x") }, 1)
    expect(applyInverse(nodes, result.patches)).toEqual(nodes)
  })

  it("父节点不存在 → parentMissing", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    expect(runFailKind(nodes, { _tag: "Add", id: "b", parentId: "ghost", orderKey: "k1", type: "bullet", title: makeTitle("x") }, 1)).toBe("parentMissing")
  })

  it("同父 orderKey 冲突 → orderKeyConflict", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    expect(runFailKind(nodes, { _tag: "Add", id: "b", parentId: ROOT, orderKey: "k0", type: "bullet", title: makeTitle("x") }, 1)).toBe("orderKeyConflict")
  })
})

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

describe("Edit", () => {
  it("成功：title 更新且 titleText 由 lexicalToText 派生、updatedAt = now、revision +1", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const result = runOk(nodes, { _tag: "Edit", id: "a", title: makeTitle("new-title") }, 7)
    const node = result.nextNodes.get("a")!
    expect(node.titleText).toBe("new-title")
    expect(node.updatedAt).toBe(7)
    expect(node.revision).toBe(2)
  })

  it("成功：note 更新且 noteText 同理", () => {
    const withNote = { ...makeNode("a", ROOT, "k0"), note: makeTitle("old"), noteText: "old" }
    const nodes = new Map([["a", withNote]])
    const result = runOk(nodes, { _tag: "Edit", id: "a", note: makeTitle("fresh") }, 7)
    expect(result.nextNodes.get("a")!.noteText).toBe("fresh")
  })

  it("节点不存在 → nodeMissing", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    expect(runFailKind(nodes, { _tag: "Edit", id: "zz", title: makeTitle("x") }, 1)).toBe("nodeMissing")
  })

  it("tombstone 节点 → tombstoneVisible", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0", true)]])
    expect(runFailKind(nodes, { _tag: "Edit", id: "a", title: makeTitle("x") }, 1)).toBe("tombstoneVisible")
  })
})

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

describe("Move", () => {
  it("成功：只改根节点 parentId+orderKey，后代零写入（跨父移动，两个 patch）", () => {
    // 树：root → p（含子树 c → g）；root → o（空）；把 p 连子树移到 o 下
    const parent = makeNode("p", ROOT, "k0")
    const child = makeNode("c", "p", "k0")
    const grandchild = makeNode("g", "c", "k0")
    const other = makeNode("o", ROOT, "k1")
    const nodes = new Map([
      ["p", parent],
      ["c", child],
      ["g", grandchild],
      ["o", other],
    ])
    const result = runOk(nodes, { _tag: "Move", id: "p", newParentId: "o", newOrderKey: "k5" }, 9)
    const moved = result.nextNodes.get("p")!
    expect(moved.parentId).toBe("o")
    expect(moved.orderKey).toBe("k5")
    // 后代零写入：逐字段完全相同（不随根移动重写）
    expect(result.nextNodes.get("c")).toEqual(child)
    expect(result.nextNodes.get("c")!.parentId).toBe("p")
    expect(result.nextNodes.get("c")!.orderKey).toBe("k0")
    expect(result.nextNodes.get("g")).toEqual(grandchild)
    // 无关节点（目标父 o）不动
    expect(result.nextNodes.get("o")).toBe(other)
    // 恰好两个 patch，都落在根节点 p 上
    expect(result.patches.map((p) => [p.nodeId, p.field])).toEqual([
      ["p", "parentId"],
      ["p", "orderKey"],
    ])
  })

  it("同父改序：只写 orderKey 一个 patch，parentId 不产生冗余 patch", () => {
    // 树：root → p → c → g，另有无关节点 o
    const parent = makeNode("p", ROOT, "k0")
    const child = makeNode("c", "p", "k0")
    const grandchild = makeNode("g", "c", "k0")
    const other = makeNode("o", ROOT, "k1")
    const nodes = new Map([
      ["p", parent],
      ["c", child],
      ["g", grandchild],
      ["o", other],
    ])
    const result = runOk(nodes, { _tag: "Move", id: "p", newParentId: ROOT, newOrderKey: "k5" }, 9)
    const moved = result.nextNodes.get("p")!
    expect(moved.parentId).toBe(ROOT)
    expect(moved.orderKey).toBe("k5")
    // 后代零写入：逐字段完全相同
    expect(result.nextNodes.get("c")).toEqual(child)
    expect(result.nextNodes.get("c")!.parentId).toBe("p")
    expect(result.nextNodes.get("c")!.orderKey).toBe("k0")
    expect(result.nextNodes.get("g")).toEqual(grandchild)
    // 无关节点不动
    expect(result.nextNodes.get("o")).toBe(other)
    // 恰好一个 patch：目标父本就是 root，parentId 不变，只写 orderKey（字段级补丁不写冗余字段）
    expect(result.patches.map((p) => [p.nodeId, p.field])).toEqual([["p", "orderKey"]])
  })

  it("移入自己的后代 → parentIsDescendant", () => {
    const parent = makeNode("p", ROOT, "k0")
    const child = makeNode("c", "p", "k0")
    const nodes = new Map([
      ["p", parent],
      ["c", child],
    ])
    expect(runFailKind(nodes, { _tag: "Move", id: "p", newParentId: "c", newOrderKey: "k0" }, 1)).toBe("parentIsDescendant")
  })

  it("父节点不存在 → parentMissing", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    expect(runFailKind(nodes, { _tag: "Move", id: "a", newParentId: "ghost", newOrderKey: "k1" }, 1)).toBe("parentMissing")
  })

  it("目标 (parentId, orderKey) 被他人占用 → orderKeyConflict", () => {
    const a = makeNode("a", ROOT, "k0")
    const b = makeNode("b", ROOT, "k1")
    const nodes = new Map([
      ["a", a],
      ["b", b],
    ])
    expect(runFailKind(nodes, { _tag: "Move", id: "a", newParentId: ROOT, newOrderKey: "k1" }, 1)).toBe("orderKeyConflict")
  })

  it("selfSlot：Move 到自己的当前 (parentId, orderKey) 是 no-op（空 patches、原表返回）", () => {
    const a = makeNode("a", ROOT, "k0")
    const nodes = new Map([["a", a]])
    const result = runOk(nodes, { _tag: "Move", id: "a", newParentId: ROOT, newOrderKey: "k0" }, 5)
    expect(result.patches).toEqual([])
    expect(result.nextNodes).toBe(nodes)
  })

  it("节点不存在 → nodeMissing；tombstone 节点 → tombstoneVisible", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    expect(runFailKind(nodes, { _tag: "Move", id: "zz", newParentId: ROOT, newOrderKey: "k1" }, 1)).toBe("nodeMissing")
    const tomb = new Map([["a", makeNode("a", ROOT, "k0", true)]])
    expect(runFailKind(tomb, { _tag: "Move", id: "a", newParentId: ROOT, newOrderKey: "k1" }, 1)).toBe("tombstoneVisible")
  })
})

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("Delete", () => {
  it("成功：仅根写 tombstonedAt，后代不动；inverse 恢复", () => {
    const parent = makeNode("p", ROOT, "k0")
    const child = makeNode("c", "p", "k0")
    const nodes = new Map([
      ["p", parent],
      ["c", child],
    ])
    const result = runOk(nodes, { _tag: "Delete", id: "p" }, 11)
    expect(result.nextNodes.get("p")!.tombstonedAt).toBe(11)
    expect(result.nextNodes.get("c")).toBe(child) // 后代不动
    expect(applyInverse(nodes, result.patches)).toEqual(nodes)
  })

  it("二次删除失败：tombstone 节点 → tombstoneVisible", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const first = runOk(nodes, { _tag: "Delete", id: "a" }, 11)
    expect(runFailKind(first.nextNodes, { _tag: "Delete", id: "a" }, 12)).toBe("tombstoneVisible")
  })

  it("节点不存在 → nodeMissing", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    expect(runFailKind(nodes, { _tag: "Delete", id: "zz" }, 1)).toBe("nodeMissing")
  })
})

// ---------------------------------------------------------------------------
// Complete / Collapse
// ---------------------------------------------------------------------------

describe("Complete / Collapse", () => {
  it("Complete 成功翻转 completed；no-op（同值）返回空 patches + 原表", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const result = runOk(nodes, { _tag: "Complete", id: "a", completed: true }, 3)
    expect(result.nextNodes.get("a")!.completed).toBe(true)
    expect(result.patches).toEqual([{ nodeId: "a", field: "completed", forward: true, inverse: false }])
    const noop = runOk(result.nextNodes, { _tag: "Complete", id: "a", completed: true }, 4)
    expect(noop.patches).toEqual([])
    expect(noop.nextNodes).toBe(result.nextNodes)
  })

  it("Collapse 成功翻转 collapsed；no-op 返回空 patches", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const result = runOk(nodes, { _tag: "Collapse", id: "a", collapsed: true }, 3)
    expect(result.nextNodes.get("a")!.collapsed).toBe(true)
    const noop = runOk(result.nextNodes, { _tag: "Collapse", id: "a", collapsed: true }, 4)
    expect(noop.patches).toEqual([])
  })

  it("tombstone 节点 → tombstoneVisible；nodeMissing 同理", () => {
    const tomb = new Map([["a", makeNode("a", ROOT, "k0", true)]])
    expect(runFailKind(tomb, { _tag: "Complete", id: "a", completed: true }, 1)).toBe("tombstoneVisible")
    expect(runFailKind(tomb, { _tag: "Collapse", id: "a", collapsed: true }, 1)).toBe("tombstoneVisible")
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    expect(runFailKind(nodes, { _tag: "Complete", id: "zz", completed: true }, 1)).toBe("nodeMissing")
    expect(runFailKind(nodes, { _tag: "Collapse", id: "zz", collapsed: true }, 1)).toBe("nodeMissing")
  })
})
