import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

function App() {
  return (
    <main>
      <h1>Flowlist</h1>
      <p>本地优先大纲工具 — 工程骨架，功能开发按 ADR-0001 与架构第 17 节实施顺序进行。</p>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
