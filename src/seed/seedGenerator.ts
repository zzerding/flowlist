import { generateNKeysBetween } from "fractional-indexing"

import {
  BYTE_TOLERANCE,
  COLLAPSED_RATIO,
  DATE_RATIO,
  DATE_SEPARATORS,
  DEPTH_BANDS,
  HUGE_BRANCH_COUNT,
  HUGE_BRANCH_MIN_CHILDREN,
  INLINE_CODE_RATIO,
  INLINE_FORMAT_RATIO,
  LANGUAGE_RATIOS,
  LINK_RATIO,
  LONG_TEXT_CHAR_RANGE,
  LONG_TEXT_RATIO,
  NOTE_CHAR_RANGE,
  NOTE_RATIO,
  TAG_RATIO,
  TARGET_BYTES,
  TARGET_NODE_COUNT,
  TEXT_CHAR_RANGE,
  TODO_COMPLETED_RATIO,
  TOMBSTONE_RATIO,
  WIDE_BRANCH_COUNT,
  WIDE_BRANCH_MIN_CHILDREN,
} from "./seedConstants"
import type { InlineNode, LexicalContent, NodeRecord } from "../domain/nodeRecord"
import { lexicalToText } from "../domain/nodeRecord"

/**
 * 确定性 seed 生成器（决策记录第 7 条冻结配比）。
 *
 * 契约：
 * - 配比（深度、宽/巨分支、类型、语言、行内特性、tombstone）按常量文件冻结执行；
 * - 体积：Lexical JSON 序列化 UTF-8 字节 = targetBytes ±5%；
 * - 生成器末尾断言体积，文本长度由体积契约反推（每节点字节预算），
 *   冻结的是「形态比例」而非绝对文本长度。
 */

/** 可复现的 PRNG（mulberry32）：seed 相同则输出一致。 */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number

const pick = <T>(rand: Rand, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)]!

const intBetween = (rand: Rand, min: number, max: number): number =>
  min + Math.floor(rand() * (max - min + 1))

/** 按累计权重选择。 */
const weightedPick = <T>(rand: Rand, entries: ReadonlyArray<readonly [T, number]>): T => {
  let roll = rand()
  for (const [value, weight] of entries) {
    roll -= weight
    if (roll < 0) return value
  }
  return entries[entries.length - 1]![0]
}

const CHINESE_WORDS = [
  "会议纪要", "季度目标", "产品路线", "用户调研", "读书笔记",
  "周计划", "灵感片段", "待办事项", "项目复盘", "思维导图",
  "关键结论", "风险清单", "落地步骤", "评审意见", "迭代回顾",
]
const ENGLISH_WORDS = [
  "roadmap", "meeting notes", "quarterly goals", "research",
  "checklist", "weekly plan", "ideas", "retrospective",
  "key findings", "action items", "risks", "next steps",
]
const EMOJI = ["📌", "🚀", "✅", "💡", "🔥", "🌟", "📝", "🎯", "⚡", "🧠"]
const TAGS = ["#工作", "#灵感", "#todo", "#project", "#重要"]

/** 深度带选择（冻结：1–3 40%、4–6 40%、7–10 20%）。 */
const depthTarget = (rand: Rand): number => {
  const band = weightedPick(
    rand,
    DEPTH_BANDS.map((b) => [b, b.weight] as const),
  )
  return intBetween(rand, band.minDepth, band.maxDepth)
}

/** 语言配比（冻结：中 60% / 英 30% / emoji 10%）。 */
const pickLanguage = (rand: Rand): "zh" | "en" | "emoji" =>
  weightedPick(rand, [
    ["zh", LANGUAGE_RATIOS.chinese],
    ["en", LANGUAGE_RATIOS.english],
    ["emoji", LANGUAGE_RATIOS.emoji],
  ] as const)

