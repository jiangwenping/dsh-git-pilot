# DSH 插件需求设计：Git 分支助手 + 会话变更面板（`dsh-git-pilot`）

> 版本：v0.2（需求设计稿；2026-09-23 评审确认三项关键决策，见 §0）
> 日期：2026-09-23
> 对标截图：Cursor 风格的「项目 / 分支选择器」与「会话变更（Changes）面板」
> 目标平台：DeepSeek Harness（DSH）Web GUI，Host 插件 + Client 插件双端

---

## 0. 决策记录（2026-09-23 评审确认）

| # | 决策点 | 结论 |
|---|---|---|
| DR-1 | F2 变更统计口径 | **自建会话基线 diff**（会话创建时刻仓库状态 → 当前工作区），不复用每 turn 摘要聚合（§5.2 D2） |
| DR-2 | untracked 新文件行数 | **按非空行计数**（`+n` 计入总行数；读取受 `maxFileBytes` 限制，超限显示 `too large` 不计数） |
| DR-3 | 插件命名 | **`dsh-git-pilot`** |
| DR-4 | 下一阶段 | 设计稿评审通过后再启动 M1+M2 实现；在此之前不写实现代码 |

§8 中剩余开放问题（Q1、Q3）在评审未给出结论前，按文中「建议」项执行。

---

## 1. 背景与目标

用户在 DSH Web GUI 中进行日常开发时，缺少两个 Cursor 已验证的高频能力：

1. **新建会话时选择项目后，自动带出该项目（git 仓库）当前分支**；点击分支可下拉：搜索分支、切换分支、创建新分支。
2. **会话创建后，右侧面板实时展示本会话改动了多少文件、多少行代码**（类 Cursor 右侧 "On \<project\> / Changes" 面板），可逐文件查看变更行数与 diff。

本插件在 DSH 现有扩展点上补齐这两个能力，**不修改 DSH 核心**，完全以插件（Host + Client 双半）形式交付。

### 1.1 截图红框 → 功能映射

| 红框 | 截图位置 | 功能 | 本设计覆盖 |
|---|---|---|---|
| 红框① | 截图1 新会话输入框上方 | 项目选择 chip（`ins-bd-internal ⌄`） | ✅ F1（展示 + 复用 DSH 工作区选择器） |
| 红框② | 截图1 项目右侧 | 分支 chip（`feature/20260917-vue3 ⌄`） | ✅ F1（自动带出 + 下拉 + 创建） |
| 红框③ | 截图2 会话页右上 | `On ins-bd-internal` + Changes 面板入口 | ✅ F2（右侧栏新增 Changes 标签页） |
| 红框④ | 截图2 底部输入框下方 | 会话内分支显示（`⎇ feature/... ⌄`） | ✅ F1（composer 底部分支行） |
| 红框⑤ | 截图3 | 分支下拉：搜索 / 当前置✓ / `+ Create Branch` | ✅ F1.2 / F1.3 |
| — | 截图2 右上 Browser / Terminal / Files | 浏览器 / 终端 / 文件面板 | ❌ 非本期目标（Terminal DSH 已有） |
| — | 截图1/2 `This Mac ⌄` | 远程开发机切换 | ❌ 非本期目标（DSH 仅本机），见 §8 |

### 1.2 成功标准（验收）

- [ ] 新会话页选择项目（工作区）后，2 秒内在 composer 区域自动显示该仓库当前分支；非 git 目录不显示、不报错。
- [ ] 点击分支 chip 弹出下拉：搜索框（自动聚焦、子串过滤）、分支列表（当前分支第一且带 ✓）、底部 `+ Create Branch`。
- [ ] `Create Branch`：行内输入名称（带默认命名模板）、回车创建并切换；非法 ref 名 / 重名给出明确错误，重名时提供「切换到该分支」。
- [ ] 会话页右侧栏出现 `Changes` 标签页：头部显示 `On <branch>`、`N 个文件 / +X −Y` 行数统计；文件行显示路径 + 每文件 +a/−d；点击文件可看 diff。
- [ ] 统计口径：**本会话基线 → 当前工作区** 的累计变化（含 Agent 用 Bash 产生的改动），turn 结束 / 窗口聚焦 / 手动刷新时更新。
- [ ] 分支切换为显式用户操作，永不自动触发；有未提交改动或其他活跃会话共用该工作区时给出确认。
- [ ] 全部 UI 文案走 DSH locale（zh/en），颜色走主题 token，深浅色适配。

