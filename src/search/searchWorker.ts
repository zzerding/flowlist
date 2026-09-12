import { applyDocs, createIndex, searchIndex } from "./searchIndexCore"
import type { SearchIndexDoc, SearchRequest, SearchResponse } from "./searchProtocol"

/**
 * 搜索/索引 Worker（issue #2 决策补充）：
 * FlexSearch 全量索引构建与查询移出主线程（100k/50MB 下主线程同步索引
 * 阻塞 ~97s，触发架构 §18 升级条件）。
 *
 * 调度从简（完整 Worker 协议归 #3）：
 * - 全量重建由 Worker 直接流式读 IndexedDB（架构 §8），主线程零参与；
 * - 增量更新按调用方分批 applyDocs；每批处理间让出事件循环——
 *   查询消息在批间隙得到处理，构建期间搜索返回部分结果（架构 §12）；
 * - 查询带 requestId，主线程按序号丢弃过期结果（架构 §7 原型版）。
 */

const DB_NAME = "flowlist"
const NODES_STORE = "nodes"

const index = createIndex()
const indexedIds = new Set<string>()

const scope = self as unknown as {
  postMessage: (message: SearchResponse) => void
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<SearchRequest>) => void,
  ) => void
}

scope.addEventListener("message", (event) => {
  const msg = event.data
  if (msg.kind === "reindex") {
    reindexFromStore(msg.requestId).catch((error) => {
      scope.postMessage({ kind: "failed", requestId: msg.requestId, message: String(error) })
    })
    return
  }
  if (msg.kind === "index") {
    applyDocs(index, indexedIds, msg.docs)
    scope.postMessage({ kind: "indexed", requestId: msg.requestId })
    return
  }
  if (msg.kind === "query") {
    try {
      scope.postMessage({ kind: "result", requestId: msg.requestId, hits: searchIndex(index, msg.text) })
    } catch (error) {
      scope.postMessage({ kind: "failed", requestId: msg.requestId, message: String(error) })
    }
    return
  }
  scope.postMessage({ kind: "counted", requestId: msg.requestId, count: indexedIds.size })
})

const REINDEX_BATCH = 2000

/** 从持久化 nodes 表流式重建索引：分批 applyDocs，批间让出事件循环。 */
async function reindexFromStore(requestId: number): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME)
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  try {
    const tx = db.transaction(NODES_STORE, "readonly")
    const store = tx.objectStore(NODES_STORE)
    let batch: SearchIndexDoc[] = []
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor()
      cursorReq.onerror = () => reject(cursorReq.error)
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) {
          resolve()
          return
        }
        const node = cursor.value as { id: string; titleText: string; tombstonedAt?: number }
        if (node.tombstonedAt === undefined) {
          batch.push({ id: node.id, titleText: node.titleText })
        }
        if (batch.length >= REINDEX_BATCH) {
          applyDocs(index, indexedIds, batch)
          batch = []
          setTimeout(() => cursor.continue(), 0)
        } else {
          cursor.continue()
        }
      }
    })
    if (batch.length > 0) applyDocs(index, indexedIds, batch)
    scope.postMessage({ kind: "indexed", requestId })
  } finally {
    db.close()
  }
}
