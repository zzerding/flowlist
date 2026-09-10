import { $getRoot, createEditor, CLEAR_HISTORY_COMMAND, type LexicalEditor, type SerializedEditorState } from "lexical"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useEffect, useRef } from "react"

import type { LexicalContent } from "../domain/nodeRecord"

/**
 * 全应用唯一 Lexical 活动实例（架构 §10.1）。
 *
 * - 单 contenteditable，在节点/字段间切换（切 host 不切实例）；
 * - 载入目标节点字段的 EditorState；提交后清空 Lexical 历史（撤销交接）；
 * - 中文 IME 依赖 Lexical 原生 composition 处理（不做拦截）。
 */

export interface ActiveEditorProps {
  /** 初始内容（经 Schema 校验的 Lexical JSON 子集）。 */
  initialContent: LexicalContent | null
  /** 内容变更回调（节流/合并由调用方处理）。 */
  onChange: (state: SerializedEditorState) => void
  /** 载入新内容时清除 Lexical 历史（补丁已提交进应用栈）。 */
  onCommitHistory: () => void
  /** 字段标签（title/note），供测试与无障碍。 */
  fieldLabel: string
  /** 挂载后聚焦编辑器（切换节点/键盘焦点交接）。 */
  autoFocus?: boolean
}

/** 把 Schema 校验过的 JSON 子集转成 Lexical 可解析的 SerializedEditorState。 */
const toSerializedState = (content: LexicalContent | null): SerializedEditorState | null => {
  if (!content) return null
  return content as unknown as SerializedEditorState
}

export function ActiveEditor({ initialContent, onChange, onCommitHistory, fieldLabel, autoFocus }: ActiveEditorProps) {
  const initialConfig = {
    namespace: "flowlist",
    editable: true,
    editorState: (editor: LexicalEditor) => {
      const serialized = toSerializedState(initialContent)
      if (serialized) {
        editor.setEditorState(editor.parseEditorState(serialized))
      }
    },
    onError: (error: Error) => {
      throw error
    },
  }

  const editorRef = useRef<LexicalEditor | null>(null)
  const historyClearRef = useRef(onCommitHistory)
  historyClearRef.current = onCommitHistory

  useEffect(() => {
    const editor = editorRef.current
    if (editor) {
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
      historyClearRef.current()
      if (autoFocus) {
        editor.focus()
      }
    }
  }, [initialContent, autoFocus])

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label={fieldLabel}
            className="flow-active-editor"
            data-testid="active-editor"
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={(_, editor) => {
        editorRef.current = editor
      }} />
      <HistoryPlugin />
      <CommitOnChange onChange={onChange} editorRef={editorRef} />
    </LexicalComposer>
  )
}

function CommitOnChange({
  onChange,
  editorRef,
}: {
  onChange: (state: SerializedEditorState) => void
  editorRef: React.RefObject<LexicalEditor | null>
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editorRef.current = editor
  }, [editor, editorRef])
  return (
    <OnChangePlugin
      ignoreHistoryMergeTagChange={false}
      onChange={(editorState) => {
        onChange(editorState.toJSON())
      }}
    />
  )
}

/** 导出：为切换节点做准备（flush 当前内容）。 */
export const readEditorRootText = (editor: LexicalEditor): string => {
  let text = ""
  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent()
  })
  return text
}

export { createEditor }