---

## 2. 现状调研：DSH 已有的能力（设计依据）

设计前已核对 DSH 源码（`/Users/wenping/tools/deepseek-harness`）与已交付插件 `dsh-mnemon` 的惯例，关键结论：

| 现有能力 | 位置 | 对本设计的作用 |
|---|---|---|
| 工作区=项目模型：`workspaceRegistry` / `workspaceController`（`follow` 流、`create/rename/delete/pin…`） | Host Service 目录 | 「项目」= Workspace，含 `path`（即 git 仓库根）；前端已有 workspace store |
| Hero 工作区选择器：slot `conversation.hero.workspace`；`selectWorkspace(workspaceId)` 会**直接打开该工作区的空白会话** | `packages/client/ui-conversation/src/client/contract/slots.ts` | 选完项目的瞬间会话已存在 → 分支 chip 挂 session 作用域 slot 即可覆盖「新会话」场景 |
| Composer 扩展位：`conversation.input.left`（工具行左侧 list）、`conversation.composer.dock`（输入卡下方 list）、`conversation.composer.bar`（session-maybe 整体替换） | 同上 | 分支 chip / 底部分支行的挂载点 |
| 右侧栏标签页：keyed slot `sidebar.right.pane.tab`（按 tab 类型 id 注册 body）、`sidebar.right.pane.tab.title`、`sidebar.right.tab.menu.item` | `packages/client/ui-sidebar-right/src/client/contract/slots.ts` | F2 的 Changes 面板 = 注册一个新 tab 类型，无需改布局 |
| **每 turn 变更记录已存在**：Host 插件 `workspace-changes`（git turn 前后快照 + 文件工具编辑捕获，`workspace/changes` 会话事件 + `workspaceChanges.summary/diff` 服务 + `/api/changes.summary`、`/api/changes.diff` 路由），Client `ui-deliverables` 已渲染每 turn 变更文件卡与逐文件 Review 标签页 | `packages/deliverables/workspace-changes`、`packages/client/ui-deliverables` | 复用其 git 执行模式（`subprocess`、macOS Xcode git stub 处理）；F2 的**会话级累计口径**需自建（见 §5.2 决策） |
| 插件外挂惯例：`dsh-mnemon`（host `apply/inject/Config` + `src/client` + `package.json.dsh.client.inject` + `cordis.patch.yml` 挂载 + connection-RPC 通道 + locale 注册） | `/Users/wenping/tools/dsh-mnemon` | 新插件照此结构交付，风险最低 |
| git 读取参考实现：`dsh-mnemon/src/git-branch.ts`（`git -C <root> branch --show-current`，2s 超时，失败返回 undefined） | 同上 | 「自动带出当前分支」的最小实现已验证 |

**结论**：DSH 没有任何 git 分支管理能力（Host Service 目录无 git 服务），F1 完全新建；F2 的数据基础设施大半现成，缺「会话级累计口径」与右侧聚合面板。

---

## 3. 用户故事

- **US-1（新建会话选分支）**：作为开发者，我在新会话页选择项目后，希望立刻看到该项目当前分支，并在发消息前就能切到/新建功能分支，避免 Agent 在错误分支上开工。
- **US-2（会话中看分支）**：作为开发者，我希望会话页底部常驻显示当前分支，随时可切换，与 Cursor 一致。
- **US-3（会话变更总览）**：作为开发者，我希望在右侧面板一眼看到「这个会话改了几个文件、加了多少行、删了多少行」，并逐文件查看 diff，用于自查与评审。
- **US-4（创建分支）**：作为开发者，我希望下拉底部有 `+ Create Branch`，按团队命名模板（如 `feature/yyyyMMdd-xxx`）快速建分支并切换。
- **US-5（安全护栏）**：作为用户，当工作区有未提交改动或同工作区还有别的会话在跑时，我希望切分支前被明确提醒，而不是静默丢失工作现场。

---

## 4. 功能需求（FR）

### F1 项目 / 分支选择器（红框①②④⑤）

