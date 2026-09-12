/**
 * Playwright fixture 注入：addInitScript 真写 IndexedDB（决策记录第 4 条）。
 *
 * seed 生成器是纯函数，用 esbuild 打包成 IIFE 后经 addInitScript 注入页面，
 * 在真浏览器 IndexedDB 内生成并写入 100k/50MB 数据。打包产物约 80KB，
 * 数据不序列化传输（页面内生成），只注入代码。
 *
 * 本模块只存在于测试代码路径（e2e/），不进生产 bundle。
 */
import * as esbuild from "esbuild"
import { join } from "node:path"

let cachedScript: string | null = null

/** 打包页面内 seed 脚本（结果缓存，多次 test 复用）。 */
export const buildSeedScript = (options?: {
  nodeCount?: number
  targetBytes?: number
}): string => {
  const nodeCount = options?.nodeCount ?? 100_000
  const targetBytes = options?.targetBytes ?? 50 * 1024 * 1024
  const cacheKey = `${nodeCount}:${targetBytes}`
  if (cachedScript && cachedScript.includes(`SEED:${cacheKey}:`)) return cachedScript

  const result = esbuild.buildSync({
    entryPoints: [join(import.meta.dirname, "seedEntry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    define: {
      __SEED_COUNT__: String(nodeCount),
      __SEED_BYTES__: String(targetBytes),
    },
  })
  cachedScript = `/* SEED:${cacheKey}: */\n` + result.outputFiles[0]!.text
  return cachedScript
}
