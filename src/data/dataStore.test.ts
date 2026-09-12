import "fake-indexeddb/auto"
import { Effect } from "effect"
import { beforeEach, describe, expect, it } from "vitest"

import { db, META_KEYS, SCHEMA_VERSION } from "./db"
import { DataStore, DataStoreLayer } from "./dataStore"
import type { NodeRecord } from "../domain/nodeRecord"
import { generateSeed } from "../seed/seedGenerator"
import {
  buildChildrenIndex,
  emptyVisibleWindow,
  extendVisibleWindow,
  flattenVisible,
  visibleWindowExhausted,
} from "../state/outlineState"

/**
 * 数据服务契约测试(接缝 2:Vitest + fake-indexeddb)。
 * DataStore 通过 Context.Tag 引用,测试里用 Layer 构建实例 —— 这是公开消费方式,
 * 不 mock 内部协作者。
 */

const makeStore = (): typeof DataStore.Service =>
  Effect.runSync(Effect.provide(DataStore, DataStoreLayer))

const makeNode = (id: string, overrides: Partial<NodeRecord> = {}): NodeRecord => ({
  id,
  parentId: "root",
  orderKey: id,
  type: "bullet",
  title: { root: { type: "root", version: 1, children: [] } },
  titleText: `t-${id}`,
  completed: false,
  collapsed: false,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

describe("DataStore(fake-indexeddb)", () => {
  beforeEach(async () => {
    // 每个 it 独立表状态(不 close 库 —— Dexie 单例 delete 后需重开)
    await db.nodes.clear()
    await db.meta.clear()
    await db.searchChunks.clear()
  })

  it("putNode / countAll / getAllVisibleNodes 往返", async () => {
    const store = makeStore()
    await Effect.runPromise(store.putNode(makeNode("n1")))
    await Effect.runPromise(store.putNode(makeNode("n2")))
    expect(await Effect.runPromise(store.countAll())).toBe(2)
    const all = await Effect.runPromise(store.getAllVisibleNodes())
    expect(all.map((n) => n.id).sort()).toEqual(["n1", "n2"])
  })

  it("getAllVisibleNodes 过滤 tombstone", async () => {
    const store = makeStore()
    await Effect.runPromise(store.putNode(makeNode("n1")))
    await Effect.runPromise(store.putNode(makeNode("n2", { tombstonedAt: 5 })))
    const visible = await Effect.runPromise(store.getAllVisibleNodes())
    expect(visible.map((n) => n.id)).toEqual(["n1"])
  })

  it("bulkPutNodes 批量写入后可完整读回(seed fixture 形态)", async () => {
    const store = makeStore()
    const { nodes } = generateSeed({ nodeCount: 200, targetBytes: 100_000 })
    await Effect.runPromise(store.bulkPutNodes(nodes))
    expect(await Effect.runPromise(store.countAll())).toBe(nodes.length)
    const all = await Effect.runPromise(store.getAllVisibleNodes())
    expect(all.length).toBeGreaterThan(nodes.length * 0.9) // tombstone ≈2% 被过滤
  })

  describe("getChildren / 懒加载可视窗口（架构 §8）", () => {
    const loadChildren = (store: typeof DataStore.Service) => (parentId: string) =>
      store.getChildren(parentId)

    it("getChildren 按 orderKey 升序返回子节点（不读全表）", async () => {
      const store = makeStore()
      await Effect.runPromise(store.putNode(makeNode("b", { orderKey: "b" })))
      await Effect.runPromise(store.putNode(makeNode("a", { orderKey: "a" })))
      await Effect.runPromise(store.putNode(makeNode("a1", { parentId: "a", orderKey: "a0" })))
      const children = await Effect.runPromise(store.getChildren("root"))
      expect(children.map((n) => n.id)).toEqual(["a", "b"])
      const underA = await Effect.runPromise(store.getChildren("a"))
      expect(underA.map((n) => n.id)).toEqual(["a1"])
    })

    it("分次扩展：行表始终是全量行表的前缀（语义等价、无重复无遗漏）", async () => {
      const store = makeStore()
      const { nodes } = generateSeed({ nodeCount: 400, targetBytes: 300_000 })
      await Effect.runPromise(store.bulkPutNodes(nodes))
      const fullRows = flattenVisible(buildChildrenIndex(nodes))

      let state = emptyVisibleWindow()
      const targets = [16, 64, 160]
      for (const target of targets) {
        state = await Effect.runPromise(
          extendVisibleWindow(state, loadChildren(store), target),
        )
        expect(state.rows.length).toBeGreaterThanOrEqual(Math.min(target, fullRows.length))
        // 前缀等价：与全量派生行表逐行一致（折叠/tombstone 规则相同）
        expect(state.rows).toEqual(fullRows.slice(0, state.rows.length))
      }
      // 已加载节点只覆盖窗口，不是全量
      expect(state.nodes.size).toBe(state.rows.length)
      expect(state.nodes.size).toBeLessThan(nodes.length)
    })

    it("折叠节点不展开子树（与 flattenVisible 一致）", async () => {
      const store = makeStore()
      await Effect.runPromise(store.putNode(makeNode("a", { collapsed: true })))
      await Effect.runPromise(store.putNode(makeNode("a1", { parentId: "a" })))
      await Effect.runPromise(store.putNode(makeNode("b")))
      const state = await Effect.runPromise(
        extendVisibleWindow(emptyVisibleWindow(), loadChildren(store), 16),
      )
      expect(state.rows.map((r) => r.id)).toEqual(["a", "b"]) // a1 不在（折叠子树）
    })

    it("tombstone 节点及其子树不进入可视窗口", async () => {
      const store = makeStore()
      await Effect.runPromise(store.putNode(makeNode("a", { tombstonedAt: 1 })))
      await Effect.runPromise(store.putNode(makeNode("a1", { parentId: "a" })))
      await Effect.runPromise(store.putNode(makeNode("b")))
      const state = await Effect.runPromise(
        extendVisibleWindow(emptyVisibleWindow(), loadChildren(store), 16),
      )
      expect(state.rows.map((r) => r.id)).toEqual(["b"])
    })

    it("树枚举完后 exhausted，继续扩展不重复取数", async () => {
      const store = makeStore()
      await Effect.runPromise(store.putNode(makeNode("a")))
      await Effect.runPromise(store.putNode(makeNode("b")))
      let state = await Effect.runPromise(
        extendVisibleWindow(emptyVisibleWindow(), loadChildren(store), 16),
      )
      expect(state.rows.map((r) => r.id)).toEqual(["a", "b"])
      expect(visibleWindowExhausted(state)).toBe(true)
      state = await Effect.runPromise(
        extendVisibleWindow(state, loadChildren(store), 64),
      )
      expect(state.rows.map((r) => r.id)).toEqual(["a", "b"])
    })
  })

  describe("patchNode 与 revision 乐观锁", () => {
    it("expectedRevision 匹配时写入成功并递增 revision", async () => {
      const store = makeStore()
      await Effect.runPromise(store.putNode(makeNode("n1", { revision: 3 })))
      const ok = await Effect.runPromise(
        store.patchNode("n1", { titleText: "updated" }, 3),
      )
      expect(ok).toBe(true)
      const node = await db.nodes.get("n1")
      expect(node!.titleText).toBe("updated")
      expect(node!.revision).toBe(4)
    })

    it("expectedRevision 不匹配时拒绝写入(返回 false,数据保持原样)", async () => {
      const store = makeStore()
      await Effect.runPromise(store.putNode(makeNode("n1", { revision: 3, titleText: "orig" })))
      const ok = await Effect.runPromise(
        store.patchNode("n1", { titleText: "stale-write" }, 2),
      )
      expect(ok).toBe(false)
      const node = await db.nodes.get("n1")
      expect(node!.titleText).toBe("orig")
      expect(node!.revision).toBe(3)
    })

    it("目标节点不存在时返回 false", async () => {
      const store = makeStore()
      const ok = await Effect.runPromise(store.patchNode("ghost", { titleText: "x" }, 1))
      expect(ok).toBe(false)
    })

    it("patch 字段只更新指定字段,其余保持", async () => {
      const store = makeStore()
      await Effect.runPromise(store.putNode(makeNode("n1", { collapsed: true })))
      await Effect.runPromise(store.patchNode("n1", { completed: true }, 1))
      const node = await db.nodes.get("n1")
      expect(node!.completed).toBe(true)
      expect(node!.collapsed).toBe(true)
      expect(node!.titleText).toBe("t-n1")
    })
  })

  describe("meta 表", () => {
    it("setMeta / getMeta 往返(lastScrollTop 恢复契约)", async () => {
      const store = makeStore()
      expect(await Effect.runPromise(store.getMeta(META_KEYS.lastScrollTop))).toBeNull()
      await Effect.runPromise(store.setMeta(META_KEYS.lastScrollTop, 42_000))
      expect(await Effect.runPromise(store.getMeta<number>(META_KEYS.lastScrollTop))).toBe(42_000)
      // 覆盖写
      await Effect.runPromise(store.setMeta(META_KEYS.lastScrollTop, 7))
      expect(await Effect.runPromise(store.getMeta<number>(META_KEYS.lastScrollTop))).toBe(7)
    })

    it("ensureSchemaVersion 首次写入当前版本", async () => {
      const store = makeStore()
      await Effect.runPromise(store.ensureSchemaVersion())
      expect(await Effect.runPromise(store.getMeta(META_KEYS.schemaVersion))).toBe(SCHEMA_VERSION)
    })

    it("ensureSchemaVersion 版本相同时幂等", async () => {
      const store = makeStore()
      await Effect.runPromise(store.setMeta(META_KEYS.schemaVersion, SCHEMA_VERSION))
      await Effect.runPromise(store.ensureSchemaVersion()) // 不抛
      expect(await Effect.runPromise(store.getMeta(META_KEYS.schemaVersion))).toBe(SCHEMA_VERSION)
    })

    it("ensureSchemaVersion 未来版本(数据高于应用)报 StoreError", async () => {
      const store = makeStore()
      await Effect.runPromise(store.setMeta(META_KEYS.schemaVersion, SCHEMA_VERSION + 1))
      const exit = await Effect.runPromiseExit(store.ensureSchemaVersion())
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        expect(String(exit.cause)).toContain("高于应用支持")
      }
    })
  })
})