#### F1.1 分支自动带出
- **FR-1.1** Client 侧监听当前会话/工作区变化；工作区变化后调用 Host `gitPilot.status(workspacePath)`。
- **FR-1.2** `status` 返回 `{ isRepo, branch, upstream, ahead, behind, dirtyFiles, added, deleted }`；非 git 目录 `isRepo: false`，UI 整体不渲染（无 chip、无面板）。
- **FR-1.3** HEAD 分离（detached HEAD）时 chip 显示短 commit hash + `(detached)` 提示；仍可下拉切分支。
- **FR-1.4** 项目 chip 显示 workspace 标题（默认 `ins-bd-internal` 风格即目录名）；点击复用 DSH 现有工作区选择交互（本期不重造项目选择器）。

#### F1.2 分支下拉（红框⑤）
- **FR-1.5** 挂载点：chip 点击弹 popover（对齐 Cursor 截图3 的圆角浮层）。
  - 顶部搜索框：自动聚焦；按子串大小写不敏感过滤；`Esc` 关闭。
  - 列表：当前分支排第一且右侧 ✓；其余本地分支按字母序；每行可显示相对时间/提交摘要（v1 可省）。
  - 远程分支：`Config.remoteBranches`（默认 `false`）开启时按 `remote/` 前缀分组置于本地之后；选中远程分支 = 创建对应本地跟踪分支并切换。
  - 底部固定 `+ Create Branch`（不随过滤消失；过滤词非空时作为预填名称）。
- **FR-1.6** 数据源：Host `gitPilot.branches(workspacePath)` → `{ current, locals: [{ name, commit, subject }], remotes? }`；`Config.maxBranches`（默认 200）截断并提示。
- **FR-1.7** 选中非当前分支 = `checkout`；失败（如冲突）原样展示 git 错误并保持当前分支。

#### F1.3 创建分支
- **FR-1.8** `+ Create Branch` 展开行内输入框；预填 `Config.branchNamePattern` 渲染的模板（如 `feature/20260923-`，日期取当天），光标落在尾部。
- **FR-1.9** 校验：git ref-name 规则（`git check-ref-format` 语义的前端校验 + Host 端复核）；重名时提示并按钮变「切换到该分支」。
- **FR-1.10** 创建 = `git checkout -b <name>`（基于当前 HEAD；`Config` 允许指定 base，本期 UI 不暴露）；成功后 chip 与面板头部同步刷新，并记录一条会话内系统提示（可选）。

#### F1.4 挂载点（Client）
| 位置 | Slot | 说明 |
|---|---|---|
| Composer 工具行左侧 | `conversation.input.left`（list, session 作用域） | 紧凑分支 chip（图标+短名），空间不足自动收纳 |
| Composer 输入卡下方 | `conversation.composer.dock`（list, session 作用域） | Cursor 底部风格分支行（红框④），可配置开关 |
| 右侧面板头部 | 自有 Changes tab 内 `On <branch>` | F2 面板自带 |
| 新会话 Hero | 依赖现有 `conversation.hero.workspace` 选完即建空白会话 → 上述 session 作用域 slot 立即生效 | 无需新 slot；若实测 hero 阶段（未选项目）也有诉求，备选方案见 §8 开放问题 |

### F2 会话变更面板（红框③）

#### F2.1 入口与布局
- **FR-2.1** Client 注册右侧栏 tab 类型：`sidebar.right.pane.tab` keyed 条目 id=`git-pilot.changes`；标题 chip 显示 `Changes`（走 locale）。
- **FR-2.2** 面板结构（自上而下）：
  1. 头部：`On <branch>`（点击也可打开 F1 下拉）；汇总徽标 `N 个文件 · +X −Y`（+绿/−红用主题 alias token）。
  2. 工具行：刷新、展开/收起全部、跳到最新 turn 的官方 Review 标签页（复用 ui-deliverables）。
  3. 文件列表：每行 = `PathLabel` 风格路径 + 状态徽标（M/A/D/U/重命名）+ `+a −d`；二进制/超大文件显示 `binary` / `too large`。
  4. 点击文件行 → 行内展开或切换到 diff 视图（v1 统一 diff，含 hunk 头与行号；复用/对齐 ui-deliverables ReviewTab 的视觉规范）。
