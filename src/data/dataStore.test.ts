import "fake-indexeddb/auto"
import { Effect } from "effect"
import { beforeEach, describe, expect, it } from "vitest"

import { db, META_KEYS, SCHEMA_VERSION } from "./db"
import { DataStore, DataStoreLayer } from "./dataStore"
import type { NodeRecord } from "../domain/nodeRecord"
import { generateSeed } from "../seed/seedGenerator"

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