/** 按目标字符数造一段文本（语言按冻结配比）。 */
const makeTextOfLength = (rand: Rand, charLen: number): string => {
  const lang = pickLanguage(rand)
  switch (lang) {
    case "zh": {
      let out = ""
      while (out.length < charLen) out += pick(rand, CHINESE_WORDS)
      return out.slice(0, charLen)
    }
    case "en": {
      let out = ""
      while (out.length < charLen) out += (out ? " " : "") + pick(rand, ENGLISH_WORDS)
      return out.slice(0, charLen)
    }
    case "emoji": {
      let out = ""
      while (out.length < charLen) out += pick(rand, EMOJI)
      return out.slice(0, charLen)
    }
  }
}

const makeDate = (rand: Rand): string => {
  const sep = pick(rand, DATE_SEPARATORS)
  const y = 2024 + Math.floor(rand() * 3)
  const m = String(1 + Math.floor(rand() * 12)).padStart(2, "0")
  const d = String(1 + Math.floor(rand() * 28)).padStart(2, "0")
  return `${y}${sep}${m}${sep}${d}`
}

/** 组装一个块的行内 children（行内格式/链接/代码/标签/日期按冻结配比）。 */
const makeInlineChildren = (rand: Rand, text: string, isTitle: boolean): InlineNode[] => {
  const children: InlineNode[] = []
  const applyFormat = isTitle && rand() < INLINE_FORMAT_RATIO
  const format = applyFormat ? pick(rand, [1, 2, 16, 32] as const) : 0 // bold/italic/strike/code
  const parts: string[] = [text]
  if (rand() < TAG_RATIO) parts.push(" " + pick(rand, TAGS))
  if (rand() < DATE_RATIO) parts.push(" " + makeDate(rand))

  const rest = parts.join("")
  if (rand() < LINK_RATIO) {
    const linkText = makeTextOfLength(rand, Math.min(8, text.length || 8))
    children.push({
      type: "link",
      version: 1,
      url: `https://example.com/${Math.floor(rand() * 1e9)}`,
      children: [{ type: "text", version: 1, text: linkText }],
    })
  }
  if (rand() < INLINE_CODE_RATIO) {
    children.push({ type: "text", version: 1, text: rest, format: 16 })
    children.push({ type: "text", version: 1, text: "code_snippet()", format: 16 })
    return children
  }
  children.push({ type: "text", version: 1, text: rest, format })
  return children
}

type NodeType = NodeRecord["type"]

/** 节点类型配比（冻结：bullet 70 / paragraph 15 / todo 10 / 其余 5）。 */
const pickType = (rand: Rand): NodeType =>
  weightedPick(rand, [
    ["bullet", 0.7],
    ["paragraph", 0.15],
    ["todo", 0.1],
    ["h1", 0.017],
    ["h2", 0.017],
    ["h3", 0.016],
  ] as const)

const makeBlock = (rand: Rand, type: NodeType, text: string): InlineNodeContainer => {
  switch (type) {
    case "h1":
    case "h2":
    case "h3":
      return {
        type: "heading",
        version: 1,
        tag: type,
        children: makeInlineChildren(rand, text, true),
      }
    case "quote":
      return { type: "quote", version: 1, children: makeInlineChildren(rand, text, false) }
    case "todo":
      return {
        type: "listitem",
        version: 1,
        checked: rand() < TODO_COMPLETED_RATIO,
        children: makeInlineChildren(rand, text, false),
      }
    default:
      return { type: "paragraph", version: 1, children: makeInlineChildren(rand, text, false) }
  }
}

interface InlineNodeContainer {
  type: string
  version: number
  tag?: string
  checked?: boolean | null
  children: InlineNode[]
}

export interface SeedOptions {
  /** PRNG 种子，默认 20260910。 */
  seed?: number
  /** 覆盖目标节点数（测试用）。 */
  nodeCount?: number
  /** 覆盖目标体积（UTF-8 字节；测试用）。 */
  targetBytes?: number
}