- **FR-2.3** 自动打开策略 `Config.autoOpenChanges`：`never | firstTurn | always`（默认 `firstTurn`：本会话第一个产生变更的 turn 结束后自动打开一次）。

#### F2.2 数据口径（关键决策）
- **FR-2.4** 统计基线 = **会话创建时刻的仓库状态**（HEAD commit + 起始未提交快照）；面板展示 `基线 → 当前工作区` 的累计 diff。
  - 由 Host 在会话首次 `sessionChanges()` 调用时惰性建立基线，并在 agent 生命周期事件（session start）可达时提前建立；两者取先建立者。
- **FR-2.5** Host 服务 `gitPilot` 提供：
  - `sessionChanges(sessionId)` → `{ baseRef, branch, files: [{ path, display, status, added, deleted, binary?, oversized? }], total, added, deleted }`（`git status --porcelain=v1 -z` + `git diff --numstat <base>` 合并；untracked 文件按 DR-2 以非空行数计 `+n`，超出 `maxFileBytes` 显示 `too large` 不计数）。
  - `sessionFileDiff(sessionId, path)` → 统一 diff hunks（`git diff <base> -- <path>`，`maxFileBytes`/`maxFiles` 上限与 workspace-changes 插件同款默认）。
- **FR-2.6** 刷新时机（Client）：收到会话事件 `workspace/changes`（turn 结束）、窗口重新聚焦、面板手动刷新、分支切换成功后；v1 不做常驻 fs-watch（列入 v1.1）。
- **FR-2.7** 与现有 ui-deliverables 每 turn 卡片**并存不替换**：面板提供入口跳转官方 per-turn Review；本插件不重复实现 turn 级卡片。
- **FR-2.8** 降级链：非 git 仓库 → 面板隐藏（v1）；git 不可用 → 面板显示「git 不可用」说明；超出上限 → 显示「已截断，共 N 个文件」。

### F3 非功能需求

- **NFR-1 性能**：所有 git 调用带超时（默认 `timeoutMs=10000`）与输出上限；分支/状态请求前端做 300ms 去抖缓存；UI 全程可中断（连接断开即弃置）。
- **NFR-2 安全**：变更类 git 操作（create/checkout）仅能由显式 UI 点击触发；Host 端再次校验路径必须位于某个已注册 workspace 内（防任意路径执行）；操作写入 Host 日志。
- **NFR-3 兼容**：macOS 处理 `/usr/bin/git` Xcode stub（复用 workspace-changes 的探测逻辑）；git 缺失时全功能优雅降级；不阻塞会话主流程（所有调用 fire-and-forget + 失败静默降级为不渲染）。
- **NFR-4 国际化/主题**：zh/en 双语（`ctx.locale.register` 惯例）；颜色/圆角/阴影全部使用 `--dsw-alias-*` token。
- **NFR-5 打包**：遵循 `dsh-mnemon` 交付形态：`package.json` 的 `dsh.client.inject` + `dsh.bundle.patch`（`cordis.patch.yml` insert 配置行），`files` 只含 `lib` 等；提供 `verify` 脚本组（typecheck/test/build/包内容）。

---

## 5. 方案设计

### 5.1 插件形态与目录（对照 `dsh-mnemon`）

```
dsh-git-pilot/
├─ package.json               # name: dsh-git-pilot；dsh.client.inject + dsh.bundle.patch
├─ cordis.patch.yml           # - insert: [{ id: git-pilot, name: dsh-git-pilot, config: {...} }]
├─ src/
│  ├─ index.ts                # Host 入口：name/inject/provide/Config/apply
│  ├─ config.ts               # schemastery Config
│  ├─ git/                    # git.ts(runner/exec 探测) branches.ts status.ts diff.ts refs.ts
│  ├─ service.ts              # GitPilotService（provide: ['gitPilot']）
│  ├─ rpc.ts                  # connection-RPC 通道（复用 mnemon 模式）
│  ├─ baseline.ts             # 会话基线记录与查询（内存 + 会话存活期）
│  └─ client/
│     ├─ index.ts             # apply(ctx)：slots 注册 + locale + rpc
│     ├─ BranchChip.tsx / BranchMenu.tsx / CreateBranchForm.tsx
│     ├─ ChangesTab.tsx / ChangeFileList.tsx / ChangeDiff.tsx
│     ├─ api.ts               # rpc 客户端（status/branches/create/checkout/sessionChanges/fileDiff）
│     ├─ stores.ts            # 分支状态、变更汇总的 observable store
│     └─ locales.ts           # zh/en
├─ tests/                     # vitest：host 单测（临时 git 仓库 fixture）+ client 组件测试
└─ docs/requirements-design.md
```

