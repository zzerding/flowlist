# e2e 测试侧运行纪律

本文件是测试辅助文档（fixture / 门禁 harness 的使用说明），只约束测试代码，不影响生产实现。

## seed fixture 机制（`seedEntry.ts` + `seedFixture.ts`）

- `buildSeedScript()` 用 esbuild 把 `seedEntry.ts` 打包成 IIFE，经 `addInitScript` 注入页面，
  在**真浏览器 IndexedDB** 内生成并写入确定性 seed（issue #2 决策记录第 4 条）。
- seed 只写入当前 browser context 的 storage：**每个新 context 的 IndexedDB 都是空的**，
  必须重新 seed。跨 test 的数据不共享（Playwright 默认每 test 一个 context）。

## 已知错误用法（踩过的坑，2026-09 实测）

### 1. `addInitScript` 会在**每次导航**重新执行

错误认知：「addInitScript 注入一次，reload 后数据还在就不用管」。
实际：每次 `goto` / `reload` 都会重跑注入脚本。若脚本无条件重建 seed，
50 轮 reload 的启动采样 = 50 次全量生成 + 50 次 50MB bulkPut（实测 3k/2MB 规模下单轮 load
从 ~200ms 恶化到 ~30s，100k 规模直接把整个 suite 拖到超时）。

**正确用法**：注入脚本内用 `localStorage` 标记守卫（`seedEntry.ts` 的 `flowlistSeedDone`），
已写入过则跳过重建，只设置 `__flowlistSeedCount` 哨兵值。localStorage 与 IndexedDB
同 per-context 生命周期，守卫不会跨 context 误判。

注意守卫的副作用：`__flowlistSeedCount = -1` 表示「复用已有数据」。需要**强制重建**数据时
（例如换了 seed 参数），必须用新 context（新 test / 新 `browser.newContext()`），
或在守卫判断前清掉 `localStorage`。

### 2. 校准节点不能作为交互采样对象

seed 的体积校准阶段会向个别节点（小规模下是 `n0`/`n1`）追加超长段落（数万字符）。
点击激活这类节点时，编辑器行高 `height: auto` 暴涨，触发滚动跳变与主线程长任务
（实测页面 JS 阻塞可长达分钟级，`waitForFunction` 无法超时恢复）。

**正确用法**：交互类采样（启动点击、输入、保存）先用黑盒过滤选中「文本较短」的静态行
（`performance.perf.ts` 的 `findCalmRowIndex`：`textContent.length` 2–80）。

### 3. seed 脚本写完必须 `db.close()` 释放原生连接

`seedEntry.ts` 用原生 `indexedDB.open` 写数据。若不 close,应用侧 Dexie 的连接请求会被阻塞
（控制台表现:`Upgrade 'flowlist' blocked by other connection holding version 0.1`），
后续导航应用加载可能卡死、`waitForFunction` 挂到 test timeout 且无法恢复。
写完（含 `__flowlistSeedCount` 哨兵与 localStorage 标记之后）统一 `db.close()`。

### 4. 不要用模块级 flag 跨 test 判断「已 seed」

Playwright 默认每 test 一个新 context,localStorage/IndexedDB 全空。
`performance.perf.ts` 曾用 `let seeded = false` 跳过后续 test 的 `addInitScript`,
导致后续 test 等待一个永远不会出现的哨兵值而卡死（单跑通过、全套跑挂死的典型症状）。
正确做法:每个 test 都注入 seed 脚本,由 seedEntry 的 localStorage 守卫在同 context 内去重。

### 5. 单独跑 vs 一起跑的耗时差异巨大

- 单个门禁用例（小规模冒烟）：搜索门禁 9.7s、保存门禁 ~1min 即可出 P50/P95。
- 全套一起跑：受 seed 重建与 reload 轮数影响，分钟到十分钟级。
- 调试门禁逻辑时先 `--grep "<用例名>"` 单独跑，确认 harness 正确后再全量；
  **门禁判定本身必须用全量数据（100k/50MB）+ 完整样本数**，小规模冒烟只验证 harness，
  其数值不得作为门禁结论。

### 6. PerformanceEventTiming 默认阈值陷阱（测量契约缺口，已报 issue #2）

Chromium 默认只暴露 `duration ≥ 104ms` 的 event timing entry（MDN：
rounded to nearest multiple of 8ms）。`src/telemetry/metrics.ts` 的
`startEventTimingCollection()` 未设置 `durationThreshold`，16ms 级输入**不产生任何样本**，
「连续输入 P95 ≤16ms」门禁按测量契约目前无法合规测量。
测试侧临时用 rAF 差值法黑盒近似（含一帧渲染预算，阈值放宽为两帧 33ms），
并在报告中标注；修复须在实现侧（observer 加 `durationThreshold: 16`）。

### 7. seed 建库的原生版本必须对齐 Dexie（×10）

错误认知：「seedEntry 用 `indexedDB.open("flowlist", 1)` 建库，应用 Dexie
`db.version(1)` 打开同一版本，匹配」——**不匹配**。Dexie 内部把逻辑版本 ×10 作为
原生版本：`db.version(1)` 实际打开的是原生版本 **10**。若 seed 用原生 1 建库，
应用每次 reload 打开 DB 都会触发 v0.1→v1.0 的升级事务，100k/50MB 下全库索引
校验实测 ~97s/轮（reload 门禁单样本 ≈100s 的根源之一；原生 IDB 冷读 ~95s
是同一机理——升级事务与首次全表遍历都要在 50MB 存储上过一遍）。

**正确用法**：seedEntry 用 `indexedDB.open("flowlist", 10)` 建库（与 db.ts v1 对齐），
reload 后应用零升级、首屏就绪 ~250ms。seed 表结构/索引名不变，只是原生版本号。

## 快速命令

```bash
# 单测层（秒级）：接缝 1/2
pnpm test -- --run

# 日常 e2e（秒级）：acceptance 冒烟；性能门禁默认 skipped
pnpm e2e

# 单个门禁用例（先冒烟 harness，需 PERF_FULL=1）
PERF_FULL=1 pnpm exec playwright test e2e/performance.perf.ts --project=performance --grep "搜索"

# 全量门禁（正式判定，100k/50MB；reload 每轮 ~0.3-1s，50 轮启动采样快）
PERF_FULL=1 pnpm e2e --project=performance
```

## 已知门禁现状（2026-09 全量实测，测试报告详情见 issue #2）

- 启动门禁：懒加载分阶段启动后（首屏 128 行可编辑 ~250-450ms），门禁应绿；
  历史红源为 seed 原生版本未对齐 Dexie（见坑 7）+ 全量/索引阻塞主线程。
- 结构操作门禁 skipped：原型未实现新增/删除/移动命令，`flowlist:structure` 无数据源。
