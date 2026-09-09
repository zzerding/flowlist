# Flowlist PRD 外部资料调研

访问日期：2026-09-09。本文只记录可支撑 MVP 边界、风险与验收标准的资料；“事实”是来源明确陈述，“建议”是基于事实对 Flowlist 的产品判断。

## 1. Workflowy 可参考的产品事实

### 事实

- Workflowy 将产品描述为“一份单一、无限的文档”，不使用文件夹或独立文件；按 `Enter` 新建条目。[Workflowy Features](https://workflowy.com/features)（访问日期：2026-09-09）
- 通过 `Tab` 将条目缩进为上一个条目的子项，层级可以继续深入；官方示例明确把笔记、项目和子项目放在同一层级模型中。[Workflowy Features](https://workflowy.com/features)（访问日期：2026-09-09）
- 点击任意 bullet 会进入该分支的聚焦视图（Zoom）；面包屑用于回到上层。[Workflowy Features](https://workflowy.com/features)（访问日期：2026-09-09）
- 搜索会随输入实时过滤文档，并可在结果中直接编辑；点击标签可继续过滤，搜索还可以保存为侧栏快捷方式。[Workflowy Features](https://workflowy.com/features)（访问日期：2026-09-09）
- 官方 Basics 页面说明多行笔记会自动折叠，并提供关闭分区与全局搜索入口。[Workflowy Basics](https://workflowy.com/basics)（访问日期：2026-09-09）
- Workflowy 官方更新说明已支持在浏览器标签页之间拖拽节点（Chrome、Edge、Firefox、Dia 的 PC/Mac，以及 Mac Safari）。[2026-01 Patch Notes](https://blog.workflowy.com/update-2026-01-22/)（访问日期：2026-09-09）
- 官方首页将同一列表模型用于 notes、tasks、ideas、plans，并强调通过缩进建立秩序。[Workflowy](https://workflowy.com/)（访问日期：2026-09-09）

### 建议（非来源事实）

- MVP 保留 README 已承诺的 `Enter`、`Tab`、`Shift+Tab`、点击 bullet 聚焦、面包屑返回、搜索、折叠、待办和拖拽排序；不引入文件夹、多人协作、账号同步或标签高级语法。
- 验收应覆盖“新增 → 缩进 → 聚焦 → 搜索 → 折叠 → 移动/排序 → 完成待办”的闭环；拖拽先保证同一文档/同一设备内的稳定排序，跨标签拖拽可列为后续能力。
- 聚焦应改变可见上下文但不能改变树数据；返回上层后节点展开状态和编辑内容应保持。

## 2. `localStorage` 的容量、同步、隐私与持久性

### 事实

- Web Storage 按 origin 分隔；同一 origin 的文档共享该 origin 的 `localStorage`，而不同 origin 不共享。[WHATWG Web Storage](https://html.spec.whatwg.org/dev/webstorage.html)（访问日期：2026-09-09）
- `localStorage` 在普通浏览器中会跨页面关闭和重新打开而保留；Web Storage API 是同步 API。[MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)（访问日期：2026-09-09）
- MDN 给出的 Web Storage 总上限是 10 MiB：每个 origin 通常最多 5 MiB `localStorage` 与 5 MiB `sessionStorage`；超限会抛出 `QuotaExceededError`。[MDN Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)（访问日期：2026-09-09）
- WHATWG 规范明确指出多进程用户代理中的并发交互不由规范定义，并建议作者假定没有锁机制；存储变化可通过 `storage` event 通知其他窗口。[WHATWG Web Storage](https://html.spec.whatwg.org/dev/webstorage.html)（访问日期：2026-09-09）
- 私密/隐身窗口中，`localStorage` 的行为类似 `sessionStorage`，窗口或标签关闭时数据会被删除。[MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)（访问日期：2026-09-09）
- WHATWG 将持久化存储与隐私清理、用户追踪风险联系起来；浏览器可允许用户清除持久化数据，应用不能把本地存储当作跨设备备份。[WHATWG Web Storage — Privacy](https://html.spec.whatwg.org/dev/webstorage.html)（访问日期：2026-09-09）

### 建议（非来源事实）

- “当前浏览器 `localStorage`”应在 UI 中明确标注为本地数据，不承诺账号级备份、跨设备同步或多人协作；提供导出/导入 JSON 是低成本的灾备边界（若未在 MVP 计划中，可明确列为后续）。
- 写入必须捕获 `QuotaExceededError`，并在失败时保留内存状态、提示用户导出/清理；不要把一次巨大的完整树序列化写入作为无条件成功路径。
- MVP 可监听 `storage` 事件刷新其他标签页，但不要声称这是可靠的并发同步；验收应至少验证同 origin 两标签页的更新提示或刷新策略。
- 同步 API 可能阻塞主线程；MVP 先控制单次数据规模与写入频率，若真实数据规模或输入延迟达到可测阈值，再迁移 IndexedDB，而不是预先引入复杂同步层。

## 3. PWA 安装与离线

### 事实

- PWA 的 Web App Manifest 是描述应用名称、图标和启动/显示方式的 JSON 文件；MDN 将 manifest 列为可被浏览器推广安装的最低要求之一。[MDN Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)（访问日期：2026-09-09）
- Chrome 的安装推广条件包括 HTTPS，以及 manifest 中的 `name`/`short_name`、192px 与 512px 图标、`start_url` 和合法的 `display` 值；还受浏览器用户参与度启发式影响。[web.dev What does it take to be installable?](https://web.dev/articles/install-criteria)（访问日期：2026-09-09）
- Service worker 不是“可安装”的必需条件，但许多 PWA 用它提供离线体验；安装资格与离线能力是不同要求。[MDN Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)（访问日期：2026-09-09）
- 不同浏览器和平台的安装体验不同：iOS/iPadOS 通常通过分享菜单手动加入主屏幕，不能假设所有平台都有统一安装提示。[MDN PWA Installation](https://web.dev/learn/pwa/installation)（访问日期：2026-09-09）

### 建议（非来源事实）

- MVP 验收拆成两组：在线 HTTPS 环境能发现/安装（manifest、图标、`start_url`、standalone 等）；断网后已加载应用仍能打开壳、读取本地树、编辑并重新保存。
- “离线可用”不能只等同于 `localStorage` 仍在：必须缓存应用壳和必要资源；网络不可用时给出明确离线状态，恢复连接后不覆盖本地编辑。
- 开发环境 `http://localhost` 可用于本地验证，但生产安装验收必须使用 HTTPS，并记录浏览器/平台差异。

## 4. 键盘交互与无障碍

### 事实

- WCAG 2.1.1（Level A）的原则是所有功能都应可通过键盘使用；仅提供指针事件会构成常见失败。[WAI Understanding SC 2.1.1](https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html)（访问日期：2026-09-09）
- WAI-ARIA APG 指出，浏览器不会自动为用 ARIA 做出的图形组件提供键盘支持，作者必须实现键盘行为与焦点管理。[APG Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface)（访问日期：2026-09-09）
- WAI-ARIA 规范强调交互内容不能仅靠静态检查确认，应测试设备无关的访问、控件语义以及交互时发生的变化。[WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)（访问日期：2026-09-09）
- APG 为树形/复合控件提供键盘与焦点管理模式；`Tab` 用于进入/离开复合控件，控件内部通常需要明确的方向键或其他操作，并持续显示焦点。[APG Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface)（访问日期：2026-09-09）

### 建议（非来源事实）

- README 中的 `Enter`、`Tab`、`Shift+Tab` 必须有键盘可达且可见的焦点路径；搜索、折叠、完成、删除、聚焦/返回、拖拽排序都要有非指针替代操作。
- 若树节点使用 ARIA tree/treeitem，应正确暴露层级、展开/折叠状态和选中/焦点状态；若原生 HTML 足够，则优先使用原生按钮、输入框和链接，减少自绘控件。
- 验收至少包含：仅用键盘完成新建/缩进/减缩进/折叠/完成/聚焦/搜索；焦点不丢失、不陷阱；屏幕阅读器能感知节点层级与展开状态；触摸/鼠标操作仍可用。

## MVP 边界摘要

1. **必须交付**：单树层级编辑、聚焦/返回、搜索、折叠、待办、排序、当前 origin 本地保存、已加载资源的离线读取与编辑、基础安装 manifest。
2. **必须显式提示的风险**：`localStorage` 容量与 `QuotaExceededError`、隐身模式清除、同 origin 多标签并发无锁、浏览器安装差异、离线缓存与本地数据是两件事。
3. **暂不承诺**：账号同步、跨设备恢复、多人协作、可靠冲突合并、任意浏览器统一安装提示；这些都需要服务端身份/同步或更强的数据层。

