/**
 * 搜索 Worker 消息协议（原型从简版）：
 * postMessage + requestId 判别；完整 Effect Schema 双向校验协议归 issue #3
 * （issue #2 决策补充：索引不占主线程从本切片起为硬约束）。
 */

export interface SearchHit {
  readonly id: string
}

/** 索引文档：titleText 纯文本（FlexSearch Document 索引字段）。 */
export interface SearchIndexDoc {
  readonly id: string
  readonly titleText: string
}

export type SearchRequest =
  | { kind: "index"; requestId: number; docs: Array<SearchIndexDoc> }
  | { kind: "reindex"; requestId: number }
  | { kind: "query"; requestId: number; text: string }
  | { kind: "count"; requestId: number }

export type SearchResponse =
  | { kind: "indexed"; requestId: number }
  | { kind: "result"; requestId: number; hits: Array<SearchHit> }
  | { kind: "counted"; requestId: number; count: number }
  | { kind: "failed"; requestId: number; message: string }
