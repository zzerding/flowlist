# Flowlist React 富文本编辑库选型

访问日期：2026-09-09

## 结论

唯一推荐：**Lexical（`lexical` + `@lexical/react`，按需加入 `@lexical/rich-text`、`@lexical/list`、`@lexical/link`、`@lexical/code`、`@lexical/extension`、`@lexical/markdown`）**。

理由不是“编辑器本身能渲染 10 万节点”。Flowlist 应把 10 万节点/50 MB 的压力留在自己的树模型、Worker、索引和虚拟列表；富文本编辑器只挂载一个活动节点，非活动节点使用静态 JSX/HTML。这个边界下，Lexical 同时给出官方 React 绑定、不可变状态与 JSON 序列化、所需的富文本节点/格式、Markdown 转换器、历史插件、可访问性目标和活跃的一手维护信号，集成面比直接使用 ProseMirror 更小，默认假设比 Slate 更少。

Lexical 不是无风险承诺：官方 Markdown transformer 没有 underline transformer；当前仓库仍有 IME/移动端问题；编辑器复用时必须隔离每个节点的 undo/redo 历史；官方没有发布能证明 100k/50MB 的端到端 benchmark。因此必须先做最小原型和真实设备验收，不能把官网的 “fast” 当作容量证明。

## 评估边界

项目约束来自 [`README.MD`](../../README.MD)、[`PRD.md`](../../PRD.md) 和 [`flowlist-prd-research.md`](flowlist-prd-research.md)：React + TypeScript + Vite；Effect 4 只承担领域命令、Typed Error、Schema、存储和 Worker 服务，React 组件保持普通 JSX；目标是 100,000 节点/50 MB、虚拟列表、单活动编辑器；每个节点有标题和备注；需要 undo/redo、Markdown 粘贴/快捷输入、粗体/斜体/下划线/删除线/行内代码/链接，以及标题/段落/待办/引用/代码块/分隔线。

评分重点是：

1. 官方功能和序列化模型是否能直接支撑节点内容。
2. React + Vite 集成、单实例复用、IME/移动端和无障碍的证据与风险。
3. GitHub issue/release/contributor 信号和 npm 使用信号。
4. bundle/性能是否有可复核、可比较的一手证据。

## 事实与推断

### Lexical

**事实**

