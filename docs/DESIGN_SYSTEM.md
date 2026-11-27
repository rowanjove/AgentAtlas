# AgentAtlas Design System

> **定位**: `Modern · Editorial · Refined · Technical · Minimal`  
> 本文档定义 AgentAtlas 本地 AI Agent 工程研究与学习工作台的统一视觉语言、Design Tokens、组件规范与布局体系。

---

## 1. 设计原则

1. **编辑式克制 (Editorial Clarity)**: 以长文阅读清晰度、结构留白与字重对比建立层次，拒绝 SaaS 仪表盘式卡片堆砌、欢迎横幅和宣传文案。
2. **中性画布与精准强调**: 采用低饱和度冷灰中性表面承载内容，仅使用纯色品牌蓝标注关键主操作、选中状态、链接与焦点。
3. **双主题独立校色**: 浅色与深色模式分别针对纸面阅读和暗室工程工作台调整背景阶梯、边框对比度及语义色，不做简单反色。
4. **完全离线自包含**: 字体栈优先匹配本地高质量无衬线与等宽字体，零外部 CDN 字体/图标请求。

---

## 2. Design Tokens

所有 JS/CSS Tokens 统一维护在 [tokens.ts](../../packages/shared/src/tokens.ts) 与 [index.css](../../apps/web/src/index.css)。

### 2.1 色彩规范

| 语义变量 | 浅色 (Light) | 深色 (Dark) | 用途 |
| :--- | :--- | :--- | :--- |
| `--bg` | `#F7F8FA` | `#111317` | 应用底层工作区画布 |
| `--panel` | `#FFFFFF` | `#181B20` | 主阅读面、导航栏、工具栏与抽屉 |
| `--panel-sec` | `#EEF1F5` | `#20242B` | 代码块、表头、分段控件轨道 |
| `--panel-hover` | `#F2F4F8` | `#262B34` | 表格行、列表项悬停反馈 |
| `--border` | `#E3E6EB` | `#2B3039` | 常规分割线与 1px 描边 |
| `--border-strong` | `#CFD5DF` | `#3A414E` | 控件边界、滚动条与强调分割 |
| `--text` | `#171B22` | `#EEF1F6` | 主正文、标题与强交互文本 |
| `--text-sec` | `#475162` | `#B8C1CF` | 描述文案、元信息、非激活标签 |
| `--text-muted` | `#646F82` | `#8E99AA` | 占位提示、时间戳、路径 ID |
| `--primary` | `#315DB5` | `#84A6EF` | 主按钮、聚焦环、链接、激活态 |
| `--primary-hover` | `#284E9A` | `#9BB7F4` | 主按钮悬停 |
| `--selected-bg` | `#EAF0FC` | `#25334E` | 导航选中项、列表/表格选中背景 |
| `--success` | `#1F7A54` | `#5DC296` | 已读/通过自测、正常步态 |
| `--warning` | `#9A630A` | `#E2B45E` | 待复习、模拟告警、差异提示 |
| `--error` | `#C0393E` | `#F08387` | 危险操作、拦截错误、执行异常 |

### 2.2 字体与排版

- **无衬线字体 (`--font-sans`)**: `"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif`（保留 Windows ClearType 原生渲染，不使用会令中文笔画发虚的抗锯齿覆盖）
- **等宽字体 (`--font-mono`)**: `"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace`
- **字号阶梯**:
  - 页面主标题：`24–26px`（`font-semibold`, `tracking-tight`）
  - 区块标题：`16–18px`（`font-semibold`）
  - 组件标题：`14–15px`
  - 常规界面文字：`14px`（正文、表格、导航、输入框与按钮）
  - 知识正文（`.atlas-prose`）：`16px`（支持设置 `14–19px` 调节），行高 `1.78`，默认阅读栏宽 `--reader-width: 760px`
  - 辅助元信息 / Monospace ID：`12–13px`（最低 `12px`，禁止在中文正文或说明文字中使用 `<12px` 字号）

### 2.3 间距、圆角、阴影与动效

- **间距体系 (4px 基准)**: `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48px`
- **圆角规范**:
  - `--radius-xs` (`4px`): 标签、`xs` 按钮、树节点、快捷键徽章
  - `--radius-sm` (`6px`): `sm/md` 按钮、输入框、下拉框、分段控件
  - `--radius-md` (`8px`): 表格容器、内容面板、画布节点、Toast
  - `--radius-lg` (`12px`): 原生模态 `<dialog>` 弹窗
