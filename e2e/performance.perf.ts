import { expect, test } from "@playwright/test"

import { buildSeedScript } from "./seedFixture"

/**
 * S1 性能原型门禁(架构 §14.2/§14.3,issue #2 测量契约)。
 *
 * 数据源:window.__flowlistMetrics.snapshot()(实现侧埋点)+ 测试侧黑盒 rAF 输入延迟采样。
 * 门禁为绝对值,50 样本 P95;样本不足时循环执行补足。
 *
 * skipped(原型未实现对应命令,flowlist:structure 无数据源):
 * - 新增/普通删除/移动 P95 ≤50ms
 * - 大子树逻辑删除或移动 P95 ≤50ms
 */

const SEED_OPTIONS = { nodeCount: 100_000, targetBytes: 50 * 1024 * 1024 }
// SMOKE-MODE

type Snapshot = {
  measures: Array<{ name: string; durationMs: number }>
  eventTimings: number[]
  startupMs: number | null
}

/**
 * 选中一个「文本较短」的静态行激活。
 * 校准节点(seed 体积补齐追加超长段落)激活时编辑器行高暴涨,会导致滚动跳变与主线程长任务,
 * 不适合作为输入/启动采样对象;链接节点在原型中亦会触发 Lexical 节点未注册错误(见测试报告)。
 * 黑盒过滤:textContent 长度 2–80 的行。
 */
const findCalmRowIndex = (page: import("@playwright/test").Page): Promise<number> =>
  page.locator(".flow-row-static").evaluateAll((rows) =>
    rows.findIndex((r) => {
      const t = r.textContent ?? ""
      return t.length >= 2 && t.length <= 80
    }),
  )

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)] ?? Number.NaN
}

const collect = (page: import("@playwright/test").Page, name: string, minSamples: number): Promise<number[]> =>
  page.evaluate(
    ({ name, minSamples }) => {
      const snap = (
        window as unknown as { __flowlistMetrics?: { snapshot: () => Snapshot } }
      ).__flowlistMetrics
      return (snap?.snapshot().measures ?? [])
        .filter((m) => m.name === name)
        .map((m) => m.durationMs)
        .slice(0, minSamples)
    },
    { name, minSamples },
  )

