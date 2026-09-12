import { Document, Charset } from "flexsearch"

import type { SearchHit, SearchIndexDoc } from "./searchProtocol"

/**
 * FlexSearch Document 索引核心操作（纯逻辑，主线程/Worker 共用）。
 * Worker 用它做真实索引；测试环境用同一实现做同步替身，
 * 保证两侧语义一致（接缝 1 测试不依赖浏览器 Worker）。
 */

export const createIndex = () =>
  // CJK encoder（架构 §12：中文分词）
  new Document({
    tokenize: "forward",
    encoder: Charset.CJK,
    document: { id: "id", index: ["titleText"] },
  })

/** 批量加入/更新：已索引过的 id 走 update（编辑补丁提交后的增量更新）。 */
export const applyDocs = (
  index: ReturnType<typeof createIndex>,
  indexedIds: Set<string>,
  docs: ReadonlyArray<SearchIndexDoc>,
): void => {
  for (const doc of docs) {
    const payload = { id: doc.id, titleText: doc.titleText }
    if (indexedIds.has(doc.id)) {
      index.update(doc.id, payload)
    } else {
      index.add(doc.id, payload)
      indexedIds.add(doc.id)
    }
  }
}

/** 查询 titleText 索引，返回节点 id（不保证 Focus 过滤——归 #4）。 */
export const searchIndex = (
  index: ReturnType<typeof createIndex>,
  text: string,
): Array<SearchHit> => {
  const raw = index.search(text, { limit: 50 })
  const field = Array.isArray(raw) ? raw[0] : null
  const ids = field && "result" in field ? (field.result as Array<string | number>) : []
  return ids.map((id) => ({ id: String(id) }))
}
