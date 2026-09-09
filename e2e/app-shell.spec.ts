import { expect, test } from "@playwright/test"

// 接缝 3 冒烟：应用壳可加载。11 条 PRD 验收流程随功能落地逐步启用。
test("app shell loads and shows title", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Flowlist" })).toBeVisible()
})
