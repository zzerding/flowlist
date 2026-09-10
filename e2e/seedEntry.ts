/**
 * 页面内 seed 入口（esbuild 打包后由 addInitScript 注入）。
 * 在真浏览器 IndexedDB 中生成并写入确定性 seed（决策记录第 4 条）。
 */
import { generateSeed } from "../src/seed/seedGenerator"

declare const __SEED_COUNT__: number
declare const __SEED_BYTES__: number

;(window as unknown as Record<string, unknown>).__flowlistSeedReady = (async () => {
  // 已写入过则跳过（addInitScript 在每次导航都会执行；
  // 性能采样需要「数据已持久化」的已缓存启动，不应每次 reload 重建 50MB）
  if (localStorage.getItem("flowlistSeedDone")) {
    ;(window as unknown as Record<string, unknown>).__flowlistSeedCount = -1
    return
  }

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
  localStorage.setItem("flowlistSeedDone", String(nodes.length))
  // 关键：释放原生连接。不 close 会让应用侧 Dexie 的 open 请求被 block
  //（实测表现为「Upgrade 'flowlist' blocked by other connection holding version 0.1」警告，
  // 后续 reload 时应用加载卡死）。这是 e2e/README.md 记录的坑之一。
  db.close()
})()
