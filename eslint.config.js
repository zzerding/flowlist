import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // ADR-0001 硬边界：domain 层是纯函数领域核心，不依赖 UI/state/数据层
  // （effect 与 fractional-indexing 允许）。
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["react", "react-dom", "react-dom/client"],
          patterns: ["@lexical/*", "src/state/*", "src/outline/*", "src/editor/*", "src/data/*", "src/search/*", "src/app/*"],
        },
      ],
    },
  },
)