test.describe("S1 性能门禁", () => {
  // 50 样本轮次每轮含 100k 数据加载（秒级）× reload，总耗时超过 10min，
  // 放宽到 30min（测量 harness 配置，非门禁阈值）。
  test.setTimeout(1_800_000)

  // 基准测试不在每次 e2e 中执行(全量 100k/50MB 单套 ~10min,启动门禁单样本 ~100s)。
  // 默认 `pnpm e2e` 跳过门禁只跑 acceptance 冒烟;
  // 正式门禁判定:PERF_FULL=1 pnpm e2e --project=performance(见 e2e/README.md)。
  test.beforeEach(() => {
    test.skip(
      !process.env.PERF_FULL,
      "性能门禁为按需执行:PERF_FULL=1 pnpm e2e --project=performance",
    )
  })

  const prepare = async (page: import("@playwright/test").Page): Promise<void> => {
    // Playwright 默认每 test 新 context:localStorage/IndexedDB 均为空。
    // 不能用模块级 flag 判断「已 seed」—— 那会导致后续 test 等一个永远不会出现的哨兵值。
    // 每个 test 都注入 seed 脚本,由 seedEntry 的 localStorage 守卫在同 context 内去重:
    // 首次导航真写数据,page.reload() 及后续导航复用已持久化数据。
    await page.addInitScript(buildSeedScript(SEED_OPTIONS))
    await page.goto("/")
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__flowlistSeedCount !== undefined,
      { timeout: 300_000 },
    )
    {
      // seed 哨兵为 -1 表示守卫命中(复用已有数据),无需 reload 重建;
      // 否则说明本轮真写了数据,刷新一次让应用从已持久化的库启动(贴近真实已缓存启动)。
      const seedCount = await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__flowlistSeedCount,
      )
      if (seedCount !== -1) {
        await page.reload()
      }
    }
    await page.waitForFunction(
      () => Number(document.querySelector("[data-testid='loaded-count']")?.textContent) > 0,
      { timeout: 120_000 },
    )
  }

  test("启动到首屏可编辑 P95 ≤1s(50 样本)", async ({ page }) => {
    await prepare(page)
    // 首屏默认可编辑入口已实现（幽灵活动行，修复项 4）：加载后无需任何交互，
    // recordStartup 即在 ghost 编辑器挂载时结算 flowlist:startup。
    // （原流程每轮点击 rows[1] 触发编辑器挂载，是「无默认可编辑入口」时的
    // 临时采样手段；rows[1] 是 seed 校准节点，点击会触发分钟级主线程阻塞，
    // 详见 e2e/README.md 坑 2 —— 该 workaround 随修复移除。）
    const samples: number[] = []
    const ROUNDS = 50
    const MAX_ROUNDS = 80 // 允许少量轮次未产生样本(编辑器未挂载等),补足 50 样本
    for (let i = 0; i < MAX_ROUNDS && samples.length < ROUNDS; i++) {
      await page.reload()
      await page.waitForFunction(
        () => Number(document.querySelector("[data-testid='loaded-count']")?.textContent) > 0,
        { timeout: 120_000 },
      )
      await page
        .waitForFunction(
          () =>
            (window as unknown as Record<string, { snapshot: () => Snapshot }>)
              .__flowlistMetrics?.snapshot().measures.some((m) => m.name === "flowlist:startup") ??
            false,
          { timeout: 240_000 },
        )
      const all = await collect(page, "flowlist:startup", 500)
      // 每轮 reload 后页面指标清零(reload 重置 JS 状态),本轮应有恰好一条新样本
      if (all.length > 0) samples.push(all[all.length - 1]!)
      if (samples.length >= ROUNDS) break
    }
    expect(samples.length).toBeGreaterThanOrEqual(50)
    const p50 = percentile(samples, 50)
    const p95 = percentile(samples, 95)
    console.log(`[startup] n=${samples.length} P50=${p50.toFixed(1)}ms P95=${p95.toFixed(1)}ms`)
    expect(p95).toBeLessThanOrEqual(1_000)
  })

  test("保存确认 P95 ≤200ms(50 样本)", async ({ page }) => {
    await prepare(page)
    // 激活一行后连续输入:每次 keystroke 触发一次 flowlist:save(命令发起→Dexie 确认)
    const calmIdx = await findCalmRowIndex(page)
    await page.locator(".flow-row-static").nth(Math.max(calmIdx, 0)).click()
    await page.waitForTimeout(500)
    const editor = page.locator("[data-testid='active-editor']")
    await editor.click()
    // 样本足够：逐键输入。实现侧编辑补丁按架构 §9 合并窗口（100ms）提交，
    // 连续无间隔输入会合并为一次提交；键间加 150ms 间隔让每键独立成命令，
    // 一轮 60 键即产出 ≥50 个 save 样本（pacing 调整，非门禁阈值变更）。
    const typeKeys = async (): Promise<void> => {
      for (let i = 0; i < 30; i++) {
        await page.keyboard.type("测")
        await page.waitForTimeout(150)
        await page.keyboard.press("Backspace")
        await page.waitForTimeout(150)
      }
    }
    await typeKeys()
    let samples = await collect(page, "flowlist:save", 60)
    while (samples.length < 50) {
      await typeKeys()
      samples = await collect(page, "flowlist:save", 200)
    }
    samples = samples.slice(-60) // 近期样本(排除激活时的初始保存)
    const p50 = percentile(samples, 50)
    const p95 = percentile(samples, 95)
    console.log(`[save] n=${samples.length} P50=${p50.toFixed(1)}ms P95=${p95.toFixed(1)}ms`)
    expect(p95).toBeLessThanOrEqual(200)
  })

  test("搜索 P95 ≤100ms(50 样本)", async ({ page }) => {
    await prepare(page)
    const search = page.getByTestId("search-input")
    const runSearches = async (): Promise<void> => {
      for (const q of ["会议", "roadmap", "灵感", "notes", "目标", "review"]) {
        await search.fill(q)
        await page.waitForTimeout(60)
      }
      await search.fill("")
      await page.waitForTimeout(60)
    }
    await runSearches()
    let samples = await collect(page, "flowlist:search", 60)
    while (samples.length < 50) {
      await runSearches()
      samples = await collect(page, "flowlist:search", 200)
    }
    const recent = samples.slice(-60)
    const p50 = percentile(recent, 50)
    const p95 = percentile(recent, 95)
    console.log(`[search] n=${recent.length} P50=${p50.toFixed(1)}ms P95=${p95.toFixed(1)}ms`)
    expect(p95).toBeLessThanOrEqual(100)
  })

  test("连续输入延迟 P95 ≤16ms(ET durationThreshold=16 契约采样)", async ({ page }) => {
    await prepare(page)
    // 测量契约：输入用 PerformanceEventTiming duration。
    // 实现侧 metrics.ts 已设 durationThreshold: 16（Chromium 默认 104ms，
    // 16ms 级输入无样本，修复记录见 e2e/README.md）。注意 ET 只上报 ≥16ms
    // 的事件：样本集合即「≥16ms 的输入事件」，P95 ≤16 等价于
    // 「≥16ms 的事件中 ≥95% 不到 24ms」；完全无样本说明所有输入 <16ms。
    await page.locator(".flow-row-static").nth(await findCalmRowIndex(page)).click()
    await page.waitForTimeout(500)
    await page.locator("[data-testid='active-editor']").click()
    // 连续输入（不加人工间隔，与既有用例采样节奏一致）：逐键间隔 <16ms 时
    // 事件相位聚合，ET（durationThreshold=16，只上报 ≥16ms 的事件）样本集
    // 即「错过一帧绘制」的事件，更能反映真实最坏情况。
    for (let i = 0; i < 120; i++) {
      await page.keyboard.type("字")
      await page.keyboard.press("Backspace")
    }
    const samples = await page.evaluate(() =>
      (
        window as unknown as { __flowlistMetrics?: { snapshot: () => Snapshot } }
      ).__flowlistMetrics!.snapshot().eventTimings,
    )
    const recent = samples.slice(-200)
    const p50 = percentile(recent, 50)
    const p95 = percentile(recent, 95)
    console.log(`[typing ET] n=${recent.length} P50=${p50.toFixed(1)}ms P95=${p95.toFixed(1)}ms`)
    expect(recent.length).toBeGreaterThan(0)
    expect(p95).toBeLessThanOrEqual(16)
  })

  test("DOM 规模不随 100k 增长(多滚动位置断言)", async ({ page }) => {
    const t0 = Date.now()
    await prepare(page)
    console.log(`[dom] prepare_ms=${Date.now() - t0}`)
    const positions = [0, 0.25, 0.5, 0.75, 0.99]
    for (const frac of positions) {
      await page.getByTestId("outline-scroll").evaluate((el, f) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * f
      }, frac)
      await page.waitForTimeout(300)
      const count = await page.evaluate(() => document.querySelectorAll(".flow-row").length)
      const editables = await page.evaluate(
        () => document.querySelectorAll("[contenteditable='true']").length,
      )
      // 可视行 + overscan(8) 在 720p 视口下 ≤40 行;contenteditable 恒 ≤1(一票否决项)
      expect(count).toBeLessThan(60)
      expect(editables).toBeLessThanOrEqual(1)
    }
    // 总 DOM 节点数:与可视区域成正比,不随 100k 增长
    const total = await page.evaluate(() => document.querySelectorAll("*").length)
    expect(total).toBeLessThan(500)
  })
})
