import { expect, test } from "@playwright/test"

// 性能门禁占位：100k/50MB fixture 与绝对门禁在性能原型 slice 中落地。
// 门禁值见 spec issue #1 Testing Decisions；未实现前此文件仅验证流程可跑。
test("performance pipeline placeholder", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Flowlist" })).toBeVisible()
})
