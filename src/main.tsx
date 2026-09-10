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
  // 首行可编辑判定：唯一 contenteditable 出现并就绪
  const check = () => {
    const editable = document.querySelector('[data-testid="active-editor"]')
    if (editable) {
      mark("flowlist:first-editable")
      recordStartup()
      return
    }
    requestAnimationFrame(check)
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    requestAnimationFrame(check)
  } else {
    window.addEventListener("DOMContentLoaded", () => requestAnimationFrame(check), { once: true })
  }
}

const rootElement = document.getElementById("root")!
createRoot(rootElement).render(
  <StrictMode>
    <RegistryProvider>
      <App />
    </RegistryProvider>
  </StrictMode>,
)