### 5.2 关键技术决策

| # | 决策 | 选择 | 理由 / 备选 |
|---|---|---|---|
| D1 | git 执行通道 | Host 插件 `inject: ['subprocess']` 自行跑 git（对齐 workspace-changes） | DSH 无 git 服务；`subprocess.resolveExecutable` 已解决 PATH 与 macOS stub |
| D2 | 会话变更口径 | **自建会话基线 diff**（§FR-2.4/2.5） | 「会话累计 + 覆盖 Bash 改动 + 语义正确（重写不重复计数）」；备选「聚合 workspace-changes 每 turn 摘要」实现小但跨 turn 重写会重复计数、且 turn 快照间隙的 Bash 改动靠不连续快照，口径不纯 → 仅作 git 缺失时的降级说明，不作数据源 |
| D3 | Client↔Host 通道 | connection-RPC 命名通道（mnemon 已验证） | 外部插件最稳；`@Remote` typert 服务为备选 |
| D4 | 分支 chip 挂载 | `conversation.input.left` + `conversation.composer.dock` 双挂载、Config 可分别关 | 均为 list 作用域 session slot，官方声明稳定、无单席位冲突 |
| D5 | Changes 面板 | `sidebar.right.pane.tab` 新 tab 类型 | 官方扩展位，「adding a type is a registration, never an edit」 |
| D6 | 分支切换影响面 | 工作区级（worktree 全局）生效 + 双重确认 | git 语义如此；与 Cursor 一致；护栏见 §5.3 |

### 5.3 分支切换护栏（US-5）

`checkout` 执行前 Host 依次检查：
1. **脏工作区**：`git status --porcelain` 非空 → 返回 `{ needsConfirm: 'dirty', dirtyFiles: n }`，UI 弹确认「携带改动切换 / 取消」（不提供 discard，避免破坏性操作）。
2. **同工作区活跃会话**：查询 `workspaceRegistry` + 活跃 agent 列表，同 path 且运行中的会话数 >1 → 返回 `{ needsConfirm: 'busySessions', sessions: n }`，UI 提示。
3. **保护分支**：命中 `Config.protectedBranches`（默认 `['master','main','release/*']`）→ 仅允许「切出」，不允许切**入**（切回保护分支需确认，提示风险）。
4. 切换成功后：广播刷新（当前会话面板重算基线后缀提示「分支已切换，变更统计已按新分支重置」——基线语义见 §8 开放问题 Q3）。

### 5.4 Host 服务接口草案

```ts
export interface GitPilotService {
  status(workspacePath: string, signal?: AbortSignal): Promise<GitStatus>
  branches(workspacePath: string, signal?: AbortSignal): Promise<BranchList>
  createBranch(workspacePath: string, name: string, opts?: { from?: string }): Promise<BranchMutationResult>
  checkout(workspacePath: string, name: string, opts?: { confirm?: 'dirty' | 'busySessions' }): Promise<BranchMutationResult>
  sessionChanges(sessionId: SessionId, signal?: AbortSignal): Promise<SessionChangesSummary | undefined>
  sessionFileDiff(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<SessionFileDiff | undefined>
}
// GitStatus: { isRepo, branch?, detached?, commit?, upstream?, ahead?, behind?, dirtyFiles, added, deleted }
// BranchMutationResult: { ok: true, branch } | { ok: false, needsConfirm?, error? }
// SessionChangesSummary: { baseRef, branch, files, total, added, deleted, truncated }
```

### 5.5 Config 草案

