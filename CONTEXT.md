# Flowlist

本地优先的大纲工具：用户在唯一一份无限层级节点树中记录、拆解和整理内容。

## Language

**Outline**:
用户在应用中维护的唯一一份文档，由一棵节点树构成。
_Avoid_: 文档、笔记本、工作区

**Node**:
大纲中的一个条目，含富文本标题、可选备注、类型、完成状态和折叠状态。
_Avoid_: 条目、item、卡片

**Root Node**:
不可见的虚拟节点，所有顶层节点的父节点。
_Avoid_: 根视图（根视图指显示状态，不是节点）

**Focus**:
把某个节点当作当前视图的根，只展示它及其后代；不改变树结构。
_Avoid_: 缩放、进入

**Keyboard Focus（键盘焦点）**:
输入焦点的所在位置，决定按键作用于哪个节点。
_Avoid_: 聚焦（“聚焦”专指 Focus）

**Breadcrumb**:
聚焦状态下从根节点到当前节点的路径序列，用于逐级或一步返回。
_Avoid_: 导航栏

**Bullet（普通条目）**:
默认节点类型，始终显示圆点，聚焦、折叠、待办控件挂在圆点上。
_Avoid_: bullet point、圆点项

**Paragraph（段落）**:
无圆点的纯文本节点，仍可包含子节点，与普通条目数据同构，仅渲染不同。
_Avoid_: 文本块

**Todo**:
一种节点类型，带可切换的完成状态。
_Avoid_: 任务、checklist item

**Collapse**:
隐藏某节点子树的显示状态；只影响展示，不影响数据。
_Avoid_: 收起（允许，但统一用折叠）

**Note**:
节点标题之外独立的富文本备注字段。
_Avoid_: 描述、详情

**Preferences（UI 偏好）**:
仅影响当前浏览器界面体验的设置（如主题），不属于大纲数据。
_Avoid_: 元数据（元数据专指大纲自身的附带信息）

## Relationships

- 一个 **Outline** 只有一棵节点树，树挂在唯一的 **Root Node** 下
- 一个 **Node** 恰好有一个父 **Node**（顶层节点的父是 **Root Node**）
- **Focus** 只改变视图，不改变任何 **Node** 的父子关系
- **Collapse** 与 **Todo** 完成状态相互独立，也与 **Focus** 独立

## Example dialogue

> **Dev:** "用户在搜索结果里点了一个节点并聚焦，折叠状态会丢吗？"
> **Domain expert:** "不会。**Focus** 只是换视图，每个 **Node** 的 **Collapse** 状态独立保存在节点上，返回原视图后原样恢复。"

## Flagged ambiguities

- “聚焦”曾同时指 zoom-in 和 keyboard focus——已解决：聚焦专指 Focus，键盘焦点独立成词，UI 与无障碍文案不得混用。
- README 曾写“数据保存在 localStorage”——已解决：本地数据统一指 IndexedDB，README 已修正。
- “元数据”曾同时指 IndexedDB 的大纲附带信息和 UI 偏好——已解决：元数据属于大纲，UI 偏好独立于大纲数据。