- 官方仓库说明 Lexical 有官方 React bindings、不可变状态模型和内置 undo/redo；同时提供 JSON、Markdown、HTML 的导入/导出，并列出列表、代码块、链接和自定义节点等能力。[Lexical 官方仓库](https://github.com/facebook/lexical)（访问日期：2026-09-09）
- 官方 EditorState 文档把 `EditorState` 定义为内容与选区的不可变快照，并提供序列化/反序列化章节。[Editor State](https://facebook-lexical.mintlify.app/concepts/editor-state)（访问日期：2026-09-09）
- `@lexical/markdown` 官方 README 提供 Markdown 导入、导出和 React `MarkdownShortcutPlugin`；内置 transformer 覆盖 heading、quote、code、bold、italic、inline code、strikethrough 和 link，并允许传入自定义 transformer。[`@lexical/markdown` README](https://github.com/facebook/lexical/blob/main/packages/lexical-markdown/README.md)（访问日期：2026-09-09）
- 官方 Playground 的节点注册源码使用 `HeadingNode`、`QuoteNode`、`CodeNode`、`LinkNode`、`ListNode`、`HorizontalRuleNode` 等节点；列表源码还导出 checklist 命令和节点。[Playground 节点注册](https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/nodes/PlaygroundNodes.ts)、[`@lexical/list` 源码](https://github.com/facebook/lexical/blob/main/packages/lexical-list/src/index.ts)（访问日期：2026-09-09）
- `@lexical/rich-text` 官方包说明提供 headings 和 quotes 的 rich-text 支持；`@lexical/code` 官方包提供 code blocks 和 code highlighting。[`@lexical/rich-text`](https://www.npmjs.com/package/%40lexical/rich-text)、[`@lexical/code`](https://www.npmjs.com/package/%40lexical/code)（访问日期：2026-09-09）
- 官方 React 示例使用 `LexicalComposer`、`RichTextPlugin`、`ContentEditable`、`HistoryPlugin` 和 `LexicalErrorBoundary`；`@lexical/react` 是单独发布的官方 React 包。[Lexical React 示例](https://github.com/facebook/lexical)、[`@lexical/react` npm](https://www.npmjs.com/package/%40lexical/react)（访问日期：2026-09-09）
- Lexical 官方网站说明一个 editor instance 连接一个 contenteditable，并将 editor state 作为当前/待处理状态；同页声明其目标包括可访问性、屏幕阅读器兼容和性能。[Lexical 官网](https://lexicaljs.org/)（访问日期：2026-09-09）
- GitHub 页面列出 MIT 许可、TypeScript 为主要语言、23.5k stars、2.2k forks 和 88 个 releases；官方 2024 OSS recap 报告 unique contributors 从 323 增至 428，并称 release 采用 monthly schedule（必要时有 ad hoc release）。[Lexical GitHub](https://github.com/facebook/lexical)、[2024 OSS recap](https://github.com/facebook/lexical/discussions/7220)（访问日期：2026-09-09）
- npm 页面显示 `lexical` 版本 0.50.0、约 3,861,987 weekly downloads、827 dependents，最近发布 6 天；`@lexical/react` 显示约 4,850,067 weekly downloads、版本 0.50.0，最近发布 19 小时。npm weekly downloads 是下载量，不等于活跃用户数。[`lexical` npm](https://www.npmjs.com/package/lexical)、[`@lexical/react` npm](https://www.npmjs.com/package/%40lexical/react)（访问日期：2026-09-09）
- 最近 release 页面显示 v0.50.0 在 2026-09-02 发布，内容包含正确性、可访问性、性能、屏幕阅读器 heading/auto-link announcement 和 tree-shaking 标注；同页 v0.49.0 还加入 editor operation benchmark suite，但没有发布跨库或 100k/50MB 的结果。[Lexical releases](https://github.com/facebook/lexical/releases)（访问日期：2026-09-09）
- 官方 issue #8834 报告 IME composition 被鼠标点击提交后会把长文档视口滚回 composition 位置；issue #8576 报告移动端点击表格单元格的 caret 定位不可靠。它们是当前风险信号，不代表所有平台都失败。[IME issue #8834](https://github.com/facebook/lexical/issues/8834)、[mobile issue #8576](https://github.com/facebook/lexical/issues/8576)（访问日期：2026-09-09）
- `HistoryPlugin` 源码支持传入 `externalHistoryState`，并说明它用于在 editor 之间共享 history stack；`@lexical/history` 还提供 `CLEAR_HISTORY_COMMAND`。[`HistoryPlugin` 源码](https://github.com/facebook/lexical/blob/main/packages/lexical-react/src/LexicalHistoryPlugin.ts)、[`@lexical/history` npm](https://www.npmjs.com/package/%40lexical/history)（访问日期：2026-09-09）

**推断**

- Lexical 的最小落地形态是“一个长期存活的 `LexicalComposer`/editor + 一个移动的 `ContentEditable` host”：激活节点时从该节点 JSON 解析 `EditorState`，编辑变化只写回该节点；静态行绝不创建 editor。官方明确“一实例连接一个 contenteditable”，所以该设计符合它的生命周期边界，但“把同一个 React host 在虚拟行之间移动”仍需原型确认。
- Flowlist 的 underline 不应假定能 Markdown round-trip。内置 transformer 列表没有 underline；UI 可以通过 Lexical text format 和 JSON/HTML 保存 underline，但如果产品要求 Markdown 中保留 underline，需要定义项目自己的扩展语法或降级规则，并写 round-trip 测试。
- 每个节点应保存独立 history，或在切换节点时 dispatch clear history；不能简单复用一个全局 history stack，否则 undo 可能跨节点。该风险来自单实例复用与官方 history API 的 stack 设计，是实现推断，需原型验证。
- 100k 节点性能主要取决于 Flowlist 的虚拟列表、静态 renderer、Worker 与搜索索引；Lexical 只看到一个小文档时，编辑热路径不会遍历整棵 Flowlist 树。官方 release 有 benchmark suite，但没有给出本项目容量证明，因此不能据此承诺目标。

### Tiptap / ProseMirror

**事实**

- ProseMirror 官方指南把文档定义为由 schema 约束的树形数据结构，并提供 `Node.toJSON`/`nodeFromJSON` 序列化；其模块包含 state、view、transform、commands、keymap、history 和 input macros。[ProseMirror Guide](https://prosemirror.net/docs/guide/)（访问日期：2026-09-09）
- Tiptap 官方文档说明其内部文档是 ProseMirror node，可通过 `editor.getJSON()` 得到 Tiptap JSON，并推荐 JSON 作为存储格式；schema 约束 nodes/marks 的合法结构。[Tiptap concepts](https://tiptap.dev/docs/editor/core-concepts/introduction)（访问日期：2026-09-09）
- 官方 React 安装指南直接覆盖 Vite + React/TypeScript，使用 `@tiptap/react` 的 `useEditor` 与 `EditorContent`；`@tiptap/starter-kit` 提供 paragraph、heading、bold、italic 等常用扩展。[Tiptap React 安装](https://tiptap.dev/docs/editor/getting-started/install/react)（访问日期：2026-09-09）
- 官方扩展目录列出 blockquote、code block、heading、horizontal rule、paragraph、task list/task item，以及 bold、code、italic、link、strike、underline 等 marks。[Tiptap extensions](https://tiptap.dev/docs/editor/extensions/overview)（访问日期：2026-09-09）
- 官方 Undo/Redo 扩展提供 `undo`/`redo`、可配置 history depth，默认 depth 为 100；官方 TaskList 文档说明 `[ ] ` 或 `[x] ` 会触发 task list input rule。[Undo/Redo](https://tiptap.dev/docs/editor/extensions/functionality/undo-redo)、[TaskList](https://tiptap.dev/docs/editor/extensions/nodes/task-list)（访问日期：2026-09-09）
- 官方 paste-rules 文档支持粘贴时按模式转换格式或节点，并以 `**bold**` 为例；keyboard-shortcuts 文档说明 core extensions 注册默认快捷键。[Paste rules](https://tiptap.dev/docs/editor/api/paste-rules)、[Keyboard shortcuts](https://tiptap.dev/docs/editor/core-concepts/keyboard-shortcuts)（访问日期：2026-09-09）
- Tiptap 官方性能指南建议将 editor 从无关 React state 隔离，使用 `useEditorState` 和 `shouldRerenderOnTransaction` 减少 React 重渲染；该指南同时提醒 React node views 会同步创建组件，多个 node views 可能昂贵。[Tiptap performance](https://tiptap.dev/docs/guides/performance)（访问日期：2026-09-09）
- 官方无障碍指南明确 Tiptap 是 headless，应用作者需提供键盘访问、toolbar/menu ARIA role、对比度和可离开的焦点路径；默认扩展产生语义 markup。[Tiptap accessibility](https://tiptap.dev/docs/guides/accessibility)（访问日期：2026-09-09）
- npm 页面显示 `@tiptap/core` 版本 3.31.3、约 13,757,245 weekly downloads、98 dependents，最近发布 4 天；`@tiptap/react` 版本 3.31.3、约 5,319,885 weekly downloads、1,934 dependents，最近发布 5 天。[`@tiptap/core` npm](https://www.npmjs.com/package/%40tiptap/core)、[`@tiptap/react` npm](https://www.npmjs.com/package/%40tiptap/react)（访问日期：2026-09-09）
- Tiptap GitHub API 返回仓库为 public、MIT、TypeScript，38,318 stars、3,114 forks、842 open issues，`pushed_at` 为 2026-09-08；GitHub issues 页面仍有 Android selection、Markdown round-trip 和 React remount 相关 issue。[Tiptap GitHub API](https://api.github.com/repos/ueberdosis/tiptap)、[Tiptap issues](https://github.com/ueberdosis/tiptap/issues)（访问日期：2026-09-09）

**推断**

- Tiptap 是功能覆盖最完整、schema/JSON/Markdown 路径最顺的备选；若项目已有 ProseMirror 经验，它可以是合理选择。
- 它的成本是 Tiptap + `@tiptap/pm` + extensions 的组合，以及 React wrapper 与 ProseMirror view 的生命周期协调。对于本项目“Effect 负责领域模型、React 只放一个活动 editor”的边界，这些能力并非不能用，但集成面大于 Lexical；官方性能指南也要求主动隔离 React 重渲染。
- 单实例复用可行的最小方案同样是保存每节点 JSON、切换 editor state、只保留一个 `EditorContent`；不过 Tiptap JSON 不包含可直接恢复的 undo history，节点级 history 需要单独设计。该结论是基于 API 形状的推断，不是官方承诺。
- 淘汰为唯一推荐的原因不是性能更差：官方没有可与 Lexical、Slate 或 BlockNote 横比的 bundle/100k benchmark。原因是 Flowlist 需要更窄的 React/编辑器边界，而 Tiptap 的 headless accessibility 和较多 extension 生命周期把更多 UI/验证责任留给项目。

### Slate

**事实**

- Slate 的官方数据模型使用 plain JSON；官方 serializing 文档直接给出 plaintext/HTML serialize 与反序列化方式。[Slate serializing](https://docs.slatejs.org/concepts/10-serializing)（访问日期：2026-09-09）
- Slate React 官方文档提供 `Slate`、`Editable`、`withReact` 和 render props；`Slate` 文档明确当前 `value` 不是严格 controlled value，以免直接编辑破坏 history。[Slate rendering](https://docs.slatejs.org/concepts/09-rendering)、[Slate component](https://docs.slatejs.org/libraries/slate-react/slate)（访问日期：2026-09-09）
- Slate history 是独立的 `withHistory` 插件，提供 undo/redo stacks 和 `HistoryEditor`。[Slate history](https://docs.slatejs.org/libraries/slate-history/with-history)、[HistoryEditor](https://docs.slatejs.org/libraries/slate-history/history-editor)（访问日期：2026-09-09）
- Slate 官方 FAQ 明确默认粘贴会解析成 plain text；由于 Slate 不预设 schema，HTML/Markdown 粘贴需应用自己覆盖 `insert_data` 并反序列化。[Slate FAQ](https://docs.slatejs.org/general/faq)（访问日期：2026-09-09）
- Slate 官方 FAQ 说明其目标是支持桌面和移动现代浏览器，但项目处于 beta、社区驱动，支持“不如应有的稳健”；iOS 不定期测试，Android 输入使用不同的 composition/mutation 路径，可能有更多 bug。[Slate FAQ](https://docs.slatejs.org/general/faq)（访问日期：2026-09-09）
- Slate 官方性能指南专门讨论 10,000+ 和 100,000+ blocks，并提供 experimental chunking；指南称理想情况下 chunking 可有 10x speed-up，同时指出 Chrome/Safari 大量 DOM painting 可能成为主要瓶颈，建议 chunking + `content-visibility: auto`。[Slate performance](https://docs.slatejs.org/walkthroughs/09-performance)（访问日期：2026-09-09）
- Slate TypeScript 文档要求定义全局 `CustomTypes`，并警告一个 Slate 类型系统只支持一个 document model；扩展多个 document model 未充分测试。[Slate TypeScript](https://docs.slatejs.org/concepts/12-typescript)（访问日期：2026-09-09）
- Slate 官方仓库说明当前仍是 beta、没有 1.0 时间表，API 可能继续 breaking change，并称项目是 contributor-driven、没有大公司 backing。[Slate GitHub](https://github.com/ianstormtaylor/slate)（访问日期：2026-09-09）
- GitHub 页面显示 Slate 约 31.7k stars、3.3k forks；issues 页面显示 630 issues，并有 Android IME、selection、large document 等开放问题。[Slate GitHub](https://github.com/ianstormtaylor/slate)、[Slate issues](https://github.com/ianstormtaylor/slate/issues)（访问日期：2026-09-09）
- npm 页面显示 `slate` 0.126.2、约 2,651,611 weekly downloads、1,351 dependents，最近发布 1 个月；`slate-react` 0.126.4、约 2,317,726 weekly downloads、1,137 dependents，最近发布 11 天。[`slate` npm](https://www.npmjs.com/package/slate)、[`slate-react` npm](https://www.npmjs.com/package/slate-react)（访问日期：2026-09-09）

**推断**

- Slate 的 plain JSON 和 React render props 很适合表达标题/备注自定义模型，但 Flowlist 需要的 rich-text schema、Markdown 粘贴、快捷输入、节点类型和可访问交互几乎都要项目自己实现；这违反“已有能力优先”的最低风险目标。
- Slate 是四者中唯一给出 100k blocks 性能指导的官方候选，但那是优化方法和理想情况下的 10x 描述，不是对 Flowlist 50 MB、移动端和虚拟列表组合的 benchmark。它不能抵消默认粘贴、beta/移动端稳健性和自定义功能成本。
- 结论：淘汰。不是因为社区小或 npm 使用量低，而是核心能力需要重复搭建，且官方明确提示 schema、移动端和 1.0 稳定性风险。

### BlockNote（相关候选）

**事实**

- BlockNote 官方将自己定位为面向 React、block-based、开箱即用的 rich-text editor；React 入口是 `useCreateBlockNote` + `BlockNoteView`，并提供 toolbar、side menu、block types。[BlockNote introduction](https://www.blocknotejs.org/docs)、[React overview](https://www.blocknotejs.org/docs/react/overview)（访问日期：2026-09-09）
- 官方 Block 结构包含稳定 `id`、`type`、`props`、`content` 和递归 `children`；官方推荐 `editor.document` 的 BlockNote JSON 作为无损存储格式。[Document structure](https://www.blocknotejs.org/docs/foundations/document-structure)、[Format interoperability](https://www.blocknotejs.org/docs/foundations/supported-formats)（访问日期：2026-09-09）
- 官方 API 提供 undo/redo；官方 format 页面列出 BlockNote JSON/HTML/Markdown 的导入导出，并明确 HTML/Markdown 转换可能 lossy。[Editor API](https://www.blocknotejs.org/docs/reference/editor/overview)、[Format interoperability](https://www.blocknotejs.org/docs/foundations/supported-formats)（访问日期：2026-09-09）
- 官方 React 文档说明 `useCreateBlockNote` 创建 editor instance，`BlockNoteView` 是 uncontrolled component，内容通过 `initialContent` 初始化，编辑器内部管理状态和性能优化。[Editor setup](https://www.blocknotejs.org/docs/getting-started/editor-setup)（访问日期：2026-09-09）
- BlockNote 官方仓库说明它直接构建在 ProseMirror 和 Tiptap 之上；仓库页面显示约 10.1k stars、762 forks。npm 页面显示 `@blocknote/core` 0.54.0、约 434,771 weekly downloads、98 dependents，最近发布 5 天。[BlockNote GitHub](https://github.com/TypeCellOS/BlockNote)、[`@blocknote/core` npm](https://www.npmjs.com/package/%40blocknote/core)（访问日期：2026-09-09）
- BlockNote release notes 显示 v0.51.0（2026-05-14）重写 Markdown parser/serializer 以移除约 80 个依赖，并包含 codeblock input rule、paste、移动 formatting toolbar 和 a11y 修复。[BlockNote v0.51.0 release](https://github.com/TypeCellOS/BlockNote/releases)（访问日期：2026-09-09）
- 官方文档提供静态 HTML rendering；`ServerBlockNoteEditor` 可把 blocks 转成静态 HTML，但这是 BlockNote 的静态输出路径，不是证明其可在 Flowlist 100k 行中直接挂载编辑器。[Static rendering](https://www.blocknotejs.org/examples/backend/rendering-static-documents)（访问日期：2026-09-09）

**推断**

- BlockNote 的 block JSON 与 Workflowy 层级直觉最接近，可能是最快做出 Notion 风格 demo 的候选；但 Flowlist 仍需“节点标题 + 节点备注”的领域模型、自己的虚拟树和单活动 editor，BlockNote 的完整 block editor UI 会把更多 DOM、默认行为和依赖带入热路径。
- 它底层依赖 Tiptap/ProseMirror，不能把 BlockNote 的 block model 当作独立性能证明；官方没有发布 100k/50MB 或跨编辑器 bundle benchmark。Markdown 页面还明确 lossy，Flowlist 若把 Markdown 当粘贴/快捷输入而非主要存储格式，仍需额外验收。
- 结论：淘汰。它是最相关的替代候选，但对本项目的“只挂载一个小型活动编辑器、其余静态虚拟渲染”边界偏重；功能便利不足以抵消额外抽象层。

## 对比矩阵

| 候选 | 原生模型/序列化 | Flowlist 所需功能 | React/单活动实例 | IME/移动端/无障碍 | 维护与 npm 信号 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **Lexical** | 不可变 EditorState；JSON；Markdown/HTML 转换 | rich text、heading/quote/code/list/link/hr、history；underline Markdown 需自定义 | 官方 React；一个 editor 对一个 contenteditable，适配单活动 host | 目标包含 WCAG/屏幕阅读器；存在当前 IME/移动 issue | Meta 官方仓库、月度 release 信号；`lexical` 约 3.86M weekly downloads | **唯一推荐** |
| Tiptap/ProseMirror | schema + ProseMirror node；Tiptap JSON | 覆盖最完整；Markdown/paste/input rules 路径成熟 | 官方 React；需处理 wrapper/transaction 重渲染与节点切换 | headless，ARIA/键盘由项目负责；移动端需真实验收 | 约 5.32M React weekly downloads；仓库活跃、issue 多 | 功能强，但集成面更大 |
| Slate | plain JSON Descendant；用户定义 element/leaf | 功能靠 render/插件自行搭建；默认粘贴纯文本 | React 原生风格；history 独立 | 官方承认 beta、移动端不够稳健；可访问性主要由项目实现 | 约 2.32M React weekly downloads，但无 1.0 时间表 | 淘汰 |
| BlockNote | block JSON：id/type/props/content/children | block UI、Markdown/HTML、history 开箱即用；Markdown 可 lossy | 官方 React，但 `BlockNoteView` uncontrolled 且偏完整编辑器 | 有移动/a11y 修复记录；真实设备仍需验收 | 约 434k core weekly downloads；基于 Tiptap/PM | 淘汰：对 Flowlist 偏重 |

矩阵中的 npm 数字是页面在访问日显示的 weekly downloads，不能直接比较用户数或运行时性能；GitHub stars/issues 也是动态快照。

## 性能与 bundle：已证实和未证实

### 已证实

- Slate 官方提供 10k/100k blocks 的性能优化指南和 experimental chunking，但给出的 10x 是“ideal circumstances”的描述，且重点是 React 重渲染和 DOM painting。[Slate performance guide](https://docs.slatejs.org/walkthroughs/09-performance)（访问日期：2026-09-09）
- Tiptap 官方提供 React integration performance guide，明确说明无关 React 重渲染是常见问题，并提供 `useEditorState`、`shouldRerenderOnTransaction` 和 editor isolation。[Tiptap performance guide](https://tiptap.dev/docs/guides/performance)（访问日期：2026-09-09）
- Lexical release notes 说明已有 editor operation benchmark suite，但页面没有给出可与其他候选对齐的数值、文档规模、设备或 bundle 口径。[Lexical releases](https://github.com/facebook/lexical/releases)（访问日期：2026-09-09）

### 未证实

- 没有找到由 Lexical、Tiptap/ProseMirror、Slate、BlockNote 共同使用同一版本、同一浏览器、同一内容、同一交互指标的 bundle size 或 typing/INP/initial render benchmark。
- 没有找到任何候选官方资料能证明“100,000 nodes + 50 MB + 移动端 + Flowlist 虚拟列表 + 单实例切换”达到无感交互。
- 官网的 “fast/performance” 定位、npm 下载量、GitHub stars 都不能替代本项目 benchmark；报告不据此编造排名。

## Flowlist 最小验证原型

只做一个 vertical slice，不先引入新的编辑器抽象：

1. 创建 10,000 个节点，再扩展到 100,000 个节点；每节点包含短标题和备注 JSON。Flowlist 的树、搜索索引、Effect command、存储/Worker 与虚拟列表保持项目现有边界。
2. 只渲染可见静态节点；激活一行时把同一个 `ContentEditable` host 移到该行，编辑器 state 从该节点 JSON 恢复，失活时序列化回该节点。不要为每个静态节点创建 editor。
3. 用 Lexical 最小插件集覆盖：heading、paragraph、quote、code block、horizontal rule、checklist、bold、italic、underline、strikethrough、inline code、link、Markdown import/export/shortcut、undo/redo。
4. 明确 undo 语义：A 节点编辑后切到 B，再回 A，A 的 undo 只能撤销 A；切换节点不得跨节点撤销。原型验证 `CLEAR_HISTORY_COMMAND` 或按节点维护 history 的方案。
5. 录制 Chrome/Edge 桌面和 Safari iOS：首次激活、连续输入、中文拼音/韩文 composition、Markdown 粘贴、Enter/Tab、撤销、滚动、激活相邻节点。指标至少记录 typing INP、激活耗时、输入丢失、selection/caret 是否跳动、内存和 DOM 节点数。
6. 对 50 MB 数据模拟 localStorage 写入与失败；保存应在 Effect Worker/存储边界处理，编辑器只发节点级变更。此项不是编辑器性能 benchmark，但能发现完整 JSON stringify 阻塞热路径。
7. 对 underline 制定一个明确策略：JSON/HTML 保留；Markdown 粘贴/导出采用项目约定（例如 HTML `<u>` 或纯文本降级），并测试无损/有损边界。

原型通过条件：100k 静态节点初始加载不创建 100k contenteditable；激活/失活不丢文本和选区；目标设备中文输入无已知阻断；连续输入的 p95 INP 和激活 p95 满足产品团队定义的“无感”阈值。阈值应由真实设备测量后定，不在本报告捏造。

## 主要风险与应对

| 风险 | 影响 | 最小应对 |
| --- | --- | --- |
| 单实例切换带来跨节点 history | undo 修改错误节点，用户数据风险 | 每节点独立 history 或切换时 clear；原型必测 |
| Lexical Markdown 没有 underline transformer | Markdown round-trip 丢失 underline | 定义项目扩展/降级规则；JSON 作为权威存储 |
| IME/移动端 edge case | 中文/韩文输入、移动 caret 或滚动异常 | 直接验收 Safari iOS/Android 与 composition；跟踪官方 issue |
| 编辑器误知整棵树 | 重渲染、序列化、DOM 激增 | 编辑器只接收当前节点；树结构命令留在 Effect/React 外层 |
| 静态 renderer 与编辑 renderer 不一致 | 激活时布局跳变、selection 偏移 | 同一份内容 fixture 做静态/编辑双向 snapshot 与视觉验收 |
| 依赖版本频繁变动 | minor release 引入行为变化 | 锁定版本；升级时运行原型回归，保留 JSON/Markdown fixtures |

## 检索命令与限制

使用的并行检索命令（按 `parallel-web-search` 规范）：

```sh
parallel-cli search "Select a React rich text editor for Flowlist: compare Lexical, Tiptap/ProseMirror, Slate, and BlockNote against official features, serialization, React integration, IME/mobile/accessibility, maintenance, npm signals, bundle size, and performance evidence." \
  -q "Lexical official docs React serialization history markdown GitHub npm" \
  -q "Tiptap ProseMirror official docs React JSON history Markdown GitHub npm" \
  -q "Slate official docs React serialization performance mobile GitHub npm" \
  -q "BlockNote official docs React block JSON Markdown GitHub npm" \
  --json --max-results 20 --excerpt-max-chars-total 27000 \
  -o "/tmp/flowlist-editor-library.json"
```

该命令在本次运行中因 `APIConnectionError` 未产出 JSON；随后使用官方文档、GitHub 页面/API 和 npm 页面逐项复核。相关来源均在正文事实条目旁给出，访问日期统一为 2026-09-09。

未验证项：

- 没有运行 Flowlist 原型，因此 100k/50MB 延迟、内存、INP、移动端 IME 和实际 bundle 均为 **未验证**。
- 没有为四个候选构建同一功能集并用同一 Vite 配置测 bundle；报告不提供伪精确 KB 数字。
- GitHub stars/issues、npm weekly downloads 会变化；正文数字是访问日页面快照，不是历史时间序列。
- 访问到的 GitHub/npm 页面部分由动态页面生成，若页面后续更新，应以锁定版本和保存的 API 响应重新核验。

## 来源索引

- [Lexical GitHub](https://github.com/facebook/lexical)
- [Lexical Editor State](https://facebook-lexical.mintlify.app/concepts/editor-state)
- [`@lexical/markdown` README](https://github.com/facebook/lexical/blob/main/packages/lexical-markdown/README.md)
- [Lexical releases](https://github.com/facebook/lexical/releases)
- [Lexical 2024 OSS recap](https://github.com/facebook/lexical/discussions/7220)
- [`lexical` npm](https://www.npmjs.com/package/lexical)
- [`@lexical/react` npm](https://www.npmjs.com/package/%40lexical/react)
- [ProseMirror Guide](https://prosemirror.net/docs/guide/)
- [Tiptap concepts](https://tiptap.dev/docs/editor/core-concepts/introduction)
- [Tiptap React install](https://tiptap.dev/docs/editor/getting-started/install/react)
- [Tiptap extensions](https://tiptap.dev/docs/editor/extensions/overview)
- [Tiptap performance](https://tiptap.dev/docs/guides/performance)
- [Tiptap accessibility](https://tiptap.dev/docs/guides/accessibility)
- [Tiptap GitHub API](https://api.github.com/repos/ueberdosis/tiptap)
- [`@tiptap/react` npm](https://www.npmjs.com/package/%40tiptap/react)
- [Slate GitHub](https://github.com/ianstormtaylor/slate)
- [Slate FAQ](https://docs.slatejs.org/general/faq)
- [Slate performance](https://docs.slatejs.org/walkthroughs/09-performance)
- [Slate serializing](https://docs.slatejs.org/concepts/10-serializing)
- [`slate-react` npm](https://www.npmjs.com/package/slate-react)
- [BlockNote GitHub](https://github.com/TypeCellOS/BlockNote)
- [BlockNote introduction](https://www.blocknotejs.org/docs)
- [BlockNote document structure](https://www.blocknotejs.org/docs/foundations/document-structure)
- [BlockNote format interoperability](https://www.blocknotejs.org/docs/foundations/supported-formats)
- [BlockNote releases](https://github.com/TypeCellOS/BlockNote/releases)
- [`@blocknote/core` npm](https://www.npmjs.com/package/%40blocknote/core)
