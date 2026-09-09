# Effect 运行时及硬边界

## Status

accepted

## 决策

Flowlist 的领域逻辑、状态管理、异步流程和数据校验**必须**走 Effect（`effect@4.0.0-rc.112` + `@effect/atom-react`）；唯一的例外是纯 JSX 渲染层。具体而言：`domain`、`state`、`worker-client`、`data.worker` 全部以 Effect 风格组织；`outline`、`editor`、`pwa` 模块的 JSX 组件不直接运行 Effect 程序，只通过 atom 订阅消费状态。React 组件内不得出现 `Effect.run*`。

选择 Effect 的首要动机是 **LLM 友好**：本项目代码主要由 LLM agent 生成，Effect 的类型化程序自带文档、显式错误通道（Typed Error）、Schema 校验边界和可组合的测试结构，使 agent 生成正确代码的可靠性显著高于隐式副作用风格。

## Considered Options

1. **不用 Effect，普通 TypeScript + 惯例约束**（被否）：对人类工程师成本更低，但 agent 面对隐式副作用、非穷尽错误处理和弱约束的模块边界时出错率更高，且约束靠 review 维持、不可在类型层强制。
2. **Effect 覆盖包括 JSX 在内的一切**（被否）：渲染层没有 Effect 的收益场景——React 组件订阅 Effect atom 已是"Effect 状态驱动视图"的完整链路；组件内直接跑 Effect 会引入 React 与 Effect 双重运行时的调度和生命周期问题，并把学习成本扩散到原型迭代最频繁的键盘、拖拽、虚拟列表代码。
3. **仅 Worker 边界用 Effect**（被否）：Schema 校验和 Typed Error 的收益不只在边界——命令补丁、撤销栈、乐观更新的不变量都依赖 Effect 组合能力，半途而废的采用最差。

## Consequences

- **硬边界是强约束而非建议**："尽量用 Effect" 的口号会让 agent 把 JSX 也包进 Effect——明确禁止。未来若出现第五个模块，默认继承"领域逻辑用 Effect、渲染不碰 Effect"的划分。
- **替换成本被三模块封顶**：若需替换 Effect，改动范围限于 `domain`、`state`、`worker-client`（`data.worker` 随 `worker-client` 协议连带调整），降级路径为独立 Schema 库 + 普通 TS 错误类（见 TECHNICAL_ARCHITECTURE.md 第 18 节）。
- **rc 版本风险已知**：锁定 `4.0.0-rc.112` 精确版本；4.x stable 发布且回归门禁全过后才升级；rc 出现阻断性缺陷且 stable 遥遥无期时走降级路径。
