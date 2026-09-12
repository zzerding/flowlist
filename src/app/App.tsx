import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useEffect } from "react"
import { Effect } from "effect"

import { runtime } from "./runtime"
import { DataStore } from "../data/dataStore"
import { META_KEYS } from "../data/db"
import { SearchService } from "../search/searchService"
import {
  emptyVisibleWindow,
  extendVisibleWindow,
  startupReadyAtom,
  visibleWindowAtom,
} from "../state/outlineState"
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
 * 首屏行预算：720p 视口可视约 20 行 + overscan(8)，留冗余。
 * 只决定首屏一次枚举多少行，与门禁阈值（1s 绝对值）无关。
 */
export const FIRST_SCREEN_ROW_BUDGET = 128

/**
 * 应用顶层（架构 §8 分阶段启动 + 懒加载）：
 * 1. 首屏只枚举「根视图 + 可视范围」的真实行（`extendVisibleWindow` 按
 *    `flattenVisible` 顺序逐层取子节点）；**永不整体读 nodes 表** ——
 *    实测 100k/50MB 一次全表读（原生 IndexedDB 亦然）冷启动 ~95s，
 *    是旧 `reload ≈110s` 的根源；
 * 2. 后续行由滚动到窗口尾部时按需扩展（Outline 侧，完整无限滚动/焦点路径
 *    跳转归 #3/#4）；
 * 3. FlexSearch 索引重建仍在 Worker，且**首屏可编辑后才启动**（阶段 2），
 *    不参与 init → first-editable 的启动路径（决策补充：索引不占主线程）；
 * 4. 恢复：刷新后数据 + 滚动位置（决策记录第 6 条）；
 * 5. 挂性能指标只读入口（window.__flowlistMetrics）。
 */
declare global {
  interface Window {
    __SKIP_REINDEX__?: unknown
  }
}

export function App() {
  const setWindow = useAtomSet(visibleWindowAtom)
  const setStartupReady = useAtomSet(startupReadyAtom)
  const startupReady = useAtomValue(startupReadyAtom)
  const nodes = useAtomValue(visibleWindowAtom).nodes

  useEffect(() => {
    installMetricsWindow()
    const program = Effect.gen(function* () {
      const store = yield* DataStore
      yield* store.ensureSchemaVersion()
      // 阶段 1：首屏真实数据行（含折叠/tombstone 语义，见 outlineState 契约）。
      const initial = yield* extendVisibleWindow(
        emptyVisibleWindow(),
        (parentId) => store.getChildren(parentId),
        FIRST_SCREEN_ROW_BUDGET,
      )
      const savedScroll = yield* store.getMeta<number>(META_KEYS.lastScrollTop)
      yield* Effect.sync(() => {
        setWindow(initial)
        setStartupReady(true)
        if (typeof savedScroll === "number") offerScrollRestore(savedScroll)
        mark("flowlist:data-ready")
      })
    })

    void runtime.runPromise(program).catch((error) => {
      console.error("启动失败", error)
    })
  }, [setWindow, setStartupReady])

  // 阶段 2（首屏渲染完成后）：Worker 索引重建。放在 effect 里确保排在
  // 首屏真实行渲染/挂载之后，避免与首屏读取争抢 IndexedDB 磁盘 I/O。
  useEffect(() => {
    if (!startupReady || window.__SKIP_REINDEX__) return
    void runtime
      .runPromise(SearchService.use((search) => search.rebuildFromStore()))
      .catch((error) => console.error("搜索索引重建失败", error))
  }, [startupReady])

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
