import fc from "fast-check"
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"

import type { NodeRecord } from "./nodeRecord"
import type { Command } from "./commands"
import { isDescendant, validateOutline, validateCommand, visibleNodes } from "./invariants"

/** 把 validateOutline 的 Effect 结果归约为「是否失败」boolean。 */
const outlineFails = (nodes: ReadonlyMap<string, NodeRecord>): boolean =>
  Exit.isFailure(Effect.runSyncExit(validateOutline(nodes)))

/**
 * invariants 契约测试（接缝 1）：
 * - validateOutline：合法树恒通过；环 / 父缺失 / orderKey 重复各对应 kind；
 * - validateCommand：与 executeCommand 失败路径对齐；siblings 索引与线性扫结果一致；
 * - visibleNodes：DFS orderKey 序、tombstone 整枝隐藏、起点非法返回空；
 * - isDescendant：祖先/后代/无关节点/深层链。
 */

const ROOT = "root"

let counter = 0

const makeNode = (
  id: string,
  parentId: string,
  orderKey: string,
  opts: { tombstone?: boolean; completed?: boolean; collapsed?: boolean } = {},
): NodeRecord => {
  counter++
  return {
    id,
    parentId,
    orderKey,
    type: "bullet",
    title: {
      root: {
        type: "root",
        version: 1,
        children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: `t${counter}` }] }],
      },
    },
    titleText: `t${counter}`,
    completed: opts.completed ?? false,
    collapsed: opts.collapsed ?? false,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    ...(opts.tombstone ? { tombstonedAt: 123 } : {}),
  }
}

/** 构造一棵固定形状的合法树：root 下 a,b；a 下 a1,a2；a1 下 deep。b 是 tombstone（带一个活子 b1）。 */
const makeFixedTree = (): Map<string, NodeRecord> => {
  const entries: NodeRecord[] = [
    makeNode("a", ROOT, "a"),
    makeNode("b", ROOT, "b", { tombstone: true }),
    makeNode("a1", "a", "a1"),
    makeNode("a2", "a", "a2"),
    makeNode("b1", "b", "b1"),
    makeNode("deep", "a1", "d1"),
  ]
  return new Map(entries.map((n) => [n.id, n]))
}

