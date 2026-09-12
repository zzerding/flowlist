import { test } from "@playwright/test"

import { buildSeedScript } from "./seedFixture"

// 临时诊断（不提交）：startup 循环逐轮耗时 + guard 状态
test("diagnose startup loop", async ({ page }) => {
  test.setTimeout(900_000)
  const SEED_OPTIONS = { nodeCount: 100_000, targetBytes: 50 * 1024 * 1024 }
  await page.addInitScript(buildSeedScript(SEED_OPTIONS))
  await page.goto("/")
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__flowlistSeedCount !== undefined,
    { timeout: 300_000 },
  )
  const seedCount = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__flowlistSeedCount,
  )
  console.log(`[diag] seedCount=${seedCount}`)
  if (seedCount !== -1) await page.reload()
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now()
    await page.reload()
    const t1 = Date.now()
    await page.waitForFunction(
      () => Number(document.querySelector("[data-testid='loaded-count']")?.textContent) > 0,
      { timeout: 120_000 },
    )
    const t2 = Date.now()
    await page.waitForFunction(
      () =>
        (window as unknown as {
          __flowlistMetrics?: { snapshot: () => { measures: Array<{ name: string }> } }
        }).__flowlistMetrics?.snapshot().measures.some((m) => m.name === "flowlist:startup") ??
        false,
      { timeout: 240_000 },
    )
    const t3 = Date.now()
    const guard = await page.evaluate(() => localStorage.getItem("flowlistSeedDone"))
    console.log(
      `[diag] round=${i} reload_ms=${t1 - t0} load_ms=${t2 - t1} startupwait_ms=${t3 - t2} guard=${guard}`,
    )
  }
})
