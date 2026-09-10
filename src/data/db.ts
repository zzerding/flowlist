import Dexie, { type EntityTable } from "dexie"

import type { NodeRecord } from "../domain/nodeRecord"

/**
 * Dexie 表结构（架构 §6.2，一次到位）：
 * - nodes：节点当前状态（权威数据）
 * - meta：schemaVersion、最近焦点、索引版本和迁移状态
 * - searchChunks：FlexSearch 导出分片；可丢弃并从 nodes 重建
 */
export interface MetaRecord {
  key: string
  value: unknown
}

export const db = new Dexie("flowlist") as Dexie & {
  nodes: EntityTable<NodeRecord, "id">
  meta: EntityTable<MetaRecord, "key">
  searchChunks: EntityTable<{ key: string; value: unknown }, "key">
}

db.version(1).stores({
  nodes: "id, [parentId+orderKey], parentId, updatedAt, tombstonedAt",
  meta: "key",
  searchChunks: "key",
})

export const META_KEYS = {
  schemaVersion: "schemaVersion",
  lastFocus: "lastFocus",
  searchIndexVersion: "searchIndexVersion",
} as const

export const SCHEMA_VERSION = 1