```ts
export interface Config {
  enabled: boolean                 // 默认 true
  branchChip: boolean              // composer 工具行 chip，默认 true
  composerBranchRow: boolean       // composer 下方分支行，默认 true
  changesPanel: boolean            // 右侧 Changes tab，默认 true
  autoOpenChanges: 'never' | 'firstTurn' | 'always'   // 默认 'firstTurn'
  remoteBranches: boolean          // 下拉展示远程分支，默认 false
  autoFetch: boolean               // 打开下拉时 git fetch --prune，默认 false（网络副作用）
  timeoutMs: number                // 单条 git 命令超时，默认 10000
  maxBranches: number              // 默认 200
  maxFiles: number                 // 变更列表面上限，默认 500
  maxFileBytes: number             // 默认 2MiB
  branchNameTemplate: string       // 默认 'feature/YYYYMMDD-'，Y=年 M=月 D=日
  protectedBranches: string[]      // 默认 ['master', 'main', 'release/*']
}
```

### 5.6 交互细节补充

- 分支下拉打开时若 `status` 过期（>5s）自动重查；下拉内当前分支行点击 = 关闭（无操作）。
- 创建分支输入为空 + 过滤词非空 → 回车即以过滤词建分支（Cursor 行为）。
- Changes 面板文件行 hover 500ms 显示行内迷你 diff 预览（对齐官方 ChangedFiles 卡片行为；v1.1）。
- 会话内多个工作区切换时，面板/ chips 全量重取；连接断开一切请求弃置，不缓存跨连接数据。

---

## 6. 里程碑

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| M0 | 需求设计（本文档） | DR-1~3 已确认；Q1/Q3 按默认执行；**设计稿评审通过后进入 M1** |
| M1 | Host 骨架：config / git runner / status·branches·create·checkout / 基线与 sessionChanges / 单测（临时仓库 fixture） | `pnpm verify` 绿；对真实仓库手工 smoke |
| M2 | Client F1：chip + 下拉 + 创建流 + locale + 主题 | 新会话选项目即带出分支；创建/切换/搜索全链路可用 |
| M3 | Client F2：Changes tab + 文件列表 + diff + 刷新时机 | 与 `git diff` 手工对账一致；非 git 目录零渲染 |
| M4 | 打磨与交付：护栏确认流、截断/降级文案、README（中英）、cordis.patch.yml、发布校验 | 通过 mnemon 同款 verify 套件；DSH 实机回归 |

## 7. 测试要点

- Host：临时 git 仓库 fixture 覆盖：非仓库、空仓库（无 HEAD）、detached、脏工作区、二进制/超大文件、untracked 计行、重名建分支、非法 ref、保护分支、并发调用超时。
- Client：组件测试（搜索过滤/✓/创建校验/确认弹层）；store 测试（事件触发刷新、连接断开弃置）。
- 实机：`pnpm run dev:web` 热载下验证 client 插件生效；重启路径验证 cordis.patch.yml 挂载。

## 8. 开放问题

- **Q1 分支切换的基线语义**（默认按建议执行）：切换分支后，Changes 统计重置为新分支的起点——按「当前分支工作区 vs 切换时刻状态」重算，并在面板给一次性提示。
- **Q2 ~~untracked 新文件行数口径~~**：✅ 已决策为 DR-2（按非空行计数）。
- **Q3 新会话 Hero 阶段（未选项目时）是否也要显示「项目+分支」行**（默认按建议执行）：当前方案依赖「选完项目即建空白会话」，hero 阶段无分支可显；若必须在 hero 显示，需评估 `conversation.composer.bar`（single 席位）替换或等待官方新增 list 位，成本+0.5 天。
- **Q4 是否需要 `git pull / push` 等写操作的延伸**（本期非目标，仅确认边界）。
- **Q5 ~~插件命名~~**：✅ 已决策为 DR-3（`dsh-git-pilot`）。

---

## 附录 B：实现评审记录

### R3 三路独立评审（2026-09-23，第三轮：正确性 / 安全打包 / 交叉复检）

三个独立评审（全部实测验证：临时 git 仓库逐字节比对 git 输出、安装版运行时源码核对、组件级审查）合并后确认 1 critical + 6 major + 若干 minor，全部修复：

