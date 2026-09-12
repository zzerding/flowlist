import { Context, Effect, Layer, Schema } from "effect"

import type { SearchHit, SearchIndexDoc, SearchRequest, SearchResponse } from "./searchProtocol"
import { applyDocs, createIndex, searchIndex } from "./searchIndexCore"

export type { SearchHit, SearchIndexDoc }

/** Typed Error：搜索索引不可用。 */
export class SearchIndexError extends Schema.TaggedError<SearchIndexError>()("SearchIndexError", {
  cause: Schema.String,
}) {}

/**
 * 搜索索引传输适配层（可注入）：
 * 浏览器注入真 Worker（索引不占主线程，issue #2 决策补充）；
 * jsdom/node 测试环境注入同步实现（同一 FlexSearch 核心，语义一致）。
 */
export interface SearchIndexClient {
  /** 批量加入/更新索引；resolve 表示该批已入索引（背压用）。 */
  readonly indexDocs: (docs: ReadonlyArray<SearchIndexDoc>) => Promise<void>
  /** 从持久化 nodes 表全量重建（Worker 内直接读 IndexedDB，主线程零参与）。 */
  readonly rebuildFromStore: () => Promise<void>
  readonly query: (text: string) => Promise<Array<SearchHit>>
  readonly indexedCount: () => Promise<number>
}

/** Worker 侧最小能力（真 Worker 与测试替身都满足此形状）。 */
interface WorkerLike {
  postMessage: (message: SearchRequest) => void
  addEventListener: (
    type: "message",
    listener: (event: { data: SearchResponse }) => void,
  ) => void
}

/**
 * 真 Worker 客户端：requestId 判别请求/响应；查询带递增序号，
 * 过期结果到达后直接丢弃（架构 §7 原型版）。
 */
export class WorkerSearchClient implements SearchIndexClient {
  private readonly worker: WorkerLike
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private nextRequestId = 1
  private latestQueryId = 0

  constructor(worker: WorkerLike) {
    this.worker = worker
    worker.addEventListener("message", (event) => {
      const msg = event.data
      const entry = this.pending.get(msg.requestId)
      if (!entry) return
      this.pending.delete(msg.requestId)
      if (msg.kind === "failed") {
        entry.reject(new Error(msg.message))
        return
      }
      if (msg.kind === "counted") {
        entry.resolve(msg.count)
        return
      }
      if (msg.kind === "result") {
        // 丢弃过期查询结果：只认最新序号
        entry.resolve(msg.requestId === this.latestQueryId ? msg.hits : [])
      }
    })
  }

  private request<T>(msg: SearchRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(msg.requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      this.worker.postMessage(msg)
    })
  }

  indexDocs(docs: ReadonlyArray<SearchIndexDoc>): Promise<void> {
    const requestId = this.nextRequestId++
    return this.request<void>({ kind: "index", requestId, docs: [...docs] })
  }

  rebuildFromStore(): Promise<void> {
    const requestId = this.nextRequestId++
    return this.request<void>({ kind: "reindex", requestId })
  }

  query(text: string): Promise<Array<SearchHit>> {
    const requestId = this.nextRequestId++
    this.latestQueryId = requestId
    return this.request<Array<SearchHit>>({ kind: "query", requestId, text })
  }

  indexedCount(): Promise<number> {
    const requestId = this.nextRequestId++
    return this.request<number>({ kind: "count", requestId })
  }
}

/** 同步客户端：node/单测环境无 Worker，用同一索引核心直连。 */
export const createSyncSearchClient = (): SearchIndexClient => {
  const index = createIndex()
  const indexedIds = new Set<string>()
  return {
    indexDocs: async (docs) => {
      applyDocs(index, indexedIds, docs)
    },
    rebuildFromStore: async () => {
      // 同步客户端（node/单测）：无持久化重建语义，用例直接走 indexDocs。
    },
    query: async (text) => searchIndex(index, text),
    indexedCount: async () => indexedIds.size,
  }
}

/** 浏览器默认客户端：真 Worker（Vite 会把 searchWorker.ts 打成独立 chunk）。 */
export const createDefaultSearchClient = (): SearchIndexClient => {
  if (typeof Worker === "undefined") return createSyncSearchClient()
  return new WorkerSearchClient(
    new Worker(new URL("./searchWorker.ts", import.meta.url), { type: "module" }),
  )
}

/**
 * 最小搜索服务（决策记录第 5 条 + 决策补充）：
 * 索引构建/查询经 SearchIndexClient（浏览器为 Worker）执行，
 * 不阻塞主线程；启动分块构建，期间查询返回部分结果。
 * 真实搜索语义（折叠子树命中、Focus 范围）归 issue #4。
 */
export class SearchService extends Context.Service<SearchService, {
  /** 从持久化 nodes 表分块重建索引（启动时调用；Worker 内执行不占主线程）。 */
  readonly rebuildFromStore: () => Effect.Effect<void, SearchIndexError>
  /** 增量更新索引（节点补丁提交后调用）。 */
  readonly indexNodes: (docs: ReadonlyArray<SearchIndexDoc>) => Effect.Effect<void, SearchIndexError>
  /** 查询 titleText；返回节点 id 列表。 */
  readonly query: (text: string) => Effect.Effect<Array<SearchHit>, SearchIndexError>
  readonly indexedCount: () => Effect.Effect<number, never>
}>()("flowlist/SearchService") {}

const serviceFromClient = (client: SearchIndexClient): typeof SearchService.Service => ({
  rebuildFromStore: () =>
    Effect.tryPromise({
      try: () => client.rebuildFromStore(),
      catch: (error) => new SearchIndexError({ cause: String(error) }),
    }),

  indexNodes: (docs) =>
    Effect.tryPromise({
      try: () => client.indexDocs(docs),
      catch: (error) => new SearchIndexError({ cause: String(error) }),
    }),

  query: (text) =>
    Effect.tryPromise({
      try: () => client.query(text),
      catch: (error) => new SearchIndexError({ cause: String(error) }),
    }),

  indexedCount: () =>
    Effect.orElseSucceed(
      Effect.tryPromise({
        try: () => client.indexedCount(),
        catch: (error) => new SearchIndexError({ cause: String(error) }),
      }),
      () => 0,
    ),
})

/** 浏览器层：真 Worker 客户端（node 环境自动降级同步客户端）。 */
export const SearchServiceLayer = Layer.effect(
  SearchService,
  Effect.sync(() => serviceFromClient(createDefaultSearchClient())),
)

/** 测试层：同步客户端（jsdom/node 无 Worker；接缝 1 语义不变）。 */
export const SearchServiceSyncLayer = Layer.effect(
  SearchService,
  Effect.sync(() => serviceFromClient(createSyncSearchClient())),
)
