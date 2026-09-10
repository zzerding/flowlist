import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useEffect } from "react"

import { Effect } from "effect"
import { runtime } from "./runtime"
import { DataStore } from "../data/dataStore"
import { SearchService } from "../search/searchService"
import { nodesAtom } from "../state/outlineState"
import { Outline } from "../outline/Outline"
import { installMetricsWindow, mark, measure } from "../telemetry/metrics"

/**
 * 应用顶层：
 * 1. 启动流程从 Dexie 加载可见节点到内存表（原型全量加载可见节点；
 *    分页/焦点路径加载归后续切片，原型已断言 DOM 不随数据增长）；
 * 2. 建立 FlexSearch 内存索引；
 * 3. 挂性能指标只读入口（window.__flowlistMetrics）。
 */
export function App() {
  const setNodes = useAtomSet(nodesAtom)
  const nodes = useAtomValue(nodesAtom)

  useEffect(() => {
    installMetricsWindow()
    const program = Effect.gen(function* () {
      const store = yield* DataStore
      yield* store.ensureSchemaVersion()
      const visible = yield* store.getAllVisibleNodes()
      yield* Effect.sync(() => {
        setNodes(new Map(visible.map((n) => [n.id, n])))
      })
      const search = yield* SearchService
      yield* Effect.forEach(visible, (node: typeof visible[number]) => search.indexNode(node), {
        discard: true,
      })
    })

    void runtime.runPromise(program)
      .then(() => {
        mark("flowlist:data-ready")
      })
      .catch((error) => {
        console.error("启动失败", error)
      })
  }, [setNodes])

  return (
    <main>
      <h1>Flowlist</h1>
      <SearchBox />
      <Outline />
      <p data-testid="loaded-count" hidden>
        {nodes.size}
      </p>
    </main>
  )
}

function SearchBox() {
  // 最小搜索（决策记录第 5 条）：无 debounce，输入即查内存索引。
  // 门禁埋点：命令发起 → 索引结果 resolve。
  const search = (text: string) => {
    mark("flowlist:search:start")
    const program = Effect.gen(function* () {
      const svc = yield* SearchService
      return yield* svc.query(text)
    })
    void runtime.runPromise(program).finally(() => {
      measure("flowlist:search", "flowlist:search:start")
    })
  }
  return (
    <input
      data-testid="search-input"
      aria-label="搜索"
      onChange={(e) => search(e.target.value)}
    />
  )
}
