import { useAtomValue, useAtomSet } from "@effect/atom-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useRef } from "react"

import { ActiveEditor } from "../editor/ActiveEditor"
import { StaticContent } from "../editor/staticRenderer"
import type { NodeRecord } from "../domain/nodeRecord"
import { validateContent } from "../editor/staticRenderer"
import { activeEditAtom, expandedNoteAtom, nodesAtom, visibleRowsAtom, type ActiveEdit } from "../state/outlineState"
import { runtime, DataStore } from "../app/runtime"
import { measure, mark } from "../telemetry/metrics"

/**
 * 大纲虚拟列表（原型）：
 * - TanStack Virtual 只渲染可视行 + overscan（DOM 规模不随 100k 增长）；
 * - 静态行用 StaticContent；活动行挂唯一 Lexical contenteditable；
 * - 行高统一固定值，静态/活动切换无布局跳变。
 */

const ROW_HEIGHT = 36

export function Outline() {
  const rows = useAtomValue(visibleRowsAtom)
  const nodes = useAtomValue(nodesAtom)
  const activeEdit = useAtomValue(activeEditAtom)
  const setActiveEdit = useAtomSet(activeEditAtom)
  const setExpandedNote = useAtomSet(expandedNoteAtom)

  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  const nodeOf = useCallback(
    (id: string): NodeRecord | undefined => nodes.get(id),
    [nodes],
  )

  const activate = useCallback(
    (edit: ActiveEdit) => {
      setActiveEdit(edit)
      if (edit.field === "note") {
        setExpandedNote(edit.nodeId)
      } else {
        setExpandedNote(null)
      }
    },
    [setActiveEdit, setExpandedNote],
  )

  const commitEdit = useCallback(
    async (nodeId: string, field: "title" | "note", state: unknown) => {
      // 保存命令发起 → Dexie 确认（决策记录：手动 performance.measure）
      mark("flowlist:save:start")
      const patch: Partial<NodeRecord> =
        field === "title"
          ? { title: state as NodeRecord["title"], titleText: extractText(state) }
          : { note: state as NonNullable<NodeRecord["note"]>, noteText: extractText(state) }
      try {
        const node = nodes.get(nodeId)
        await runtime.runPromise(
          DataStore.use((store) => store.patchNode(nodeId, patch, node?.revision ?? 0)),
        )
      } finally {
        measure("flowlist:save", "flowlist:save:start")
      }
    },
    [nodes],
  )

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="flow-outline" ref={scrollRef} data-testid="outline-scroll">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualItems.map((item) => {
          const row = rows[item.index]!
          const node = nodeOf(row.id)
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
                top: 0,
                left: 0,
                width: "100%",
                height: noteExpanded ? undefined : ROW_HEIGHT,
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
    </div>
  )
}

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
    }
  }
  walk(state)
  return out.join("")
}
