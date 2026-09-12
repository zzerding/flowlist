import { Effect } from "effect"

import { db, META_KEYS } from "../data/db"
import { generateSeed } from "../seed/seedGenerator"
import type { NodeRecord } from "../domain/nodeRecord"

/**
 * fixture 注入（决策记录第 4 条）：
 * - Playwright 用 addInitScript 调 `window.__seedFlowlistFixture()`
 *   在真浏览器 IndexedDB 写入确定性 seed；
 * - fake-indexeddb 形态由单测自行 new 这两个纯函数；
 * - 本模块只存在于测试代码路径，不进生产 bundle（动态 import 触发）。
 */

/** 把 seed 节点写入 Dexie（覆盖式）。 */
export const seedFixtureToDexie = (options?: {
  nodeCount?: number
  targetBytes?: number
  seed?: number
}): Effect.Effect<{ nodes: number; bytes: number }, Error> =>
  Effect.gen(function* () {
    const { nodes, bytes } = generateSeed(options)
    yield* Effect.tryPromise({
      try: () => db.nodes.clear().then(() => db.nodes.bulkPut(nodes)),
      catch: (error) => new Error(`fixture 写入失败: ${String(error)}`),
    })
    yield* Effect.tryPromise({
      try: () => db.meta.put({ key: META_KEYS.schemaVersion, value: 1 }),
      catch: (error) => new Error(`fixture meta 写入失败: ${String(error)}`),
    })
    const result = { nodes: nodes.length, bytes }
    return result
  })

/** 浏览器侧注入入口（addInitScript 中引用编译后的纯函数）。 */
declare global {
  interface Window {
    __seedFlowlistFixture?: (options?: {
      nodeCount?: number
      targetBytes?: number
      seed?: number
    }) => Promise<{ nodes: number; bytes: number }>
  }
}

export const installFixtureHook = (): void => {
  if (typeof window === "undefined") return
  window.__seedFlowlistFixture = (options) =>
    Effect.runPromise(seedFixtureToDexie(options)) as unknown as Promise<{
      nodes: number
      bytes: number
    }>
}

export type { NodeRecord }
