/**
 * 页面内 seed 入口（esbuild 打包后由 addInitScript 注入）。
 * 在真浏览器 IndexedDB 中生成并写入确定性 seed（决策记录第 4 条）。
 */
import { generateSeed } from "../src/seed/seedGenerator"

declare const __SEED_COUNT__: number
declare const __SEED_BYTES__: number

;(window as unknown as Record<string, unknown>).__flowlistSeedReady = (async () => {
  const { nodes } = generateSeed({ nodeCount: __SEED_COUNT__, targetBytes: __SEED_BYTES__ })

  // addInitScript 阶段应用尚未打开 Dexie：这里自建库与表（与 src/data/db.ts v1 schema 一致）
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("flowlist", 1)
    open.onupgradeneeded = () => {
      const raw = open.result
      if (!raw.objectStoreNames.contains("nodes")) {
        const store = raw.createObjectStore("nodes", { keyPath: "id" })
        store.createIndex("[parentId+orderKey]", ["parentId", "orderKey"])
        store.createIndex("parentId", "parentId")
        store.createIndex("updatedAt", "updatedAt")
        store.createIndex("tombstonedAt", "tombstonedAt")
      }
      if (!raw.objectStoreNames.contains("meta")) {
        raw.createObjectStore("meta", { keyPath: "key" })
      }
      if (!raw.objectStoreNames.contains("searchChunks")) {
        raw.createObjectStore("searchChunks", { keyPath: "key" })
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("nodes", "readwrite")
    tx.objectStore("nodes").clear()
    for (const node of nodes) tx.objectStore("nodes").put(node)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite")
    tx.objectStore("meta").put({ key: "schemaVersion", value: 1 })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  ;(window as unknown as Record<string, unknown>).__flowlistSeedCount = nodes.length
})()
