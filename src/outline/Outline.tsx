import { useAtomValue, useAtomSet } from "@effect/atom-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useEffect, useRef } from "react"
import { Effect } from "effect"

import { ActiveEditor } from "../editor/ActiveEditor"
import { StaticContent } from "../editor/staticRenderer"
import type { NodeRecord } from "../domain/nodeRecord"
import { validateContent } from "../editor/staticRenderer"
import {
  activeEditAtom,
  expandedNoteAtom,
  extendVisibleWindow,
  firstEditableRowId,
  startupReadyAtom,
  visibleWindowAtom,
  visibleWindowExhausted,
  type ActiveEdit,
} from "../state/outlineState"
import { runtime, DataStore, SearchService } from "../app/runtime"
import { consumePendingScrollRestore, rememberScrollPosition } from "../app/App"
import { measure, mark } from "../telemetry/metrics"

/**
 * 大纲虚拟列表（原型）：
 * - TanStack Virtual 只渲染可视行 + overscan（DOM 规模不随数据规模增长）；
 * - 静态行用 StaticContent；活动行挂唯一 Lexical contenteditable；
 * - 行高统一固定值，静态/活动切换无布局跳变；
 * - 懒加载可视窗口（架构 §8）：滚动接近已加载尾部时按需继续枚举子节点，
 *   永不整体读取 nodes 表；完整无限滚动与焦点路径跳转归 #3/#4；
 * - 分阶段启动：首屏真实行就绪后，默认光标行自动落到首个体量正常的真实行
 *   （启动门禁语义：首个可编辑入口必须来自真实数据）；幽灵行仅用于空库兜底。
 */

const ROW_HEIGHT = 36

/** 每次按需扩展追加的行数（≈ 一屏多；覆盖 overscan 邻近区）。 */
const EXTEND_ROWS = 128
/** 最后渲染行距离已加载尾部少于该值时触发扩展。 */
const EXTEND_TRIGGER_GAP = 32

/** 编辑合并窗口（架构 §9：编辑「100ms 内合并为节点补丁」，不逐键写 Dexie）。 */
const EDIT_MERGE_MS = 100

/** 编辑状态 → 节点补丁（title/note 两个字段共用）。 */
const toPatch = (field: "title" | "note", state: unknown): Partial<NodeRecord> =>
  field === "title"
    ? { title: state as NodeRecord["title"], titleText: extractText(state) }
    : { note: state as NonNullable<NodeRecord["note"]>, noteText: extractText(state) }