describe("validateOutline", () => {
  it("固定合法树（含 tombstone 与 3 层嵌套）通过", () => {
    expect(outlineFails(makeFixedTree())).toBe(false)
  })

  it("合法树 property：任意随机合法树恒通过（≥200 次）", () => {
    // 生成 parent 链合法的树：每个节点挂到「已生成的节点或 root」下，同父 orderKey 唯一
    const treeArb = fc.uniqueArray(fc.tuple(fc.nat(50), fc.boolean()), { maxLength: 15 }).map((seeds) => {
      const nodes = new Map<string, NodeRecord>()
      let i = 0
      for (const [parentIdIdx, tombstone] of seeds) {
        const id = `n${i}`
        i++
        const parentIds = [ROOT, ...Array.from(nodes.keys())]
        const parentId = parentIds[parentIdIdx % parentIds.length]!
        // 同父下 orderKey 唯一：追加序号保证
        const orderKey = `${parentId}/${id}`
        nodes.set(id, makeNode(id, parentId, orderKey, { tombstone }))
      }
      return nodes
    })
    fc.assert(
      fc.property(treeArb, (nodes) => {
        expect(outlineFails(nodes)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  it("环 property：随机选节点改父为其后代 → cycle（≥200 次）", () => {
    const base = makeFixedTree()
    const nodeIds = Array.from(base.keys())
    fc.assert(
      fc.property(fc.constantFrom(...nodeIds), fc.constantFrom(...nodeIds), (a, b) => {
        if (a === b) return
        const nodes = new Map(base)
        const mutated = { ...nodes.get(a)!, parentId: b }
        nodes.set(a, mutated)
        // 只有当 b 在 a 子树内时才是环；否则可能合法（换父）——用 validateOutline 判定是否报 cycle
        if (!isDescendant(base, a, b)) return
        expect(outlineFails(nodes)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it("直接环：两个节点互为父 → 不通过", () => {
    const nodes = makeFixedTree()
    const a = { ...nodes.get("a")!, parentId: "a1" }
    nodes.set("a", a)
    expect(outlineFails(nodes)).toBe(true)
  })

  it("父缺失：指向不存在的父 → 不通过", () => {
    const nodes = makeFixedTree()
    const a2 = { ...nodes.get("a2")!, parentId: "ghost" }
    nodes.set("a2", a2)
    expect(outlineFails(nodes)).toBe(true)
  })

  it("同父 orderKey 重复：复制 a1 的 orderKey 到 a2 → 不通过", () => {
    const nodes = makeFixedTree()
    const a2 = { ...nodes.get("a2")!, orderKey: "a1" }
    nodes.set("a2", a2)
    expect(outlineFails(nodes)).toBe(true)
  })

  it("orderKey 重复 property：随机同父对交换/复制 orderKey → 不通过（≥200 次）", () => {
    // 固定树中 (root: a,b) (a: a1,a2) 两组同父兄弟
    const base = makeFixedTree()
    fc.assert(
      fc.property(fc.constantFrom("a2", "b"), (dupId) => {
        const nodes = new Map(base)
        const dup = nodes.get(dupId)!
        const sourceId = dupId === "a2" ? "a1" : "a"
        const source = nodes.get(sourceId)!
        expect(dup.parentId).toBe(source.parentId) // 确认同父
        nodes.set(dupId, { ...dup, orderKey: source.orderKey })
        expect(outlineFails(nodes)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})

/** 把 validateCommand 的 Effect 结果归约为失败 kind（成功时返回 null）。 */
const failKind = (
  nodes: ReadonlyMap<string, NodeRecord>,
  command: Parameters<typeof validateCommand>[1],
  siblings?: ReadonlyMap<string, ReadonlySet<string>>,
): string | null => {
  const exit = Effect.runSyncExit(validateCommand(nodes, command, siblings))
  return Exit.match(exit, {
    onFailure: (cause) => {
      const raw = cause as unknown as { reasons?: Array<{ _tag: string; error?: { kind?: string } }> }
      const failure = raw.reasons?.find((f) => f._tag === "Fail")
      return failure?.error?.kind ?? null
    },
    onSuccess: () => null,
  })
}

// ---------------------------------------------------------------------------
// validateCommand
// ---------------------------------------------------------------------------

const TITLE = {
  root: {
    type: "root" as const,
    version: 1,
    children: [{ type: "paragraph" as const, version: 1, children: [{ type: "text" as const, version: 1, text: "x" }] }],
  },
}

describe("validateCommand", () => {
  it("Add：父缺失 → parentMissing（含 siblings 索引时同样报）", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const cmd = { _tag: "Add" as const, id: "n", parentId: "ghost", orderKey: "k1", type: "bullet" as const, title: TITLE }
    expect(failKind(nodes, cmd)).toBe("parentMissing")
    expect(failKind(nodes, cmd, new Map())).toBe("parentMissing")
  })

  it("Add：orderKey 冲突 → orderKeyConflict；siblings 索引下一致", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const cmd = { _tag: "Add" as const, id: "n", parentId: ROOT, orderKey: "k0", type: "bullet" as const, title: TITLE }
    expect(failKind(nodes, cmd)).toBe("orderKeyConflict")
    const siblings = new Map([[ROOT, new Set(["k0"])]])
    expect(failKind(nodes, cmd, siblings)).toBe("orderKeyConflict")
  })

  it("Edit：nodeMissing / tombstoneVisible", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0", { tombstone: true })]])
    expect(failKind(nodes, { _tag: "Edit", id: "zz", title: TITLE })).toBe("nodeMissing")
    expect(failKind(nodes, { _tag: "Edit", id: "a", title: TITLE })).toBe("tombstoneVisible")
  })

  it("Move：nodeMissing / tombstoneVisible / cycle / parentMissing / orderKeyConflict", () => {
    const nodes = new Map([
      ["p", makeNode("p", ROOT, "k0")],
      ["c", makeNode("c", "p", "k0")],
      ["b", makeNode("b", ROOT, "k1", { tombstone: true })],
      ["x", makeNode("x", ROOT, "k2")],
    ])
    expect(failKind(nodes, { _tag: "Move", id: "zz", newParentId: ROOT, newOrderKey: "k9" })).toBe("nodeMissing")
    expect(failKind(nodes, { _tag: "Move", id: "b", newParentId: ROOT, newOrderKey: "k9" })).toBe("tombstoneVisible")
    expect(failKind(nodes, { _tag: "Move", id: "p", newParentId: "c", newOrderKey: "k9" })).toBe("parentIsDescendant")
    expect(failKind(nodes, { _tag: "Move", id: "p", newParentId: "ghost", newOrderKey: "k9" })).toBe("parentMissing")
    expect(failKind(nodes, { _tag: "Move", id: "p", newParentId: ROOT, newOrderKey: "k2" })).toBe("orderKeyConflict")
  })

  it("Move：目标位就是自己当前 (parentId, orderKey) → selfSlot 不误报（通过）", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0")]])
    const cmd = { _tag: "Move" as const, id: "a", newParentId: ROOT, newOrderKey: "k0" }
    const withIdx = failKind(nodes, cmd, new Map([[ROOT, new Set(["k0"])]]))
    const noIdx = failKind(nodes, cmd)
    expect(withIdx).toBeNull()
    expect(noIdx).toBeNull()
  })

  it("Delete：nodeMissing / 二次删除 → tombstoneVisible", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0", { tombstone: true })]])
    expect(failKind(nodes, { _tag: "Delete", id: "zz" })).toBe("nodeMissing")
    expect(failKind(nodes, { _tag: "Delete", id: "a" })).toBe("tombstoneVisible")
  })

  it("Complete / Collapse：nodeMissing / tombstoneVisible", () => {
    const nodes = new Map([["a", makeNode("a", ROOT, "k0", { tombstone: true })]])
    expect(failKind(nodes, { _tag: "Complete", id: "zz", completed: true })).toBe("nodeMissing")
    expect(failKind(nodes, { _tag: "Complete", id: "a", completed: true })).toBe("tombstoneVisible")
    expect(failKind(nodes, { _tag: "Collapse", id: "zz", collapsed: true })).toBe("nodeMissing")
    expect(failKind(nodes, { _tag: "Collapse", id: "a", collapsed: true })).toBe("tombstoneVisible")
  })

  it("property：任意合法命令，siblings 索引传入 vs 不传结果一致（≥200 次）", () => {
    // 在固定树上执行随机合法命令，两种校验路径结果必须一致（成功/失败、失败 kind）
    const base = makeFixedTree()
    const nodeIds = Array.from(base.keys())
    const orderKeys = ["a", "b", "a1", "a2", "b1", "d1", "zz"]
    const commandArb = fc
      .record({
        tag: fc.constantFrom("Add", "Edit", "Move", "Delete", "Complete", "Collapse"),
        target: fc.constantFrom(...nodeIds),
        parentId: fc.constantFrom(ROOT, ...nodeIds),
        orderKey: fc.constantFrom(...orderKeys),
        boolean: fc.boolean(),
      })
      .map((r): Command => {
        switch (r.tag) {
          case "Add":
            return { _tag: "Add", id: "newid", parentId: r.parentId, orderKey: r.orderKey, type: "bullet", title: TITLE }
          case "Edit":
            return { _tag: "Edit", id: r.target, title: TITLE }
          case "Move":
            return { _tag: "Move", id: r.target, newParentId: r.parentId, newOrderKey: r.orderKey }
          case "Delete":
            return { _tag: "Delete", id: r.target }
          case "Complete":
            return { _tag: "Complete", id: r.target, completed: r.boolean }
          default:
            return { _tag: "Collapse", id: r.target, collapsed: r.boolean }
        }
      })
    // 从树中提取 siblings 索引
    const siblings = new Map<string, Set<string>>()
    for (const node of base.values()) {
      const set = siblings.get(node.parentId) ?? new Set()
      set.add(node.orderKey)
      siblings.set(node.parentId, set)
    }
    fc.assert(
      fc.property(commandArb, (command) => {
        const withIdx = failKind(base, command, siblings)
        const noIdx = failKind(base, command)
        expect(withIdx).toBe(noIdx)
      }),
      { numRuns: 200 },
    )
  })
})

// ---------------------------------------------------------------------------
// visibleNodes
// ---------------------------------------------------------------------------

describe("visibleNodes", () => {
  it("DFS 按 orderKey 字符串序遍历，父先于子", () => {
    const nodes = new Map([
      ["a", makeNode("a", ROOT, "a")],
      ["a1", makeNode("a1", "a", "a1")],
      ["deep", makeNode("deep", "a1", "d")],
      ["a2", makeNode("a2", "a", "a2")],
      ["b", makeNode("b", ROOT, "b")],
    ])
    const ids = Array.from(visibleNodes(nodes).map((n) => n.id))
    expect(ids).toEqual(["a", "a1", "deep", "a2", "b"])
  })

  it("tombstone 整枝隐藏：后代不出现，但记录仍在表内", () => {
    const nodes = makeFixedTree() // b 为 tombstone，b1 是其子
    const ids = Array.from(visibleNodes(nodes).map((n) => n.id))
    expect(ids).not.toContain("b")
    expect(ids).not.toContain("b1") // 整枝隐藏
    expect(nodes.has("b1")).toBe(true) // 表内仍在
    expect(ids).toContain("a")
    expect(ids).toContain("deep")
  })

  it("startId 为 tombstone 节点 → 返回空", () => {
    const nodes = makeFixedTree()
    expect(visibleNodes(nodes, "b")).toEqual([])
  })

  it("startId 不存在 → 返回空", () => {
    const nodes = makeFixedTree()
    expect(visibleNodes(nodes, "ghost")).toEqual([])
  })

  it("startId 指定父节点：返回其子树（DFS 序，不含 startId 自身——startId 是父视角）", () => {
    const nodes = makeFixedTree()
    const ids = Array.from(visibleNodes(nodes, "a").map((n) => n.id))
    expect(ids).toEqual(["a1", "deep", "a2"])
  })

  it("嵌套多级（≥3 层）完整展开", () => {
    const nodes = new Map([
      ["l1", makeNode("l1", ROOT, "a")],
      ["l2", makeNode("l2", "l1", "b")],
      ["l3", makeNode("l3", "l2", "c")],
      ["l4", makeNode("l4", "l3", "d")],
    ])
    const ids = Array.from(visibleNodes(nodes).map((n) => n.id))
    expect(ids).toEqual(["l1", "l2", "l3", "l4"])
  })
})

// ---------------------------------------------------------------------------
// isDescendant
// ---------------------------------------------------------------------------

describe("isDescendant", () => {
  it("直接子 → true", () => {
    expect(isDescendant(makeFixedTree(), "a", "a1")).toBe(true)
  })
  it("深层后代（3 层链）→ true", () => {
    expect(isDescendant(makeFixedTree(), "a", "deep")).toBe(true)
  })
  it("祖先不是后代 → false（不含自身）", () => {
    expect(isDescendant(makeFixedTree(), "a1", "a")).toBe(false)
  })
  it("无关节点 → false", () => {
    expect(isDescendant(makeFixedTree(), "a", "b")).toBe(false)
  })
  it("自身 → false", () => {
    expect(isDescendant(makeFixedTree(), "a", "a")).toBe(false)
  })
  it("不存在的节点 → false", () => {
    expect(isDescendant(makeFixedTree(), "a", "ghost")).toBe(false)
  })
})