| # | 级别 | 问题 | 修复 |
|---|---|---|---|
| R3-1 | **critical** | RPC 通道名违反传输层语法（须以 / 开头且无冒号）→ 真实运行时 host 注册即抛异常，插件无法激活；测试用假 handle 未拦截 | 通道更名 /git-pilot-read、/git-pilot-write；新增「从安装包源码提取 CHANNEL_PATTERN」的契约测试 |
| R3-2 | **major** | checkout 只接受已解析分支名（引用表达式、hash、pathspec 一律 invalid-name），并实现 FR-1.5 远程语义：origin/x 建本地跟踪分支而非 detach HEAD | show-ref refs/heads + rev-parse refs/remotes 双探测 + checkout -b local --track |
| R3-3 | **major** | 保护分支绕过：refs/heads/main、heads/main、大小写变体绕过原始字符串匹配 | 解析后匹配 + case-fold |
| R3-4 | **major** | 会话 cwd 在仓库子目录时根相对路径 vs 子目录 join/pathspec → 文件误标 oversized、diff 恒空 | 基线记录 show-toplevel，全部仓库命令与拼接统一 toplevel |
| R3-5 | **major** | stash-create 基线悬空，gc --prune 后 bad object 且死基线永久缓存 → 面板永久损坏 | 锚定 refs/git-pilot/<session> + bad-object 检测自动重捕一次 |
| R3-6 | **major** | ensure-baseline 接受任意路径/sessionId：信息泄露 + baselines 无界增长 | 注册表门控 + 200 条 LRU |
| R3-7 | major | parseUnifiedDiff 把 hunk 中部 no-newline 标记当终止符丢后续行 | 标记按内容处理；尾部空行伪影剔除 |
| R3-8 | major | ChangesTab 异步写入无 epoch 守卫（旧响应覆盖、跨会话串扰） | 刷新/diff 全部走单调 epoch 令牌 |
| R3-9 | minor | registry/agents apply 时快照，加载顺序靠后则路径守卫静默失效 | 惰性 getter（mnemon 模式）；inject 回调改用上下文参数 |
| R3-10 | minor | turn/start 未建基线（客户端未挂载时 Bash 早改不计入） | host 监听 turn/start 提前建基线 |
| R3-11 | minor | 脏子模块幽灵变更；空仓库空跑 diff HEAD；(detached) 哨兵歧义 | --ignore-submodules=dirty；commit 缺失跳过 numstat；symbolic-ref 权威判定 |
| R3-12 | minor | autoFetch 门控、untracked 计行封顶、loadBranches 竞态、菜单 stale 清理、搜索回车建分支、点当前行关闭、全部展开/收起、diff 截断提示、bad-request 码、react 外部正则、engines ≥20.3、当前分支首位且不被截断 | 已全部落地 |
| R3-13 | minor | FR-1.4 项目 chip 补齐：分支行左侧只读展示工作区标题（切换项目仍走 DSH 原生工作区选择器） | 已落地 + 组件测试 |

诚实化修正：README 不再声称 write 通道有 loopback authority 强制（该运行代际忽略 authority 选项）；有效门控 = Host/Origin 围栏 + 浏览器认证 + 服务层确认令牌。

### R4 修复自审（2026-09-23，第四轮：针对 R3 新增代码）

