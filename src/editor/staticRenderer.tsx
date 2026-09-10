import type { BlockNode, InlineNode, LexicalContent } from "../domain/nodeRecord"
import { lexicalToText } from "../domain/nodeRecord"
import { Schema } from "effect"
import { LexicalContentSchema } from "../domain/nodeRecord"

/**
 * 静态 renderer（决策记录第 3 条）：
 * - 自写轻量 renderer，直接遍历 Effect Schema 校验过的 Lexical JSON；
 * - 校验失败行降级纯文本（不丢内容）；
 * - 子集外格式丢样式不丢内容；
 * - 不使用 dangerouslySetInnerHTML。
 */

const checkContent = Schema.decodeUnknownOption(LexicalContentSchema)

/** 校验 Lexical JSON；失败返回 null（调用方降级纯文本）。 */
export const validateContent = (raw: unknown): LexicalContent | null => {
  const result = checkContent(raw)
  return result._tag === "Some" ? result.value : null
}

const TEXT_FORMAT_BOLD = 1
const TEXT_FORMAT_ITALIC = 2
const TEXT_FORMAT_STRIKETHROUGH = 16
const TEXT_FORMAT_CODE = 32

const renderInline = (node: InlineNode, keyPrefix: string): React.ReactNode => {
  if ("text" in node) {
    const format = node.format ?? 0
    let content: React.ReactNode = node.text
    if (format & TEXT_FORMAT_CODE) {
      content = <code>{content}</code>
    }
    if (format & TEXT_FORMAT_STRIKETHROUGH) {
      content = <del>{content}</del>
    }
    if (format & TEXT_FORMAT_ITALIC) {
      content = <em>{content}</em>
    }
    if (format & TEXT_FORMAT_BOLD) {
      content = <strong>{content}</strong>
    }
    return <span key={keyPrefix}>{content}</span>
  }
  // link：仅支持安全协议（架构 §16）
  const url = node.url
  const safe = /^https?:\/\//.test(url)
  return (
    <span key={keyPrefix}>
      {safe ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {node.children.map((c, i) => renderInline(c as InlineNode, `${keyPrefix}:${i}`))}
        </a>
      ) : (
        node.children.map((c, i) => renderInline(c as InlineNode, `${keyPrefix}:${i}`))
      )}
    </span>
  )
}

const renderBlock = (block: BlockNode, keyPrefix: string): React.ReactNode => {
  const children = (block.children as InlineNode[]).map((c, i) =>
    renderInline(c, `${keyPrefix}:${i}`),
  )
  switch (block.type) {
    case "heading": {
      const Tag = (block.tag === "h1" ? "h1" : block.tag === "h2" ? "h2" : block.tag === "h3" ? "h3" : "h3") as "h1" | "h2" | "h3"
      return <Tag key={keyPrefix} className="flow-row-heading">{children}</Tag>
    }
    case "quote":
      return <blockquote key={keyPrefix}>{children}</blockquote>
    case "listitem": {
      const checked = block.checked ?? false
      return (
        <span key={keyPrefix} className="flow-row-todo">
          <span className={`flow-todo-mark${checked ? " done" : ""}`} aria-checked={checked} role="checkbox" />
          {children}
        </span>
      )
    }
    default:
      return <span key={keyPrefix}>{children}</span>
  }
}

export interface StaticRenderProps {
  /** 未经校验的 Lexical JSON（来自 Dexie）。 */
  raw: unknown
  fallbackText?: string
  className?: string
}

/**
 * 静态行渲染入口。校验失败时降级为纯文本（fallbackText 或 JSON 递归提取），
 * 保证「丢样式不丢内容」。
 */
export function StaticContent({ raw, fallbackText, className }: StaticRenderProps) {
  const validated = validateContent(raw)
  if (validated) {
    return (
      <div className={className}>
        {validated.root.children.map((block, i) =>
          "children" in block ? (
            renderBlock(block as BlockNode, `b${i}`)
          ) : (
            <span key={`b${i}`}>{renderInline(block as InlineNode, `b${i}`)}</span>
          ),
        )}
      </div>
    )
  }
  const text =
    fallbackText ?? (raw !== null && typeof raw === "object" && "root" in (raw as object)
      ? extractTextDeep((raw as { root: unknown }).root)
      : String(fallbackText ?? ""))
  return <div className={className}>{text}</div>
}

/** 子集外语法的兜底纯文本提取（宽松遍历，不抛错）。 */
const extractTextDeep = (node: unknown): string => {
  if (typeof node === "string") return node
  if (Array.isArray(node)) return node.map(extractTextDeep).join("")
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>
    if (typeof obj.text === "string") return obj.text
    if (obj.children) return extractTextDeep(obj.children)
  }
  return ""
}

export { lexicalToText }
