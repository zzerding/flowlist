import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useEffect } from "react"
import { Effect } from "effect"

import { runtime } from "./runtime"
import { DataStore } from "../data/dataStore"
import { META_KEYS } from "../data/db"
import { SearchService } from "../search/searchService"
import { buildChildrenIndex, flattenVisible, nodesAtom, outlineRowsAtom } from "../state/outlineState"
import { Outline } from "../outline/Outline"
import { installMetricsWindow, mark, measure } from "../telemetry/metrics"

/** 恢复滚动位置：Outline 挂载后消费一次（决策记录第 6 条）。 */
let pendingScrollRestore: number | null = null
export const offerScrollRestore = (scrollTop: number): void => {
  pendingScrollRestore = scrollTop
}
export const consumePendingScrollRestore = (): number | null => {
  const v = pendingScrollRestore
  pendingScrollRestore = null
  return v
}

/** 滚动位置持久化（节流交由调用方；崩溃窗口 = 两次调用间隔）。 */
export const rememberScrollPosition = (scrollTop: number): void => {
  const program = Effect.gen(function* () {
    const store = yield* DataStore
    yield* store.setMeta(META_KEYS.lastScrollTop, scrollTop)
  })
  void runtime.runPromise(program).catch(() => undefined)
}

/**
 * 应用顶层：
 * 1. 启动流程从 Dexie 加载可见节点到内存表（原型全量加载可见节点；
 *    分页/焦点路径加载归后续切片，原型已断言 DOM 不随数据增长）；
 * 2. FlexSearch 索引由 Worker 直接读 IndexedDB 后台重建（决策补充：索引不占
 *    主线程；构建期间搜索返回部分结果，架构 §8/§12 分阶段启动）；
 * 3. 恢复：刷新后数据 + 滚动位置（决策记录第 6 条）；
 * 4. 挂性能指标只读入口（window.__flowlistMetrics）。
 */
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __SKIP_REINDEX__?: unknown
  }
}

export function App() {
  const setNodes = useAtomSet(nodesAtom)
  const setRows = useAtomSet(outlineRowsAtom)
  const nodes = useAtomValue(nodesAtom)

  useEffect(() => {
    installMetricsWindow()
    const program = Effect.gen(function* () {
      const store = yield* DataStore
      yield* store.ensureSchemaVersion()
      const visible = yield* store.getAllVisibleNodes()
      const savedScroll = yield* store.getMeta<number>(META_KEYS.lastScrollTop)
      yield* Effect.sync(() => {
        setNodes(new Map(visible.map((n) => [n.id, n])))
        // 行表只在加载时派生一次（原型无结构变更；结构命令归后续切片）。
        // 逐键编辑只更新 nodesAtom，不重算行表（100k 派生 ~45ms，进不了 16ms 输入门禁）。
        setRows(flattenVisible(buildChildrenIndex(visible)))
        if (typeof savedScroll === "number") offerScrollRestore(savedScroll)
        mark("flowlist:data-ready")
      })
      // 索引重建移入 Worker（直接流式读 IndexedDB，主线程零参与——决策补充：
      // 索引不占主线程）。
      const search = yield* SearchService
      if (!window.__SKIP_REINDEX__) yield* search.rebuildFromStore()
    })

    void runtime.runPromise(program).catch((error) => {
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
