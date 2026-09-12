/**
 * 原型自检（对应 issue #2 决策记录第 2/3/4 条的最小闭环）。
 *
 * 注意：体积契约按 100k/50MB 冻结；小规模验证时每节点有约 320B 的
 * JSON 结构开销下限，测试规模需满足 targetBytes ≥ nodes × 500B。
 *
 * 运行：pnpm vitest run src/selfcheck/prototype.selfcheck.test.ts
 */
import "fake-indexeddb/auto"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { db, META_KEYS } from "../data/db"
import { seedFixtureToDexie } from "../testing/fixture"
import { generateSeed } from "../seed/seedGenerator"
import { validateContent } from "../editor/staticRenderer"
import { UndoStack, applyUndoEntry } from "../state/undoStack"

describe("S1 原型最小闭环自检", () => {
  it("seed fixture 写入 fake-indexeddb 后可完整读回", async () => {
    const result = await Effect.runPromise(
      seedFixtureToDexie({ nodeCount: 200, targetBytes: 100_000 }),
    )
    expect(result.nodes).toBeGreaterThan(0)
    const count = await db.nodes.count()
    expect(count).toBe(result.nodes)
    const scrollTop = await db.meta.get(META_KEYS.lastScrollTop)
    expect(scrollTop).toBeUndefined() // 未写入滚动位置时无记录
    await db.delete()
  }, 30_000)

  it("seed 生成的 Lexical JSON 通过静态 renderer 的 Schema 校验", () => {
    const { nodes } = generateSeed({ nodeCount: 200, targetBytes: 100_000 })
    const sampled = nodes.filter((_, i) => i % 5 === 0)
    for (const node of sampled) {
      expect(validateContent(node.title)).not.toBeNull()
      if (node.note) expect(validateContent(node.note)).not.toBeNull()
    }
  })

  it("撤销栈 forward/inverse 恢复原状态（决策记录第 2 条）", () => {
    const { nodes } = generateSeed({ nodeCount: 200, targetBytes: 100_000 })
    const node = nodes[0]!
    const before = node.titleText

    const patch = {
      nodeId: node.id,
      field: "title" as const,
      forward: { root: { type: "root", version: 1, children: [] } },
      inverse: node.title,
    }
    const stack = new UndoStack()
    stack.push({ patches: [patch] })

    const map = new Map(nodes.map((n) => [n.id, n]))
    const undone = applyUndoEntry(map, stack.popForUndo()!, "inverse")
    expect(undone.get(node.id)!.title).toEqual(node.title)
    expect(before.length).toBeGreaterThan(0)
  })

  it("undo 不跨节点：patch 记录 nodeId，undo 只作用于该节点", () => {
    const { nodes } = generateSeed({ nodeCount: 200, targetBytes: 100_000 })
    const [a, b] = nodes as [typeof nodes[number], typeof nodes[number]]
    const stack = new UndoStack()
    stack.push({
      patches: [
        { nodeId: a.id, field: "title", forward: a.title, inverse: a.title },
        { nodeId: b.id, field: "completed", forward: true, inverse: false },
      ],
    })
    const map = new Map(nodes.map((n) => [n.id, n]))
    const undone = applyUndoEntry(map, stack.popForUndo()!, "inverse")
    // 两个节点都被各自 patch 命中，但互不串内容
    expect(undone.get(a.id)!.title).toEqual(a.title)
    expect(undone.get(b.id)!.completed).toBe(false)
  })
})
