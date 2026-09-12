import fc from "fast-check"
import { describe, expect, it } from "vitest"

import type { NodeRecord } from "../domain/nodeRecord"
import { UndoStack, applyUndoEntry, type NodePatch } from "./undoStack"

/**
 * 撤销栈契约测试(接缝 1,issue #2 决策记录第 2 条):
 * - forward/inverse patch 往返:apply(inverse) 后 apply(forward) = 最新状态,反之亦然;
 * - patch 携带 nodeId:undo 严格作用于目标节点,不串节点;
 * - push 截断重做分支;cursor 语义与 canUndo/canRedo 一致。
 */

type FieldType = NodePatch["field"]

const makeNode = (id: string): NodeRecord => ({
  id,
  parentId: "root",
  orderKey: id,
  type: "bullet",
  title: { root: { type: "root", version: 1, children: [] } },
  titleText: `text-of-${id}`,
  completed: false,
  collapsed: false,
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
})

/** 用 fast-check 生成任意 patch(值只是不透明负载,往返不依赖其形状)。 */
const patchArb = fc
  .record({
    nodeId: fc.constantFrom("a", "b", "c"),
    field: fc.constantFrom<FieldType>("completed", "collapsed"),
    forward: fc.integer(),
  })
  .map(
    (p): NodePatch => ({
      nodeId: p.nodeId,
      field: p.field,
      forward: p.forward,
      // inverse 绑定初始字段值(真实编辑语义:inverse = 编辑前的快照)
      inverse: false,
    }),
  )

describe("UndoStack 基本语义", () => {
  it("push 后 canUndo,undo 后 canRedo;redo 取回同一条", () => {
    const stack = new UndoStack()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
    stack.push({ patches: [makePatch("a", "title", 2, 1)] })
    expect(stack.canUndo).toBe(true)
    const undone = stack.popForUndo()
    expect(undone).not.toBeNull()
    expect(stack.canRedo).toBe(true)
    expect(stack.popForRedo()).toEqual(undone)
    expect(stack.canRedo).toBe(false)
  })

  it("popForUndo 在空栈返回 null,canRedo 为 false 时 popForRedo 返回 null", () => {
    const stack = new UndoStack()
    expect(stack.popForUndo()).toBeNull()
    expect(stack.popForRedo()).toBeNull()
  })

  it("push 截断重做分支:undo 后 push 新 entry,旧重做不可达", () => {
    const stack = new UndoStack()
    stack.push({ patches: [makePatch("a", "title", 1, 0)] })
    stack.popForUndo() // 可 redo 第 1 条
    stack.push({ patches: [makePatch("a", "title", 3, 2)] }) // 截断
    expect(stack.canRedo).toBe(false)
    expect(stack.size).toBe(1)
    // 唯一可 undo 的是新 entry
    expect(stack.popForUndo()!.patches[0]!.forward).toBe(3)
  })

  it("clear 清空全部历史", () => {
    const stack = new UndoStack()
    stack.push({ patches: [] })
    stack.push({ patches: [] })
    stack.clear()
    expect(stack.size).toBe(0)
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
  })

  it("不限 100 步(决策记录第 2 条:原型不设上限)", () => {
    const stack = new UndoStack()
    for (let i = 0; i < 150; i++) {
      stack.push({ patches: [makePatch("a", "completed", i, i - 1)] })
    }
    expect(stack.size).toBe(150)
    let undos = 0
    while (stack.popForUndo() !== null) undos++
    expect(undos).toBe(150)
  })
})

function makePatch(
  nodeId: string,
  field: FieldType,
  forward: unknown,
  inverse: unknown,
): NodePatch {
  return { nodeId, field, forward, inverse }
}