- **克制动效**:
  - `--duration-instant`: `90ms`（悬停高亮、tooltip）
  - `--duration-fast`: `140ms`（按钮状态、开关位移、颜色切换）
  - `--duration-normal`: `200ms`（侧栏折叠、进度条宽度）
  - `--duration-slow`: `300ms`
  - 严格尊重 `@media (prefers-reduced-motion: reduce)` 与 `:root[data-reduced-motion="true"]`。

---

## 3. 公共组件库 (`apps/web/src/components/ui`)

所有业务页面必须复用 `apps/web/src/components/ui` 导出的标准组件，禁止在页面内私写不一致的按钮或表单样式。

- **品牌标识**: `BrandMark`（使用 [brand-icon.png](../../apps/web/public/brand-icon.png) 品牌图形标，配套 [favicon-32.png](../../apps/web/public/favicon-32.png) 与桌面 [agent-atlas.ico](../../assets/agent-atlas.ico)）。
- **按钮系统 (`Button.tsx`)**:
  - `Button`: 支持 `variant` (`primary | secondary | outline | ghost | destructive`) 与 `size` (`xs=28px | sm=32px | md=36px | lg=40px`)，统一提供 `loading`、`disabled`、`active` 与 `focus-visible`。同一视觉区域内最多出现 1 个 `primary` 按钮。
  - `IconButton`: 强制 `aria-label`，用于工具栏与关闭动作。
  - `SplitButton`: 主动作与扩展菜单组合。
- **表单控件 (`FormControls.tsx`)**: `Input`、`Textarea`、`Select`、`Checkbox`、`Radio`、`Switch`（`role="switch"`）。
- **标签与导航 (`Tabs.tsx`, `DataDisplay.tsx`)**:
  - `Tabs`: 支持 `underline`（页内分类）与 `segmented`（视图切换），遵循 ARIA `tablist`/`tab`/`aria-selected` 与键盘方向键导航，选中态同时具备色值与下划线形状指示。
  - `Breadcrumb`、`Tree`、`Table`、`Pagination`、`Badge`、`Progress`、`Skeleton`、`EmptyState`、`ErrorState`。
- **浮层与通知 (`Overlay.tsx`, `Toast.tsx`)**:
  - `Dialog` & `ConfirmDialog`: 基于原生 `<dialog>` + `showModal()`，具备滚动隔离 (`overscroll-behavior: contain`)、ESC 关闭、安全操作默认聚焦。
  - `Drawer`: 支持按需呼出与边缘拖拽调宽（状态持久化至 `localStorage`）。
  - `Popover` / `Dropdown` / `Tooltip`。
  - `ToastViewport`: `role="region" aria-label="系统通知"`，支持悬停/聚焦暂停自动消失与手动关闭。
- **图标规范**: 统一使用 `lucide-react`（默认 `strokeWidth={1.75}`），禁止 Emoji 替代功能图标。

---

## 4. 工作台布局与场景模式

- **全局壳层 (`AppShell`)**: 左侧可折叠全局导航（`212px / 56px`，底部固定放置「设置」与「主题」切换）+ 顶部 `48px` 上下文工具栏（动态面包屑、`Ctrl+K` 命令面板入口、AI 导师开关）+ 中央场景画布 + 按需滑出右侧可调宽抽屉。
- **场景差异化**:
  - **首页 Overview**: 非对称两栏编辑式工作台（继续学习焦点条 + 路线进度清单 + 双列领域索引），避免大横幅与重复指标卡。
  - **学习路线 Learning**: 工程级 DAG 依赖图（支持阶段聚焦降噪 + 节点详情抽屉）与课程清单双视图。
  - **知识百科 Library**: 左侧可折叠目录树（含全文片段匹配高亮）+ 中央无卡片化长文阅读画布 + 双向链接悬停预览 + 按需目录/图谱/来源抽屉。
  - **可视化实验室 Playground**: IDE / Debugger 式上下分栏（统一播放/单步控制栏 + 执行流画布 + 同步时间轴与 State Diff 检查器），显式标注 `simulated: true`。
  - **技术生态 Ecosystem**: 表格/列表视图切换 + 滑出详情抽屉 + 无主观评分的并列对比矩阵。
  - **偏好设置 Settings**: 桌面软件风格双栏分组设置，危险恢复与密钥清理操作接入 `ConfirmDialog`。

---

## 5. 禁用清单 (Anti-Patterns)

- 禁止大面积高饱和蓝紫渐变、霓虹发光、毛玻璃叠层或伪 3D 立体阴影。
- 禁止将阅读文档拆分为大量嵌套圆角卡片。
- 禁止在同一区域并排放置多个同等权重的 `primary` 按钮。
- 禁止在未经过 `Dialog` / `ConfirmDialog` 确认的情况下直接执行不可逆回滚或密钥清除。
