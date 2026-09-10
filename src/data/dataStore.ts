import { Context, Effect, Layer, Schema } from "effect"

import { db, META_KEYS, SCHEMA_VERSION, type MetaRecord } from "../data/db"
import type { NodeRecord } from "../domain/nodeRecord"

/** Typed Error：数据层事务失败（架构 §16 分类中的 StorageTransactionError 占位）。 */
export class StoreError extends Schema.TaggedError<StoreError>()("DataStoreError", {
  cause: Schema.String,
}) {}

/**
 * 数据服务（原型：主线程直写 Dexie，不建 Worker —— 决策记录第 1 条）。
 * Worker 协议归 issue #3；这里的方法签名保持可平移到 Worker 请求。
 */
export class DataStore extends Context.Service<DataStore, {
  /** 编辑补丁直写（决策记录第 6 条），返回新 revision。 */
  readonly patchNode: (
    id: string,
    fields: Partial<NodeRecord>,
    expectedRevision: number,
  ) => Effect.Effect<boolean, StoreError>
  readonly putNode: (node: NodeRecord) => Effect.Effect<void, StoreError>
  readonly getAllVisibleNodes: () => Effect.Effect<Array<NodeRecord>, StoreError>
  readonly bulkPutNodes: (nodes: Array<NodeRecord>) => Effect.Effect<void, StoreError>
  readonly countAll: () => Effect.Effect<number, StoreError>
  readonly getMeta: <T>(key: string) => Effect.Effect<T | null, StoreError>
  readonly setMeta: (key: string, value: unknown) => Effect.Effect<void, StoreError>
  readonly ensureSchemaVersion: () => Effect.Effect<void, StoreError>
}>()("flowlist/DataStore") {}

const storeShape = {
  patchNode: (id: string, fields: Partial<NodeRecord>, expectedRevision: number) =>
    Effect.tryPromise({
      try: async () => {
        let ok = false
        await db.transaction("rw", db.nodes, async () => {
          const current = await db.nodes.get(id)
          if (!current || current.revision !== expectedRevision) return
          await db.nodes.update(id, {
            ...fields,
            revision: expectedRevision + 1,
            updatedAt: Date.now(),
          })
          ok = true
        })
        return ok
      },
      catch: (error) => new StoreError({ cause: String(error) }),
    }),

  putNode: (node: NodeRecord) =>
    Effect.tryPromise({
      try: () => db.nodes.put(node).then(() => undefined),
      catch: (error) => new StoreError({ cause: String(error) }),
    }),

  getAllVisibleNodes: () =>
    Effect.tryPromise({
      try: async () =>
        (await db.nodes.filter((n) => n.tombstonedAt === undefined).toArray()) as NodeRecord[],
      catch: (error) => new StoreError({ cause: String(error) }),
    }),

  bulkPutNodes: (nodes: Array<NodeRecord>) =>
    Effect.tryPromise({
      try: () => db.nodes.bulkPut(nodes).then(() => undefined),
      catch: (error) => new StoreError({ cause: String(error) }),
    }),

  countAll: () =>
    Effect.tryPromise({
      try: () => db.nodes.count(),
      catch: (error) => new StoreError({ cause: String(error) }),
    }),

  getMeta: <T>(key: string) =>
    Effect.tryPromise({
      try: async () => {
        const rec: MetaRecord | undefined = await db.meta.get(key)
        return (rec?.value as T | undefined) ?? null
      },
      catch: (error) => new StoreError({ cause: String(error) }),
    }),

  setMeta: (key: string, value: unknown) =>
    Effect.tryPromise({
      try: () => db.meta.put({ key, value } satisfies MetaRecord).then(() => undefined),
      catch: (error) => new StoreError({ cause: String(error) }),
    }),

  ensureSchemaVersion: () =>
    Effect.gen(function* () {
      const store = yield* DataStore
      const current = yield* store.getMeta<number>(META_KEYS.schemaVersion)
      if (current === null) {
        yield* store.setMeta(META_KEYS.schemaVersion, SCHEMA_VERSION)
      } else if (current > SCHEMA_VERSION) {
        return yield* Effect.fail(
          new StoreError({
            cause: `数据 schema 版本 ${current} 高于应用支持的 ${SCHEMA_VERSION}`,
          }),
        )
      }
    }),
}

export const DataStoreLayer = Layer.effect(
  DataStore,
  Effect.succeed({
    ...storeShape,
    ensureSchemaVersion: () =>
      Effect.gen(function* () {
        const current = yield* storeShape.getMeta<number>(META_KEYS.schemaVersion)
        if (current === null) {
          yield* storeShape.setMeta(META_KEYS.schemaVersion, SCHEMA_VERSION)
        } else if (current > SCHEMA_VERSION) {
          return yield* Effect.fail(
            new StoreError({
              cause: `数据 schema 版本 ${current} 高于应用支持的 ${SCHEMA_VERSION}`,
            }),
          )
        }
      }),
  }),
)
