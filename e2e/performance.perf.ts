import { expect, test } from "@playwright/test"

import { buildSeedScript } from "./seedFixture"

/**
 * S1 性能原型门禁（架构 §14.2/§14.3）。
 *
 * 本文件提供完整的测量 harness：
 * - addInitScript 真写 IndexedDB（决策记录第 4 条）；
 * - 通过 window.__flowlistMetrics 读取埋点（输入/IME 用 PerformanceEventTiming，
 *   结构/保存/搜索用手动 performance.measure，启动 init→首行可编辑）；
 * - 门禁判定与 P50/P95 聚合由 tester agent 在此 harness 上编写；
 *   下方占位测试保持 CI 可跑。
 */

// 100k/50MB 全量 seed 写入耗时较长（页面内生成约 1-2s + bulkPut），
// 若 CI 时长吃紧可先用小规模 fixture 冒烟，门禁判定时必须用全量。
const SEED_OPTIONS = { nodeCount: 100_000, targetBytes: 50 * 1024 * 1024 }

test.describe("S1 性能原型 harness", () => {
  test.setTimeout(180_000)

  test("seed fixture 注入后应用可加载并恢复数据", async ({ page }) => {
    const seedScript = buildSeedScript(SEED_OPTIONS)

    // 注入顺序：seed（页面加载前打开 IndexedDB 写入）→ 应用
    await page.addInitScript(seedScript)
    await page.addInitScript(() => {
      // 等待 seed 完成再放行应用？不——应用启动与 seed 并行更接近真实启动时序。
      // seed 脚本自身幂等：写完 nodes 即结束。
    })

    await page.goto("/")
    // seed 是异步的：等待写入完成标记（seedEntry 设置 window.__flowlistSeedCount）
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__flowlistSeedCount !== undefined,
      { timeout: 120_000 },
    )
    await page.reload()
    await page.waitForLoadState("networkidle")
    // 应用启动是异步 Effect：等数据加载完成再断言
    await page.waitForFunction(
      () => Number(document.querySelector("[data-testid=\"loaded-count\"]")?.textContent) > 0,
      { timeout: 60_000 },
    )

    const loaded = await page.getByTestId("loaded-count").textContent()
    expect(Number(loaded)).toBeGreaterThan(0)
  })

  test("DOM 规模不随 100k 增长（固定滚动位置）", async ({ page }) => {
    const seedScript = buildSeedScript(SEED_OPTIONS)
    await page.addInitScript(seedScript)
    await page.goto("/")
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__flowlistSeedCount !== undefined,
      { timeout: 120_000 },
    )
    await page.reload()
    await page.waitForLoadState("networkidle")
    await page.waitForFunction(
      () => Number(document.querySelector("[data-testid=\"loaded-count\"]")?.textContent) > 0,
      { timeout: 60_000 },
    )

    // 初始 DOM 节点数
    const domBefore = await page.evaluate(() => document.querySelectorAll("*").length)
    // 固定滚动位置（列表中部）
    await page.getByTestId("outline-scroll").evaluate((el) => {
      el.scrollTop = 50_000
    })
    await page.waitForTimeout(500)
    const domAfter = await page.evaluate(() => document.querySelectorAll("*").length)

    // DOM 数量与 100k 无关：滚动前后都应该是小常数（可视行 + overscan）
    expect(domBefore).toBeLessThan(300)
    expect(domAfter).toBeLessThan(300)
  })
})