| # | 级别 | 问题 | 修复 |
|---|---|---|---|
| R4-1 | minor | autoOpenChanges: always 在持续脏状态下每次刷新重复弹开（缺 clean→dirty 转换判定） | previous 值判定：仅在由净转脏时打开 |
| R4-2 | major | withBaselineRecovery 重试复用闭包里的旧 baseline 对象，重捕后二次失败，恢复机制形同虚设 | 重试操作接收重捕后的新基线 |
| R4-3 | major | 锚定 ref 删除在 HOME 下执行 update-ref -d（非 git 仓库）→ 静默失败，refs/git-pilot/* 按会话无限残留 | 删除改在基线自己的 toplevel 执行（forgetSession / 切换重置 / 坏对象恢复三条路径统一） |

新增回归测试：子目录会话统计（R3-4 直接回归）、非仓库 repo:false 视图、锚定 ref 生命周期（含删除竞态等待）、ref 表达式与 pathspec 注入拒绝、保护分支大小写折叠。gitlink/ChangesTab/通道契约测试此前已补。

### R2 全方位评审（2026-09-23，第二轮）

在上轮基础上扩维：git 输出边界实验（二进制/子模块/unicode/制表符文件名实测）、React 状态竞态、RPC 权限断言、生命周期与内存、打包外部依赖、可访问性。新增修复：

| # | 级别 | 问题 | 修复 |
|---|---|---|---|
| R2-1 | **major** | **macOS 符号链接路径不一致**：`/tmp`、`/var` 是链接，基线 cwd 存原始路径、守卫比较却用 realpath 解析后的路径 → busy-sessions 守卫与切换后基线重置在 macOS 上**全部静默失效**（实测复现） | 基线捕获即 `canonicalizePath`；守卫两侧统一 canonical 比较；回归测试真实复现原 bug 场景 |
| R2-2 | minor | submodule 指针变更在 numstat 里表现为 `+1 −1`（实测），被误标为 1 行增删 | porcelain v2 mode 字段识别 `160000` gitlink → 行数清零 + 专用「子模块」徽标（wire 新增 `gitlink` 标志） |
| R2-3 | minor | 菜单缺 ARIA 语义与全局 Escape | 分支行 `role="menuitem"`、打开期间 document 级 Escape 关闭 |
| R2-4 | minor | 确认弹层「取消」可在请求 in-flight 时点击，造成状态错乱 | pending 期间禁用取消 |
| R2-5 | minor | 空仓库每次 status 空跑一次注定失败的 `git diff HEAD` | `branch.oid (initial)` 时跳过 numstat |
| R2-6 | nit | ChangesTab 组件零测试覆盖 | 补 4 个冒烟测试（汇总/空态/展开加载/刷新重拉） |
| R2-7 | nit | RPC 权限无断言（读 trusted-host / 写 loopback 沦为口头约定） | apply 契约测试断言两个通道的 authority |

R1 的 7 项修复见下表（保留存档）：

| # | 级别 | 问题 | 修复 |
|---|---|---|---|
| R1-1 | major | checkout 后基线未重置，面板拿旧分支基线对比新分支工作区 | checkout 成功即删除该工作区全部基线；客户端重发 ensure-baseline；agents 注册表自愈 |
| R1-2 | major | `branchChip`/`composerBranchRow`/`changesPanel` 配置项无代码消费；`uiOptions.changesPanel` 硬编码 true | uiOptions 返回真实配置；客户端按位注册三个挂载面 |
| R1-3 | minor | 菜单点外不关、再点 chip 不收起 | trigger toggle + document mousedown 外点关闭 |
| R1-4 | minor | busy 护栏 cwd 全等匹配，子目录会话绕过 | isInsideWorkspace 前缀匹配 |
| R1-5 | minor | 自动打开在 uiOptions 未返回时抢跑 | options 就绪后才评估且要求 changesPanel 开启 |
| R1-6 | minor | status 刷新竞态覆盖 | 请求序号令牌 |
| R1-7 | minor | diff 缓存按路径不失效 | 刷新清缓存、展开行自动重拉 |

### 已知接受项（非缺陷）
- 读通道不做注册表校验（只读、与 mnemon 惯例一致；写通道严格校验）。
- untracked 非空行 vs git 全行口径差（DR-2 既定）。
- 前端分支名校验文案仅中文。
- 大仓库 `status --untracked-files=all` 每次刷新执行一次，受 timeoutMs 约束（v1 不做 fs-watch）。
- 基线驻留 Host 内存：Host 重启后面板仅显示重启后的改动。

### 附录 A：证据索引（源码定位）

- Composer/右侧栏 slot 声明：`packages/client/ui-conversation/src/client/contract/slots.ts`（`conversation.input.left` / `conversation.composer.dock` / `conversation.hero.workspace` / `conversation.composer.bar`）；`packages/client/ui-sidebar-right/src/client/contract/slots.ts`（`sidebar.right.pane.tab` 等）。
- 每 turn 变更基础设施：`packages/deliverables/workspace-changes/src/{types,git,recorder,index}.ts`（`WorkspaceChangesSummary`、`/api/changes.summary|diff`、Xcode git stub 处理）；`packages/client/ui-deliverables/README.md`（ChangedFiles 卡、ReviewTab、`workspace/changes` 事件消费）。
- 工作区/会话服务：Host Service 目录 `workspaceRegistry` / `workspaceController` / `workspaceChanges` / `sessionController`。
- 插件交付惯例：`/Users/wenping/tools/dsh-mnemon`（`package.json` 的 `dsh.client` 节、`cordis.patch.yml`、`src/client/index.ts` 的 `ctx.slots.register` 用法、`src/git-branch.ts`）。
