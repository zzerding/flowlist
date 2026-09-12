import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { SearchIndexError, SearchService, SearchServiceSyncLayer, WorkerSearchClient } from "./searchService"
import type { SearchRequest, SearchResponse } from "./searchProtocol"

/** 收集请求并允许测试手动回放响应的 Worker 替身（真实 Worker 在 node 不可用）。 */
class FakeWorker {
  readonly sent: SearchRequest[] = []
  private listener: ((event: { data: SearchResponse }) => void) | null = null

  postMessage(msg: SearchRequest): void {
    this.sent.push(msg)
  }

  addEventListener(_type: "message", listener: (event: { data: SearchResponse }) => void): void {
    this.listener = listener
  }

  respond(res: SearchResponse): void {
    this.listener?.({ data: res })
  }
}

describe("SearchIndexClient（接缝 1：可注入适配层）", () => {
  it("同步客户端：索引后查询命中（CJK 分词语义不变）", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* SearchService
      yield* svc.indexNodes([
        { id: "a", titleText: "季度目标与产品路线" },
        { id: "b", titleText: "meeting notes roadmap" },
      ])
      const zh = yield* svc.query("路线")
      const en = yield* svc.query("roadmap")
      const count = yield* svc.indexedCount()
      return { zh, en, count }
    }).pipe(Effect.provide(SearchServiceSyncLayer))

    const { zh, en, count } = await Effect.runPromise(program)
    expect(zh.map((h) => h.id)).toContain("a")
    expect(en.map((h) => h.id)).toEqual(["b"])
    expect(count).toBe(2)
  })

  it("同步客户端：重复 indexNodes 走更新，不产生重复命中", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* SearchService
      yield* svc.indexNodes([{ id: "a", titleText: "会议纪要" }])
      yield* svc.indexNodes([{ id: "a", titleText: "迭代回顾" }])
      const old = yield* svc.query("会议")
      const fresh = yield* svc.query("回顾")
      const count = yield* svc.indexedCount()
      return { old, fresh, count }
    }).pipe(Effect.provide(SearchServiceSyncLayer))

    const { old: oldHits, fresh, count } = await Effect.runPromise(program)
    expect(fresh.map((h) => h.id)).toEqual(["a"])
    expect(oldHits).toEqual([])
    expect(count).toBe(1)
  })

  it("WorkerSearchClient：按 requestId 判别响应，过期查询结果直接丢弃", async () => {
    const fake = new FakeWorker()
    const client = new WorkerSearchClient(fake)

    client.indexDocs([{ id: "a", titleText: "季度目标" }]).catch(() => undefined)
    expect(fake.sent[0]?.kind).toBe("index")

    const stalePromise = client.query("目标")
    const freshPromise = client.query("目标")
    // 先回旧序号（应丢弃 → 空结果），再回新序号（应命中）
    fake.respond({ kind: "result", requestId: 2, hits: [{ id: "stale" }] })
    fake.respond({ kind: "result", requestId: 3, hits: [{ id: "fresh" }] })

    await expect(stalePromise).resolves.toEqual([])
    await expect(freshPromise).resolves.toEqual([{ id: "fresh" }])

    // failed 响应按 requestId 走 reject
    const failPromise = client.query("目标")
    fake.respond({ kind: "failed", requestId: 4, message: "boom" })
    await expect(failPromise).rejects.toThrow("boom")
  })

  it("SearchServiceLayer 在 node 环境（无 Worker）降级为同步客户端且可查询", async () => {
    const { SearchServiceLayer } = await import("./searchService")
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SearchService
        yield* svc.indexNodes([{ id: "x", titleText: "灵感片段" }])
        return yield* svc.query("灵感")
      }).pipe(Effect.provide(SearchServiceLayer)),
    )
    expect(result.map((h) => h.id)).toEqual(["x"])
  })
})

// SearchIndexError 仍按契约导出（保持既有错误通道）
describe("SearchIndexError", () => {
  it("构造后保留 cause", () => {
    const err = new SearchIndexError({ cause: "x" })
    expect(err.cause).toBe("x")
  })
})