describe("applyUndoEntry", () => {
  it("inverse 恢复原值,再 forward 回到新值(往返不变量)", () => {
    const node = makeNode("a")
    const nodes = new Map([["a", node]])
    const entry = { patches: [makePatch("a", "completed", true, false)] }
    const undone = applyUndoEntry(nodes, entry, "inverse")
    expect(undone.get("a")!.completed).toBe(false)
    const redone = applyUndoEntry(undone, entry, "forward")
    expect(redone.get("a")!.completed).toBe(true)
  })

  it("undo 不串节点:entry 内每个 patch 只作用于自己的 nodeId", () => {
    const a = makeNode("a")
    const b = makeNode("b")
    const nodes = new Map([
      ["a", a],
      ["b", b],
    ])
    const entry = {
      patches: [
        makePatch("a", "completed", true, false),
        makePatch("b", "collapsed", true, false),
      ],
    }
    const undone = applyUndoEntry(nodes, entry, "inverse")
    expect(undone.get("a")!.completed).toBe(false)
    expect(undone.get("b")!.collapsed).toBe(false)
    // b 的 completed 未被 a 的 patch 波及
    expect(undone.get("b")!.completed).toBe(b.completed)
    // title 内容互不污染
    expect(undone.get("a")!.titleText).toBe(a.titleText)
    expect(undone.get("b")!.titleText).toBe(b.titleText)
  })

  it("patch 目标节点不存在时不抛错、不影响其他节点", () => {
    const a = makeNode("a")
    const nodes = new Map([["a", a]])
    const entry = { patches: [makePatch("missing", "title", 1, 0)] }
    const next = applyUndoEntry(nodes, entry, "inverse")
    expect(next.get("a")).toBe(a)
    expect(next.has("missing")).toBe(false)
  })

  it("应用 entry 使 revision 递增(updatedAt 刷新)", () => {
    const node = makeNode("a")
    const nodes = new Map([["a", node]])
    const entry = { patches: [makePatch("a", "completed", true, false)] }
    const next = applyUndoEntry(nodes, entry, "forward")
    expect(next.get("a")!.revision).toBe(node.revision + 1)
    expect(next.get("a")!.updatedAt).toBeGreaterThanOrEqual(node.updatedAt)
  })

  it("applyUndoEntry 返回新 Map,不改入参(纯函数)", () => {
    const node = makeNode("a")
    const nodes = new Map([["a", node]])
    const entry = { patches: [makePatch("a", "completed", true, false)] }
    const next = applyUndoEntry(nodes, entry, "forward")
    expect(next).not.toBe(nodes)
    expect(nodes.get("a")!.completed).toBe(false)
    expect(next.get("a")!.completed).toBe(true)
  })
})

describe("fast-check:随机编辑 + 切换序列下的撤销不变量", () => {
  it("任意 patch 序列:apply forward 后逐条 undo(inverse) 回到初始状态", () => {
    // inverse 绑定初值:completed/collapsed 初值均为 false,undo 后必回到 false
    const run = (entries: Array<{ patches: NodePatch[] }>): void => {
      const initial = new Map([
        ["a", makeNode("a")],
        ["b", makeNode("b")],
        ["c", makeNode("c")],
      ])
      const stack = new UndoStack()
      let state = initial
      for (const entry of entries) {
        stack.push(entry)
        state = applyUndoEntry(state, entry, "forward")
      }
      // 逐条 undo
      let undone: ReturnType<typeof stack.popForUndo>
      while ((undone = stack.popForUndo()) !== null) {
        state = applyUndoEntry(state, undone!, "inverse")
      }
      // 回到初始:所有字段等于初值
      for (const [id, node] of initial) {
        const final = state.get(id)!
        expect(final.completed).toBe(node.completed)
        expect(final.collapsed).toBe(node.collapsed)
        expect(final.titleText).toBe(node.titleText)
        expect(final.title).toEqual(node.title)
      }
    }
    fc.assert(
      fc.property(
        fc.array(fc.array(patchArb, { maxLength: 5 }), { maxLength: 30 }),
        (entries) => run(entries.map((patches) => ({ patches }))),
      ),
      { numRuns: 200 },
    )
  })

  it("切换节点后 undo 不作用于错误节点:undo 序列恢复的节点 = 各 entry patch 的 nodeId,值 = 该 patch 的 inverse", () => {
    // 模拟「编辑 a → 切到 b → 编辑 b → undo」的序列:
    // undo 必须先恢复 b(栈顶),再 undo 恢复 a —— 严格按提交顺序回放,
    // 且每个 patch 只命中自己的 nodeId(其余节点字段保持不变)。
    const boolPatchArb = fc
      .record({
        nodeId: fc.constantFrom("a", "b"),
        field: fc.constantFrom<FieldType>("completed", "collapsed"),
      })
      .map(
        (p): NodePatch => ({
          nodeId: p.nodeId,
          field: p.field,
          forward: true,
          inverse: false,
        }),
      )
    fc.assert(
      fc.property(
        fc.array(fc.array(boolPatchArb, { minLength: 1, maxLength: 6 }), { maxLength: 20 }),
        (groups) => {
          const initial = new Map([
            ["a", makeNode("a")],
            ["b", makeNode("b")],
          ])
          const stack = new UndoStack()
          let state = initial
          for (const patches of groups) {
            const entry = { patches }
            stack.push(entry)
            state = applyUndoEntry(state, entry, "forward")
          }
          // 依次 undo:每步被恢复的字段值必须等于该 patch 的 inverse,其他节点不受影响
          let undone: ReturnType<typeof stack.popForUndo>
          while ((undone = stack.popForUndo()) !== null) {
            const before = state
            state = applyUndoEntry(undone === null ? state : state, undone!, "inverse")
            for (const patch of undone!.patches) {
              expect(state.get(patch.nodeId)![patch.field as "completed" | "collapsed"]).toBe(
                patch.inverse,
              )
              // 不在本 entry 内的节点不受影响(不串节点)
              const entryIds = new Set(undone!.patches.map((p) => p.nodeId))
              for (const [id, node] of before) {
                if (entryIds.has(id)) continue
                expect(state.get(id)![patch.field as "completed" | "collapsed"]).toBe(
                  node[patch.field as "completed" | "collapsed"],
                )
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
