import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"
import { App } from "./app/App"
import { mark, recordStartup, startEventTimingCollection } from "./telemetry/metrics"
import { RegistryProvider } from "@effect/atom-react"

/**
 * 启动埋点（决策记录测量契约）：
 * init mark 在本文件最前部记录；首行可编辑（编辑器 contenteditable 挂载）
 * 后打 `flowlist:first-editable` 并结算 `flowlist:startup`。
 */
mark("flowlist:init")
startEventTimingCollection()
installStartupEndHook()

function installStartupEndHook() {
  // 首行可编辑判定：唯一 contenteditable 出现并就绪。
  // 事件驱动（MutationObserver）而非 rAF 轮询：分阶段启动后编辑器在异步首屏
  // 加载完成后才挂载（约百毫秒），而 rAF 在没有持续绘制的环境（e2e headless）
  // 会在最初几帧后停发，轮询会永久错过挂载事件。
  // 语义：启动门禁的「首行可编辑」必须是真实数据行；幽灵活动行只在
  // 「数据就绪但库为空」（全新安装）时出现，此时它是唯一合法入口。
  const settle = (): boolean => {
    const editable = document.querySelector('[data-testid="active-editor"]')
    if (!editable) return false
    mark("flowlist:first-editable")
    recordStartup()
    return true
  }
  const observer = new MutationObserver(() => {
    if (settle()) observer.disconnect()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  // 已被渲染（脚本后于编辑器挂载执行）时立即结算，避免漏采。
  if (settle()) observer.disconnect()
}

const rootElement = document.getElementById("root")!
createRoot(rootElement).render(
  <StrictMode>
    <RegistryProvider>
      <App />
    </RegistryProvider>
  </StrictMode>,
)
