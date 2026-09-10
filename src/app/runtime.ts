import { Layer, ManagedRuntime } from "effect"

import { DataStore, DataStoreLayer } from "../data/dataStore"
import { SearchService, SearchServiceLayer } from "../search/searchService"

/** 应用运行时：ManagedRuntime 构建一次，组件内不得出现 Effect.run*（ADR-0001）。 */
const AppLayers = Layer.mergeAll(DataStoreLayer, SearchServiceLayer)

export const runtime = ManagedRuntime.make(AppLayers)

export { DataStore, SearchService }
