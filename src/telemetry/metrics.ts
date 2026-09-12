/**
 * 性能埋点收集器（决策记录「测量契约」）。
 *
 * 埋点清单（mark / measure 名称表）：
 * - mark  `flowlist:init`           — 应用初始化（init script / main 顶部）
 * - mark  `flowlist:first-editable` — 首行 contenteditable 可编辑
 * - measure `flowlist:startup`      — init → first-editable
 * - measure `flowlist:save`         — 编辑补丁命令发起 → Dexie 确认
 * - measure `flowlist:search`       — 搜索请求发起 → 索引结果 resolve
 * - measure `flowlist:structure`    — 结构命令（新增/删除/移动）发起 → 确认
 *
 * 输入/IME 使用浏览器原生 PerformanceEventTiming（duration），
 * 通过 observer 聚合到 `eventTimings`。
 *
 * 指标读取入口（Playwright 断言接缝）：window.__flowlistMetrics（只读快照）。
 */

export interface MetricSample {
  name: string
  durationMs: number
  timestamp: number
}

export interface MetricsSnapshot {
  /** performance.measure 采样（save/search/structure/startup）。 */
  measures: MetricSample[]
  /** PerformanceEventTiming duration 采样（输入/IME）。 */
  eventTimings: number[]
  startupMs: number | null
}

const measureSamples: MetricSample[] = []
const eventTimingSamples: number[] = []
let startupMs: number | null = null
let eventTimingObserverStarted = false

const MAX_SAMPLES = 2000

export const mark = (name: string): void => {
  if (typeof performance !== "undefined") performance.mark(name)
}

export const measure = (name: string, startMark: string, endMark?: string): void => {
  if (typeof performance === "undefined") return
  const end = endMark ?? `${name}:end`
  let duration: number | undefined
  try {
    performance.mark(end)
    const perfMeasure = performance.measure(name, startMark, end)
    duration = perfMeasure?.duration
  } catch {
    return
  }
  if (duration === undefined) {
    const entries = performance.getEntriesByName(name)
    const last = entries[entries.length - 1]
    duration = last?.duration
  }
  if (duration !== undefined) {
    measureSamples.push({
      name,
      durationMs: duration,
      timestamp: performance.now(),
    })
    if (measureSamples.length > MAX_SAMPLES) measureSamples.shift()
  }
  performance.clearMarks(endMark ?? end)
  performance.clearMeasures(name)
}

/** 开始收集 PerformanceEventTiming（输入/IME duration）。 */
export const startEventTimingCollection = (): void => {
  if (eventTimingObserverStarted || typeof PerformanceObserver === "undefined") return
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const det = entry as PerformanceEventTiming
        if (det.name === "keydown" || det.name === "compositionend" || det.name === "input" || det.name === "beforeinput") {
          eventTimingSamples.push(det.duration)
          if (eventTimingSamples.length > MAX_SAMPLES) eventTimingSamples.shift()
        }
      }
    })
    // durationThreshold 16ms：Chromium 默认仅暴露 ≥104ms 的事件（spec 下限 16ms），
    // 不设阈值则 16ms 级输入完全不产生样本，输入门禁无法按测量契约采样。
    observer.observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit)
    eventTimingObserverStarted = true
  } catch {
    // PerformanceEventTiming 不可用时静默降级（不影响功能）
  }
}

/** 记录启动耗时（init mark → 首行可编辑）。 */
export const recordStartup = (initMark = "flowlist:init"): void => {
  measure("flowlist:startup", initMark, "flowlist:first-editable")
  const entries = performance.getEntriesByName("flowlist:startup")
  const last = entries[entries.length - 1]
  if (last) startupMs = last.duration
}

/** 只读快照：Playwright 通过 window.__flowlistMetrics 断言。 */
export const snapshotMetrics = (): MetricsSnapshot => ({
  measures: [...measureSamples],
  eventTimings: [...eventTimingSamples],
  startupMs,
})

/** P 值计算（tester 侧也可以自行算，这里提供 helper）。 */
export const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]!
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __flowlistMetrics?: any
  }
}

/** 在浏览器挂只读指标入口。 */
export const installMetricsWindow = (): void => {
  if (typeof window !== "undefined") {
    window.__flowlistMetrics = {
      snapshot: snapshotMetrics,
      percentile,
    }
  }
}