export function Outline() {
  const windowState = useAtomValue(visibleWindowAtom)
  const rows = windowState.rows
  const nodes = windowState.nodes
  const startupReady = useAtomValue(startupReadyAtom)
  const activeEdit = useAtomValue(activeEditAtom)
  const setActiveEdit = useAtomSet(activeEditAtom)
  const setWindow = useAtomSet(visibleWindowAtom)
  const setExpandedNote = useAtomSet(expandedNoteAtom)

  const scrollRef = useRef<HTMLDivElement>(null)

  // 编辑热路径（输入门禁 ET P95 ≤16ms 约束下，逐键不碰 Dexie 与全量 Map）：
  // - lastEditRef/dirtyRef：暂存最新编辑内容（每次 onChange 覆盖，合并窗口语义）；
  // - saveTimerRef：合并窗口定时器，到期提交一次 Dexie；
  // - revisionsRef：乐观 revision 缓存（切行走时同步内存表，不逐键更新）；
  // - 切行走时 flush：取消定时器、立即提交，并把最新内容同步进内存表。
  const revisionsRef = useRef(new Map<string, number>())
  const lastEditRef = useRef<{
    nodeId: string
    field: "title" | "note"
    state: unknown
  } | null>(null)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    },
    [],
  )

  // 恢复滚动位置 + 卸载/刷新时持久化（决策记录第 6 条）。
  // 数据异步加载，等首行渲染后再恢复（否则消费时机早于 offer）。
  const hasRows = rows.length > 0

  // 首屏默认光标行（架构 §8 步骤 4）：首屏真实行渲染后自动挂载活动编辑器，
  // 无需交互。只在首次就绪时执行一次（不抢用户后续焦点）。
  const autoActivatedRef = useRef(false)
  useEffect(() => {
    if (autoActivatedRef.current || !startupReady || !hasRows) return
    autoActivatedRef.current = true
    const id = firstEditableRowId(rows, nodes)
    if (id !== null) setActiveEdit({ nodeId: id, field: "title" })
  }, [startupReady, hasRows, rows, nodes, setActiveEdit])

  useEffect(() => {
    if (!hasRows) return
    const el = scrollRef.current
    if (!el) return
    const saved = consumePendingScrollRestore()
    if (saved !== null) el.scrollTop = saved
  }, [hasRows])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => rememberScrollPosition(el.scrollTop)
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  /** 按需扩展可视窗口（懒加载；同一时刻至多一个在途）。 */
  const extendingRef = useRef(false)
  const extendViewport = useCallback(() => {
    if (extendingRef.current || visibleWindowExhausted(windowState)) return
    extendingRef.current = true
    const program = Effect.gen(function* () {
      const store = yield* DataStore
      const next = yield* extendVisibleWindow(
        windowState,
        (parentId) => store.getChildren(parentId),
        windowState.rows.length + EXTEND_ROWS,
      )
      yield* Effect.sync(() => setWindow(next))
    })
    void runtime
      .runPromise(program)
      .catch((error) => console.error("扩展可视窗口失败", error))
      .finally(() => {
        extendingRef.current = false
      })
  }, [windowState, setWindow])

  const virtualItems = virtualizer.getVirtualItems()
  const lastVirtualIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]!.index : 0

  // 滚动接近已加载尾部时扩展（懒加载触发点）。
  useEffect(() => {
    if (!startupReady || rows.length === 0) return
    if (lastVirtualIndex < rows.length - EXTEND_TRIGGER_GAP) return
    extendViewport()
  }, [startupReady, lastVirtualIndex, rows.length, extendViewport])

  /** Dexie 提交（含冲突重提）；返回是否提交成功。 */
  const commitToStore = useCallback(
    async (nodeId: string, field: "title" | "note", state: unknown): Promise<boolean> => {
      // 保存命令发起 → Dexie 确认（决策记录：手动 performance.measure）
      mark("flowlist:save:start")
      const patch = toPatch(field, state)
      try {
        return await runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* DataStore
            const node = nodes.get(nodeId)
            const expected = revisionsRef.current.get(nodeId) ?? node?.revision ?? 0
            const ok = yield* store.patchNode(nodeId, patch, expected)
            if (ok) {
              revisionsRef.current.set(nodeId, expected + 1)
              return true
            }
            // revision 过期或记录缺失：按库内当前数据重取后再提交（原型从简）
            const fresh = yield* store.getNode(nodeId)
            if (!fresh) return false
            const retried = yield* store.patchNode(nodeId, patch, fresh.revision)
            if (!retried) return false
            revisionsRef.current.set(nodeId, fresh.revision + 1)
            return true
          }),
        )
      } finally {
        measure("flowlist:save", "flowlist:save:start")
      }
    },
    [nodes],
  )

  /** 合并窗口到期/切行走时提交一次 Dexie + 搜索索引增量更新。 */
  const flushPendingEdit = useCallback((syncMemory: boolean) => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = lastEditRef.current
    if (!pending || !dirtyRef.current) return
    dirtyRef.current = false
    lastEditRef.current = null
    void commitToStore(pending.nodeId, pending.field, pending.state)
      .then(() => {
        // 搜索索引增量更新（Worker 内执行，fire-and-forget，不占主线程）
        return runtime.runPromise(
          SearchService.use((svc) =>
            svc.indexNodes([
              { id: pending.nodeId, titleText: extractText(pending.state) },
            ]),
          ),
        )
      })
      .catch(() => undefined)
    if (!syncMemory) return
    // 内存表同步（仅切换活动行时）：把最新内容写进可视窗口的节点表，
    // 切换后静态行/重新激活展示正确。Dexie 仍是真写源。
    const node = nodes.get(pending.nodeId)
    if (!node) return
    const revision = revisionsRef.current.get(pending.nodeId) ?? node.revision
    setWindow((prev) => {
      const nextNodes = new Map(prev.nodes)
      nextNodes.set(pending.nodeId, {
        ...node,
        ...toPatch(pending.field, pending.state),
        revision,
        updatedAt: Date.now(),
      })
      return { ...prev, nodes: nextNodes }
    })
  }, [commitToStore, nodes, setWindow])

  /** onChange 入口：只暂存内容 + 重置合并窗口（无 IO，保证输入延迟）。 */
  const commitEdit = useCallback(
    (nodeId: string, field: "title" | "note", state: unknown) => {
      lastEditRef.current = { nodeId, field, state }
      dirtyRef.current = true
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        flushPendingEdit(false)
      }, EDIT_MERGE_MS)
    },
    [flushPendingEdit],
  )

  const activate = useCallback(
    (edit: ActiveEdit) => {
      flushPendingEdit(true)
      setActiveEdit(edit)
      if (edit.field === "note") {
        setExpandedNote(edit.nodeId)
      } else {
        setExpandedNote(null)
      }
    },
    [flushPendingEdit, setActiveEdit, setExpandedNote],
  )

  return (
    <div className="flow-outline" ref={scrollRef} data-testid="outline-scroll">
      {hasRows ? (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((item) => {
            const row = rows[item.index]!
            const node = nodeOf(row.id, nodes)
            if (!node) return null
            const isActive = activeEdit?.nodeId === row.id
            const noteExpanded = isActive && activeEdit?.field === "note"
            return (
              <div
                key={row.id}
                data-virtual-index={item.index}
                data-node-id={row.id}
                className="flow-row"
                style={{
                  position: "absolute",
                  top: item.start,
                  left: 0,
                  width: "100%",
                  minHeight: ROW_HEIGHT,
                  height: noteExpanded ? "auto" : ROW_HEIGHT,
                  paddingLeft: row.depth * 20,
                }}
              >
                {isActive ? (
                  <ActiveEditor
                    fieldLabel={activeEdit!.field}
                    initialContent={validateContent(
                      activeEdit!.field === "title" ? node.title : node.note,
                    )}
                    onChange={(state) => void commitEdit(row.id, activeEdit!.field, state)}
                    onCommitHistory={() => {
                      // Lexical 历史作废（补丁交接进应用栈，决策记录第 2 条）
                    }}
                    autoFocus
                  />
                ) : (
                  <div
                    className="flow-row-static"
                    onClick={() => activate({ nodeId: row.id, field: "title" })}
                  >
                    <StaticContent raw={node.title} fallbackText={node.titleText} className="flow-row-title" />
                    {node.note ? (
                      <button
                        type="button"
                        aria-label="展开备注"
                        className="flow-note-indicator"
                        onClick={(e) => {
                          e.stopPropagation()
                          activate({ nodeId: row.id, field: "note" })
                        }}
                      >
                        备注
                      </button>
                    ) : null}
                    {noteExpanded ? <StaticContent raw={node.note} className="flow-row-note" /> : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : startupReady ? (
        // 幽灵活动行：数据就绪但为空（全新安装）时提供默认可编辑入口
        // （不落库，不参与启动门禁 —— 有真实数据时首行即真实行）。
        <div className="flow-row" data-node-id="__ghost__" style={{ minHeight: ROW_HEIGHT }}>
          <ActiveEditor
            fieldLabel="title"
            initialContent={null}
            onChange={() => undefined}
            onCommitHistory={() => undefined}
            autoFocus
          />
        </div>
      ) : (
        // 加载占位（首屏读取中）：非 contenteditable，
        // 保证 flowlist:startup 在真实数据行就绪后才结算。
        <div className="flow-loading" data-testid="outline-loading">
          加载中…
        </div>
      )}
    </div>
  )
}

const nodeOf = (id: string, nodes: ReadonlyMap<string, NodeRecord>): NodeRecord | undefined =>
  nodes.get(id)

/** 从 SerializedEditorState 宽松提取纯文本（与静态 renderer 同语义）。 */
const extractText = (state: unknown): string => {
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (n !== null && typeof n === "object") {
      const obj = n as Record<string, unknown>
      if (typeof obj.text === "string") out.push(obj.text)
      if (Array.isArray(obj.children)) walk(obj.children)
      if (obj.root !== undefined) walk(obj.root)
    }
  }
  walk(state)
  return out.join("")
}
