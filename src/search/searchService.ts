import { Context, Effect, Layer, Schema } from "effect"
import { Document, Charset } from "flexsearch"

import type { NodeRecord } from "../domain/nodeRecord"

/** Typed Error：搜索索引不可用。 */
export class SearchIndexError extends Schema.TaggedError<SearchIndexError>()("SearchIndexError", {
  cause: Schema.String,
}) {}

export interface SearchHit {
  id: string
}

/**
 * 最小搜索（决策记录第 5 条）：FlexSearch 对 titleText 建内存索引，
 * 无 Worker、无 debounce 语义。真实搜索语义（折叠子树命中、Focus 范围、
 * 索引就绪态）归 issue #4。最小搜索 ≠ 最终搜索实现。
 */
export class SearchService extends Context.Service<SearchService, {
  /** 增量更新索引（节点补丁提交后调用）。 */
  readonly indexNode: (node: NodeRecord) => Effect.Effect<void, SearchIndexError>
  /** 查询 titleText；返回节点 id 列表（不保证 Focus 过滤——归 #4）。 */
  readonly query: (text: string) => Effect.Effect<Array<SearchHit>, SearchIndexError>
  readonly indexedCount: () => Effect.Effect<number, never>
}>()("flowlist/SearchService") {}

export const SearchServiceLayer = Layer.effect(
  SearchService,
  Effect.sync(() => {
    // FlexSearch Document 索引，CJK encoder（架构 §12）
    const index = new Document({
      tokenize: "forward",
      encoder: Charset.CJK,
      document: { id: "id", index: ["titleText"] },
    })

    return {
      indexNode: (node: NodeRecord) =>
        Effect.try({
          try: () => {
            index.add(node.id, { id: node.id, titleText: node.titleText })
          },
          catch: (error) => new SearchIndexError({ cause: String(error) }),
        }),

      query: (text: string) =>
        Effect.try({
          try: () => {
            const raw = index.search(text, { limit: 50 })
            const field = Array.isArray(raw) ? raw[0] : null
            const ids = field && "result" in field ? (field.result as Array<string | number>) : []
            return ids.map((id) => ({ id: String(id) }))
          },
          catch: (error) => new SearchIndexError({ cause: String(error) }),
        }),

      indexedCount: () => Effect.succeed(0),
    }
  }),
)