export interface SeedResult {
  nodes: NodeRecord[]
  /** 序列化 Lexical JSON 的 UTF-8 字节总量。 */
  bytes: number
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length

/**
 * 生成确定性 seed。
 *
 * 体积契约（末尾断言）：所有 title/note 的 Lexical JSON 序列化后
 * UTF-8 字节总量 = targetBytes ±5%。文本长度由契约反推。
 */
export const generateSeed = (options: SeedOptions = {}): SeedResult => {
  const rand = mulberry32(options.seed ?? 20260910)
  const targetCount = options.nodeCount ?? TARGET_NODE_COUNT
  const targetBytes = options.targetBytes ?? TARGET_BYTES

  const ROOT_ID = "root"
  const now = Date.UTC(2026, 8, 10)

  // —— 第一遍：确定结构（节点数、父子关系），不含内容 ——
  // 宽/巨分支是结构需求；小规模生成时按节点数比例缩放（保持形态配比），
  // 但完整规模（默认 100k）下为冻结常量。
  const scale = Math.min(1, targetCount / TARGET_NODE_COUNT)
  const wideCount = Math.max(1, Math.round(WIDE_BRANCH_COUNT * scale))
  const hugeCount = Math.max(0, Math.round(HUGE_BRANCH_COUNT * scale))
  const minDepth1 = wideCount + hugeCount
  const nodesAtDepth = new Map<number, string[]>()
  nodesAtDepth.set(0, [ROOT_ID])

  const structure: Array<{ id: string; parentId: string; depth: number }> = []
  let nextId = minDepth1

  // depth1 宿主占位（宽/巨分支宿主）
  for (let i = 0; i < minDepth1; i++) {
    structure.push({ id: `n${i}`, parentId: ROOT_ID, depth: 1 })
    const siblings = nodesAtDepth.get(1) ?? []
    siblings.push(`n${i}`)
    nodesAtDepth.set(1, siblings)
  }

  const countsAtDepth = new Map<number, number>()
  const countFor = (depth: number): number => countsAtDepth.get(depth) ?? 0

  const totalWideChildren = wideCount * WIDE_BRANCH_MIN_CHILDREN
  const totalHugeChildren = hugeCount * HUGE_BRANCH_MIN_CHILDREN
  // 主循环节点数 = targetCount - 宽/巨分支预留（避免总量失控）；
  // 若 targetCount 不足以容纳结构需求，结构优先（体积按实际节点数收敛）。
  const reservedForBranches = totalWideChildren + totalHugeChildren
  const mainLoopCount = Math.max(minDepth1, targetCount - reservedForBranches)

  while (structure.length < mainLoopCount) {
    const depth = Math.max(1, depthTarget(rand))
    let parentCandidates = nodesAtDepth.get(depth - 1)
    if (!parentCandidates || parentCandidates.length === 0) parentCandidates = [ROOT_ID]
    const parentId = pick(rand, parentCandidates)
    const id = `n${nextId++}`
    structure.push({ id, parentId, depth })
    const siblings = nodesAtDepth.get(depth) ?? []
    siblings.push(id)
    nodesAtDepth.set(depth, siblings)
    countsAtDepth.set(depth, countFor(depth) + 1)
  }

  // 宽/巨分支子节点
  const depth1Ids = nodesAtDepth.get(1)!.slice(0, minDepth1)
  const wideHosts = depth1Ids.slice(0, wideCount)
  const hugeHosts = depth1Ids.slice(wideCount)
  const childCountByParent = new Map<string, number>()
  for (const s of structure) {
    childCountByParent.set(s.parentId, (childCountByParent.get(s.parentId) ?? 0) + 1)
  }
  for (const hostId of [...wideHosts, ...hugeHosts]) {
    const minChildren = hugeHosts.includes(hostId)
      ? HUGE_BRANCH_MIN_CHILDREN
      : WIDE_BRANCH_MIN_CHILDREN
    let childCount = childCountByParent.get(hostId) ?? 0
    while (childCount < minChildren) {
      const id = `n${nextId++}`
      structure.push({ id, parentId: hostId, depth: 2 })
      childCount++
      childCountByParent.set(hostId, childCount)
    }
  }

  // tombstone 名单（冻结：2%）
  const tombstoneCount = Math.floor(structure.length * TOMBSTONE_RATIO)
  const tombstoneIds = new Set<string>()
  while (tombstoneIds.size < tombstoneCount) {
    tombstoneIds.add(structure[Math.floor(rand() * structure.length)]!.id)
  }

  // —— 第二遍：按体积契约分配内容字节预算 ——
  // 预算守恒：普通节点拿 n 字节，长文本节点拿 k×n（长文本溢价 k=10），
  // nodes×(1-r)×n + nodes×r×k×n = targetBytes → n = targetBytes / (nodes×(1-r+r×k))。
  // JSON 结构开销（类型标签等）≈ 200B/节点，从文本预算中扣除。
  //
  // 注意：预算只是**初值**，随后会被钳制进冻结的字符范围；总字节缺口由
  // 第三遍校准按冻结范围轮转吸收（绝不允许堆进单节点）。
  const STRUCTURE_OVERHEAD_BYTES = 200
  const totalNodes = structure.length
  const LONG_TEXT_PREMIUM = 10
  const usableBytes = Math.max(0, targetBytes - totalNodes * STRUCTURE_OVERHEAD_BYTES)
  const normalBudget = usableBytes /
    (totalNodes * (1 - LONG_TEXT_RATIO + LONG_TEXT_RATIO * LONG_TEXT_PREMIUM))
  const longTextBudget = normalBudget * LONG_TEXT_PREMIUM

  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value))

  type MutableNode = {
    -readonly [K in keyof NodeRecord]: NodeRecord[K]
  }

  const nodes: MutableNode[] = []
  // 长文本标题节点（校准第二梯队：备注耗尽后仍不足时按冻结范围增长）
  const longTextIds = new Set<string>()
  let created = 0

  for (const s of structure) {
    const type = pickType(rand)
    const isLongText = rand() < LONG_TEXT_RATIO
    const budget = isLongText ? longTextBudget : normalBudget
    // 字节数 → 字符数：中文 ≈3 字节/字，混合场景按 2.5 估算
    const budgetChars = Math.floor(budget / 2.5)
    // 所有文本长度一律钳制进冻结字符范围（旧实现的单节点 13MB 即越界所致）
    const text = isLongText
      ? makeTextOfLength(rand, clamp(budgetChars, LONG_TEXT_CHAR_RANGE[0], LONG_TEXT_CHAR_RANGE[1]))
      : makeTextOfLength(
          rand,
          intBetween(rand, TEXT_CHAR_RANGE[0], TEXT_CHAR_RANGE[1]),
        )
    if (isLongText) longTextIds.add(s.id)

    const titleBlock = makeBlock(rand, type, text)
    const title = { root: { type: "root" as const, version: 1, children: [titleBlock] } }

    let note: LexicalContent | undefined
    if (rand() < NOTE_RATIO) {
      const noteChars = clamp(
        Math.floor(budgetChars * 0.3),
        NOTE_CHAR_RANGE[0],
        NOTE_CHAR_RANGE[1],
      )
      const noteText = makeTextOfLength(rand, noteChars)
      note = {
        root: {
          type: "root",
          version: 1,
          children: [
            { type: "paragraph", version: 1, children: makeInlineChildren(rand, noteText, false) },
          ],
        },
      }
    }

    const node: MutableNode = {
      id: s.id,
      parentId: s.parentId,
      orderKey: "",
      type,
      title: title as LexicalContent,
      note,
      titleText: lexicalToText(title as LexicalContent),
      noteText: note ? lexicalToText(note) : "",
      completed: type === "todo" && rand() < TODO_COMPLETED_RATIO,
      collapsed: s.depth > 0 && rand() < COLLAPSED_RATIO,
      revision: 1,
      createdAt: now + created,
      updatedAt: now + created,
      ...(tombstoneIds.has(s.id) ? { tombstonedAt: now + 1 } : {}),
    }
    nodes.push(node)
    created++
  }

  // orderKey：同级按生成顺序
  const byParent = new Map<string, MutableNode[]>()
  for (const node of nodes) {
    const group = byParent.get(node.parentId) ?? []
    group.push(node)
    byParent.set(node.parentId, group)
  }
  for (const group of byParent.values()) {
    const keys = generateNKeysBetween(null, null, group.length)
    group.forEach((node, i) => {
      node.orderKey = keys[i]!
    })
  }

  // —— 第三遍：体积校准 ——
  const contentBytesOf = (n: MutableNode): number =>
    utf8Bytes(JSON.stringify(n.title)) + (n.note ? utf8Bytes(JSON.stringify(n.note)) : 0)

  let bytes = 0
  for (const n of nodes) bytes += contentBytesOf(n)

  const tolerance = Math.floor(targetBytes * BYTE_TOLERANCE)
  const minBytes = targetBytes - tolerance
  const maxBytes = targetBytes + tolerance
  // 目标锚在中值而非下边界：冻结字符范围钳制后总量偏小，向上补齐到中值，
  // 上下各留一半容差，避免贴着 minBytes 抖动。
  const aimBytes = targetBytes

  // 补齐：所有文本长度被冻结字符范围钳制后总量会偏小，这里均匀分摊吸收缺口。
  // 旧实现把整个缺口塞进第一个节点（n0 曾达 13MB / 5.8M 字符，超冻结上限 4800 倍），
  // 而 n0 正是首屏第一行，导致首屏渲染主线程阻塞 ~103s。
  //
  // 守恒约束：不改变冻结配比——只动**已有备注**的节点（NOTE_RATIO 不变），
  // 备注全部拉满后仍不足才动**已有长文本**标题（LONG_TEXT_RATIO 不变）。
  // 每轮**全体同步**增长（不用 break 提前退出，否则只有前几个节点变大、
  // 分布双峰），单节点始终受冻结上限约束。
  const noteNodes = nodes.filter((n) => n.note !== undefined)
  const longTextNodes = nodes.filter((n) => longTextIds.has(n.id))

  const rewriteNote = (node: MutableNode, chars: number): void => {
    const text = makeTextOfLength(rand, chars)
    node.note = {
      root: {
        type: "root",
        version: 1,
        children: [
          { type: "paragraph", version: 1, children: makeInlineChildren(rand, text, false) },
        ],
      },
    }
    node.noteText = text
  }

  const rewriteLongTextTitle = (node: MutableNode, chars: number): void => {
    const title = {
      root: {
        type: "root" as const,
        version: 1,
        children: [makeBlock(rand, node.type, makeTextOfLength(rand, chars))],
      },
    }
    node.title = title as LexicalContent
    node.titleText = lexicalToText(title as LexicalContent)
  }

  /** 把一个字段的长度整体拉高（全体同步、均匀，单节点受冻结上限约束）。 */
  const growField = (
    targets: MutableNode[],
    maxChars: number,
    readChars: (n: MutableNode) => number,
    rewrite: (n: MutableNode, chars: number) => void,
  ): void => {
    for (let pass = 0; pass < 6 && bytes < aimBytes; pass++) {
      const deficit = aimBytes - bytes
      const growable = targets.filter((n) => readChars(n) < maxChars)
      if (growable.length === 0) break
      // 中文约 3 字节/字；取全体统一的字符增量，统一施加（保持分布形状）
      const step = Math.max(1, Math.ceil(deficit / growable.length / 3))
      for (const node of growable) {
        const next = Math.min(maxChars, readChars(node) + step)
        if (next <= readChars(node)) continue
        const before = contentBytesOf(node)
        rewrite(node, next)
        bytes += contentBytesOf(node) - before
      }
    }
  }

  if (bytes < aimBytes) {
    growField(noteNodes, NOTE_CHAR_RANGE[1], (n) => (n.noteText ?? "").length, rewriteNote)
    growField(longTextNodes, LONG_TEXT_CHAR_RANGE[1], (n) => n.titleText.length, rewriteLongTextTitle)
  }

  if (bytes < minBytes || bytes > maxBytes) {
    throw new Error(
      `seed 体积契约不满足：${bytes} bytes（目标 ${minBytes}–${maxBytes}，节点数 ${totalNodes}）`,
    )
  }

  return { nodes: nodes as NodeRecord[], bytes }
}
