/**
 * Seed 常量 — fixture 契约（冻结）
 *
 * 配比来源：issue #2 决策记录第 7 条（2026-09 定稿）。
 * **本文件即冻结契约**：任何改动必须重跑全部性能门禁（架构 §14）。
 * 数值语义详见同目录 `seedGenerator.ts` 的使用方式。
 */

/** 目标节点总数（含 tombstone）。 */
export const TARGET_NODE_COUNT = 100_000

/** 生成内容的目标体积：Lexical JSON 序列化后的 UTF-8 字节。 */
export const TARGET_BYTES = 50 * 1024 * 1024
export const BYTE_TOLERANCE = 0.05 // ±5%

/**
 * 冻结密度（架构 §14.1）：每节点平均字节数 = 50MB / 100k ≈ 524 B。
 * 小规模测试用例必须按此密度等比缩放 targetBytes，否则会要求超出
 * 冻结字符范围（TEXT/LONG_TEXT/NOTE_CHAR_RANGE）产能的密度 —— 这曾导致
 * 旧实现用单节点超限 4800 倍的方式硬凑体积（issue #2 已修 bug）。
 */
export const TARGET_BYTES_PER_NODE = TARGET_BYTES / TARGET_NODE_COUNT

/**
 * 单节点字节占总量上限（守卫不变量）。
 * 真实使用中不存在超大节点；任何节点超过此比例即视为生成器回归。
 */
export const MAX_NODE_BYTE_SHARE = 0.01

/** 深度分布：深度 1–3 占 40%、4–6 占 40%、7–10 占 20%（最深 12）。 */
export const DEPTH_BANDS = [
  { minDepth: 1, maxDepth: 3, weight: 0.4 },
  { minDepth: 4, maxDepth: 6, weight: 0.4 },
  { minDepth: 7, maxDepth: 10, weight: 0.2 },
] as const
export const MAX_DEPTH = 12

/** 子节点数：众数 0–5；300 个宽分支 ≥100 子；10 个 ≥1000 子。 */
export const WIDE_BRANCH_MIN_CHILDREN = 100
export const WIDE_BRANCH_COUNT = 300
export const HUGE_BRANCH_MIN_CHILDREN = 1000
export const HUGE_BRANCH_COUNT = 10
export const COMMON_CHILDREN_RANGE = [0, 5] as const

/**
 * 节点类型配比：bullet 70% / paragraph 15% / todo 10% / 其余 5%。
 * 「其余」在 h1/h2/h3/quote 间均分（spec 未细分）。
 */
export const TYPE_RATIOS = {
  bullet: 0.7,
  paragraph: 0.15,
  todo: 0.1,
  other: 0.05,
} as const
/** todo 中已完成的比例。 */
export const TODO_COMPLETED_RATIO = 0.3

/** 语言配比：中文 60% / 英文 30% / emoji 10%。 */
export const LANGUAGE_RATIOS = { chinese: 0.6, english: 0.3, emoji: 0.1 } as const

/** 行内与字段特性配比。 */
export const LONG_TEXT_RATIO = 0.05
export const INLINE_FORMAT_RATIO = 0.2 // 行内格式标题占比
export const LINK_RATIO = 0.05
export const INLINE_CODE_RATIO = 0.05
export const NOTE_RATIO = 0.3
export const TAG_RATIO = 0.1
export const DATE_RATIO = 0.05
export const COLLAPSED_RATIO = 0.2
export const TOMBSTONE_RATIO = 0.02

/** 日期分隔符：- / . 三种（架构 §11.3）。 */
export const DATE_SEPARATORS = ["-", "/", "."] as const

/** 长文本段长度范围（字符数）。 */
export const LONG_TEXT_CHAR_RANGE = [400, 1200] as const

/** 普通文本长度范围（字符数），用于标题/备注正文。 */
export const TEXT_CHAR_RANGE = [2, 24] as const

/**
 * 备注长度范围（字符数）。
 * 决策记录第 7 条冻结「备注存在率 30%」并约定备注正文 20–500 字；
 * 本次显式编码为常量，作为生成与守卫测试的共同依据。
 */
export const NOTE_CHAR_RANGE = [20, 500] as const
