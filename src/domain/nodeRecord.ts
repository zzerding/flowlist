import * as Schema from "effect/Schema"

/**
 * NodeRecord 领域模型（架构 §6.1）。
 * `title` / `note` 为 Lexical JSON，经 `LexicalContentSchema` 校验。
 */
export const NodeTypeSchema = Schema.Literals([
  "bullet",
  "h1",
  "h2",
  "h3",
  "paragraph",
  "quote",
  "todo",
])

/** Lexical JSON 子集 Schema（静态 renderer 接受的格式，超出子集丢样式不丢内容）。 */
export const SerializedTextNodeSchema = Schema.Struct({
  type: Schema.Literal("text"),
  version: Schema.Number,
  text: Schema.String,
  detail: Schema.optionalKey(Schema.Number),
  format: Schema.optionalKey(Schema.Number),
  mode: Schema.optionalKey(Schema.String),
  style: Schema.optionalKey(Schema.String),
})

export const SerializedElementNodeBase = {
  type: Schema.String,
  version: Schema.Number,
  direction: Schema.optionalKey(Schema.NullOr(Schema.String)),
  format: Schema.optionalKey(Schema.String),
  indent: Schema.optionalKey(Schema.Number),
  textFormat: Schema.optionalKey(Schema.Number),
  textStyle: Schema.optionalKey(Schema.String),
}

/** 行内链接节点（@lexical/link 子集）。 */
export const SerializedLinkNodeSchema = Schema.Struct({
  ...SerializedElementNodeBase,
  type: Schema.Literal("link"),
  url: Schema.String,
  rel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  target: Schema.optionalKey(Schema.NullOr(Schema.String)),
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  children: Schema.Array(Schema.Unknown),
})

/** 行内节点：文本或链接。其余行内类型降级为文本内容。 */
export const InlineNodeSchema = Schema.Union([
  SerializedTextNodeSchema,
  SerializedLinkNodeSchema,
])

/**
 * 块级子集：paragraph、heading（h1/h2/h3）、quote、listitem（todo/bullet 场景）。
 * 子节点为行内节点数组（原型不支持嵌套块级结构，嵌套块降级纯文本）。
 */
export const BlockNodeSchema = Schema.Struct({
  ...SerializedElementNodeBase,
  type: Schema.Literals(["paragraph", "heading", "quote", "listitem"]),
  tag: Schema.optionalKey(Schema.String),
  checked: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  value: Schema.optionalKey(Schema.Number),
  children: Schema.Array(InlineNodeSchema),
})

export const LexicalRootSchema = Schema.Struct({
  type: Schema.Literal("root"),
  version: Schema.Number,
  direction: Schema.optionalKey(Schema.NullOr(Schema.String)),
  format: Schema.optionalKey(Schema.String),
  indent: Schema.optionalKey(Schema.Number),
  children: Schema.Array(Schema.Union([BlockNodeSchema, InlineNodeSchema])),
})

/** 经 Schema 校验的 Lexical JSON（SerializedEditorState 的可接受子集）。 */
export const LexicalContentSchema = Schema.Struct({
  root: LexicalRootSchema,
})

export type LexicalContent = Schema.Schema.Type<typeof LexicalContentSchema>
export type BlockNode = Schema.Schema.Type<typeof BlockNodeSchema>
export type InlineNode = Schema.Schema.Type<typeof InlineNodeSchema>
export type SerializedTextNode = Schema.Schema.Type<typeof SerializedTextNodeSchema>

export const NodeRecordSchema = Schema.Struct({
  id: Schema.String,
  parentId: Schema.String,
  orderKey: Schema.String,
  type: NodeTypeSchema,
  title: LexicalContentSchema,
  note: Schema.optionalKey(LexicalContentSchema),
  titleText: Schema.String,
  noteText: Schema.optionalKey(Schema.String),
  completed: Schema.Boolean,
  collapsed: Schema.Boolean,
  revision: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  tombstonedAt: Schema.optionalKey(Schema.Number),
})

export type NodeRecord = Schema.Schema.Type<typeof NodeRecordSchema>

/** tombstone 判定：删除只写 tombstonedAt（架构 §9.3）。 */
export const isTombstoned = (node: NodeRecord): boolean =>
  node.tombstonedAt !== undefined

/** 从 Lexical JSON 提取纯文本（含链接子树）。 */
export const lexicalToText = (content: LexicalContent): string =>
  content.root.children
    .map((block: BlockNode | InlineNode) => {
      if ("children" in block) {
        return (block.children as InlineNode[])
          .map((inline) => ("text" in inline ? inline.text : inlineTextOf(inline)))
          .join("")
      }
      return inlineTextOf(block)
    })
    .join("\n")

const inlineTextOf = (node: InlineNode): string =>
  "text" in node
    ? node.text
    : (node.children as InlineNode[]).map((c) => inlineTextOf(c)).join("")
