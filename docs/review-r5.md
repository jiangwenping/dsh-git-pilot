# dsh-git-pilot 第五轮深度评审（R5）

> 评审日期：2026-09-24
> 范围：全量源码（src/ 2,900 行 + tests/ 1,300 行 + 打包配置 + 构建产物 + 实机验证）
> 方法：逐文件人工深读 + 真实 git 临时仓库实证实验 + 直接运行 typecheck/测试套件 + 运行时源码（deepseek-harness、dsh-subprocess）核对
> 前四轮（R1–R4）见 `requirements-design.md` 附录；本轮验证既有修复并寻找遗漏问题

---

## 0. 总体结论

代码质量总体**优秀**：结构化注入接口、-z 解析、超时/输出上限、真实 git 集成测试、多轮评审回归测试，工程素养在插件生态里属于头部水平。但本轮发现：

- **1 个已实证的会话口径正确性缺陷**（R5-1，pre-existing untracked 泄漏）
- **verify 出口标准当前不满足**（R5-2，自带测试红 + 打包占位符）
- **1 个已声明功能实际未接线**（R5-3，工作区标题）
- 若干文档漂移、安全纵深与性能问题（R5-4…R5-13）

建议在发布（对外 `pnpm add`）前处理 R5-1/2/3，其余按优先级排入 v0.1.1。

---

## 1. 验证状态（对 R1–R4 声明修复的抽查）

| 修复项 | 结论 | 证据 |
|---|---|---|
| R3-1 通道改名 + 契约测试 | ✅ 已落地（但见 R5-9：该传输路径已整体废弃为死代码） | wire.ts:14-16；channels.test.ts |
| R3-2 checkout 仅接受已解析分支名；origin/x 建本地跟踪 | ✅ service.ts:358-365（show-ref + rev-parse 双探测）；branches.ts:127-135；实验复核 check-ref-format 拒绝 `-foo`/`--help` | 实测 `git check-ref-format --branch '-foo'` → exit 128 |
| R3-3 保护分支大小写折叠 | ✅ isProtectedBranch(service.ts:106-114)；测试覆盖 MAIN/Main | service.test.ts:44-46 |
| R3-4 子目录会话统一 toplevel | ✅ captureBaseline 记 show-toplevel；回归测试 | service.ts:208-236；service.test.ts:349-372 |
| R3-5 基线锚定 refs/git-pilot + 坏对象重捕 | ✅ captureBaseline/withBaselineRecovery | service.ts:225-229, 299-313 |
| R3-6 基线门控 + 上限 | ⚠️ 已实现但有旁路（见 R5-6） | service.ts:265, 284-292 |
| R3-7 no-newline 标记 | ✅ diff.ts:72-81；回归测试 | diff.test.ts:51-64 |
| R3-8 epoch 守卫 | ✅ changes-tab.tsx:409-410, 418-437, 457-473 | |
| R3-10 turn/start 提前建基线 | ✅ index.ts:127-131 | |
| R3-11 子模块/空仓库/detached | ✅ status.ts:6, 79-84, 129-130 | |
| R3-12 杂项打包 | ✅ 抽查 autoFetch 门控(service.ts:332)、loadBranches 竞态(260)、外点关闭(240-253)、展开/收起(541-548) | |
| R3-13 分支行显示工作区标题 | ❌ **半成品，运行时未接线**（见 R5-3） | branch-row.tsx:14-15 支持，index.tsx:89-94 titleOf 死代码 |
| R4-1 always 仅净→脏打开 | ✅ branch-row.tsx:222-229 lastDirtyRef | |
| R4-2 重试用新基线 | ✅ service.ts:299-313 run(recaptured) | |
| R4-3 锚定 ref 在 toplevel 删除 | ✅ dropBaselineRef(cwd=baseline.cwd) | service.ts:180-188 |
| R1-3/R1-5/R1-6/R1-7/R2-3/R2-4 | ✅ 抽查通过（请求序号、options 门控、Escape、pending 禁用、刷新清缓存） | branch-row.tsx:182-194, 238-253, 416-421 |

---

## 2. 本轮新发现

### R5-1【major·已实证】会话口径泄漏：会话开始前已存在的 untracked 文件被计为“本会话改动”

- 位置：service.ts:205-237（captureBaseline 用 `git stash create`）+ 505-568（collectChanges 把**当前** status 里的 untracked 全部列为新增行）
- 机理：`git stash create` 只捕获 tracked 改动，untracked 文件不进基线 commit；collectChanges 又把当前所有 untracked 当作会话产出。**会话开始前就在工作区的 untracked 文件（上一次会话的产物、scratch 文件、构建输出）会全部算成本会话的 +N 行**。
- 实证（真实 service 代码，临时仓库）：会话开启前放置 `scratch/old-work.txt`（4 行），会话什么都没做：

```json
{ "files": [{ "path": "scratch/old-work.txt", "status": "untracked", "added": 4 }], "total": 1, "added": 4 }
```

- 影响：`session` 作用域是本插件区别于官方 workspace-changes 的核心卖点（“这个会话改了什么”），多会话接力开发时该口径明显失真；README「Known limitations」未记录此点。
- 修复建议（三选一）：
  1. `git stash create --include-untracked`（最小改动；clean 树回退 HEAD 的分支不受影响，因为那时本来也没有 untracked）；
  2. 基线对象里记录当时的 untracked 路径集合，collectChanges 时剔除“基线期已存在且仍为 untracked”的路径（可保留“会话期间该文件被改动”的检测能力：mtime 不可靠，可用内容 hash 或 size 对比）；
  3. 至少在 README Known limitations 里诚实记录该口径。
- 注意：默认作用域（uncommitted vs HEAD）不受影响——那里 untracked 本来就该显示。

### R5-2【major】`pnpm verify` 当前不绿：两枚独立的 blocker

1. **测试套件 1 红**：`tests/client-changes-tab.test.tsx:97` 用 `getByText('Refresh')` 找刷新按钮，但实现已改为图标按钮 `⟳` + `title="Refresh"`（changes-tab.tsx:582）。**组件改动后测试未同步**（应改 `getByTitle`）。干净环境跑 `pnpm verify` 必红；也说明 M4 出口标准“verify 绿”未被守护（CI 缺位）。
2. **`pnpm-workspace.yaml` 是未填写的占位符**：

```yaml
allowBuilds:
  esbuild: set this to true or false   # ← 字面占位符，pnpm 视为未批准
```

`pnpm install`（verify 的 deps 检查会触发）直接 `ERR_PNPM_IGNORED_BUILDS` 失败。本次评审通过绕过 pnpm 直接调 tsc/vitest 才完成验证。README「Develop」一节的干净 clone 流程目前走不通。

### R5-3【major】R3-13 工作区标题功能未接线：`titleOf` 死代码

- `branch-row.tsx:14-15` 组件支持 `workspaceTitle`、行变体有完整渲染（365-372），`client-branch-row.test.tsx:81-93` 直接传 prop 测试通过；
- 但生产装配 `index.tsx:133-138` 的 `rowInject` **从未传入** `workspaceTitle`；`index.tsx:89-94` 的 `titleOf`（读 workspaces 快照）定义后从未调用。
- 结果：实机上分支行左侧的“项目 chip”永远不出现（README「分支助手」红框①语义、设计 FR-1.4）。组件级测试绿掩盖了装配断裂——典型的“单测绿、集成断”。
- 修复：`rowInject` 增加 `...(titleOf(sessionId) === undefined ? {} : { workspaceTitle: titleOf(sessionId) })`，并补一条 index.tsx 装配级断言（或在 apply.test 里以假 host 走到 inject 工厂断言注入面包含 title）。

### R5-4【minor】文档/日志漂移：路由数三处三种说法，新增写功能未记录

- 实际注册 **11 条路由**（7 读 + 4 写，apply.test.ts:54 与 fetch-routes.test.ts:61 均已按 11 断言）；
- README「Understand the implementation」写 **eight routes** 且只列举 status/branches/session-changes/create-branch/checkout——**commit、revert-file、uncommitted 作用域、ensure-baseline、ui-options、session-file-diff 均未记录**；
- rpc.ts:104 debugLog 写 "registering 10 routes"（过时数字）。
- commit/revert-file 是面向用户的破坏性写能力（Changes 面板的提交/恢复按钮），README「Use」一节完全没提该交互与 `revert.confirmTitle` 的确认语义。安全审计者无法从文档还原真实 API 面。
- 修复：README 补「Changes 面板可直接提交/恢复文件」说明 + 路由全表；rpc.ts 日志改为在 route() 内统一打点或干脆删除（见 R5-7）。

### R5-5【minor】untracked 行数读取未按 `maxFiles` 截止（README 与实现矛盾 + 性能）

- README:「Line-count reads for untracked files stop at maxFiles rows」；实际 service.ts:546-558 的循环对**每一个** untracked 行都执行 `untrackedFacts`（stat + 全量 readFile，上限 2MiB/文件），cap 只裁剪 `files` 数组，不裁剪读取。
- 影响：untracked 大目录（未 gitignore 的构建产物）会让每次刷新串行读数千个文件，且 `/read/uncommitted` 是 Changes 面板**默认作用域**；行计数不在 `timeoutMs` 的管辖内（它只管 git 子进程）。
- 修复：达到 `files.length >= cap` 后停止读取（行数留 0，`truncated: true` 保持 README 描述），或至少把读取下限定为“已展示的行”。
- 另：README「totals stay complete」与「a summary marked "truncated" may under-count beyond that」两句自相矛盾，需要统一口径。

### R5-6【minor·安全纵深】读路由接受任意路径；基线门控存在旁路

- `/api/git-pilot/read/uncommitted` 与 `/read/session-file-diff (scope:'head')` 接受任意 `workspacePath`，无注册表校验（`resolveToplevel` 直接探测）。设计文档「已知接受项」声明读通道故意不校验——但该声明的年代早于这两个**内容级**路由：status/branches 只泄元数据，而这两个能把**任意本地仓库的文件清单与逐文件 diff 内容**带回浏览器。浏览器认证 + Host/Origin 围栏之内（页面内被入侵的插件、XSS）可将其作为本地文件内容外泄通道。
- 基线门控旁路：ensureBaseline（service.ts:265）的拒绝条件是 `!isRegisteredWorkspace(path) && agents().get(sessionId) === undefined`——**只要 sessionId 是 agents 注册表里真实存在的会话，path 可以是任意本地目录**，`git stash create` + `update-ref` 会写入该目录（锚 ref），该会话后续统计也被挂到任意仓库上。
- 修复建议：两个读路由与 ensureBaseline 复用写通道的 `assertRegisteredWorkspace`（或至少校验 path 等于 agents 记录的该会话 cwd，恰如 sessionContext 已经做的那样）；`uncommittedChanges/uncommittedFileDiff` 增加同样校验。

### R5-7【minor】生产调试残留

- Host：`index.ts:68-73` 与 `rpc.ts:18-22` 向 `${TMPDIR}/dsh-git-pilot-debug.log` **无上限追加**（本机实测已 461 行/30KB，每次 apply ~20 行；配置重载/重启持续增长），注释自称 "(temporary)"；
- Client：`client/index.tsx` 7 处 `console.info/warn/error`（含每会话 `JSON.stringify(options)`），上线会污染用户控制台。
- 修复：发布前全部移除，或接入 `ctx.logger`（Host）/受 Config 开关控制的 debug flag。

### R5-8【minor】200 条上限是 FIFO 而非 LRU；活跃会话基线可能被逐出

- service.ts:284-292 按 Map **插入序**逐出（`while size >= 200 delete first`），注释/README 称 LRU。没有任何“使用即重排”逻辑。
- 影响：Host 上并发会话 > 200 时，**最早建立但仍然活跃**的会话基线被逐出，其下一次 `sessionChanges` 会按当前状态重新捕获基线 → 该会话的累计统计**静默归零重来**（数据语义问题，非内存问题）。
- 修复：每次 `ensureBaseline` 命中缓存时 `get + delete + set` 重插队尾（真 LRU）；或按 `session/disposed` 已有的清理路径评估真实上限。

### R5-9【minor】死代码：通道常量与其契约测试守护的是已废弃的传输路径

- `wire.ts:14-16` 的 `GIT_PILOT_READ/WRITE_CHANNEL` 与 `GitPilotClientConnection`（wire.ts:26-30）：Host 已改用 fetch 路由（rpc.ts 头注释明确说明 connection.rpc.handle 被规避），客户端 api.ts 走 `fetch('/api/...')`——**没有任何运行时代码消费通道常量**；
- `channels.test.ts` 仍在从安装包提取 CHANNEL_PATTERN 校验这两个死常量，给人“传输契约被测试守护”的错觉，实则守护对象已死。
- 修复：删除常量与 channels.test.ts（历史价值已由 requirements-design.md 附录 B 存档）；或如果保留 RPC 通道作为未来回退路径，请在 README 标注其状态。

### R5-10【minor】checkout 远程分支的两个边角

- **本地同名分支已存在**：菜单里选 `origin/x` 而本地已有 `x` 时，走 `checkout -b x --track origin/x` → git 报 "a branch named 'x' already exists" 原样弹错。FR-1.9 的「重名时提供切换到该分支」没有覆盖远程分支路径（createBranch 覆盖了）。修复：远程分支 checkout 前探测 `refs/heads/<guardName>`，已存在则返回 `reason:'exists', existingBranch`，UI 复用现有“切换到该分支”确认。
- **`origin/HEAD`**：列表已过滤（branches.ts:44），但 RPC 直调 checkout `origin/HEAD` 可通过 rev-parse 探测（symbolic ref 可解析）→ `checkout -b HEAD --track origin/HEAD` 产生 "not a valid branch name" 的混乱错误而非 `invalid-name`。低危，加一个名字黑名单即可。

### R5-11【minor】session 作用域下的 Commit 语义误导

- changes-tab.tsx:493-499：Commit 按钮在两个作用域都可用，但 `doCommit` 提交的是所选路径的**当前工作区内容**（uncommitted 语义，commit.ts 头注释也如此声明）。用户在「本会话」作用域勾选 3 个文件提交时，**会话开始前就存在的未提交改动会被一并带入提交**，而界面文案让用户以为提交的是“本会话的改动”。
- 修复：session 作用域下隐藏 Commit 入口，或改文案明确“提交这些文件的当前内容（含会话前改动）”。

### R5-12【nit】测试与文档小瑕疵

- apply.test.ts:49 标题「mounts both channels」——实际断言的是 fetch 路由，标题停留在通道时代；
- apply 级测试没有覆盖 `session/event`(turn/start) 监听器的接线（fake host 的 `on` 直接吞掉第二类事件）——R3-10 只有 service 级测试；
- status.test.ts:24 `'\0'.trim()`：trim 不剪 NUL，这行写法暗示作者以为会剪，无实际影响但易误导后人；
- cordis.patch.yml `composerBranchRow: false` 与 Config 默认 `true` 不一致（可能是有意收敛安装面，但值得一行注释说明，否则读者会当 bug 报）。

### R5-13【nit】杂项

- runner env 是**合并**而非替换（dsh-subprocess "explicit env layers merge"；test double 同 `{...process.env, ...spec.env}`）——README「scrubbed env」的说法比实际强：父进程的 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_EDITOR` 会透传给子进程。建议 spec.env 显式置空这四个键（防 Host 环境意外劫持 git 行为）。
- collectChanges 的 `sessionId` 参数未使用（service.ts:505、571）；ensureBaseline:265 的 `workspacePath !== undefined` 是永真冗余（262 行已提前返回）。
- checkout:360-361 `remoteProbe` 的假结果 `{ exitCode: 1 }` 是给 TS 的占位，语义上是“必然失败”，加一行注释更清晰。
- captureBaseline:220-224 `branch --show-current` 无条件跑（clean-fallback 分支不需要），省一次进程可把它挪进需要时。
- fileDiff untracked 分支把文件读两遍（untrackedFacts 一遍、readFile 一遍）；2MiB 文件 × 双读，可顺手合并。
- FileRow 对 `unmerged`（冲突）文件仍显示 ↩ 恢复按钮：`checkout HEAD -- path` 会静默丢掉合并内容，建议与 new-file 一样拒绝或文案加警。

### R5-14【nit】客户端可访问性/交互细节

- branch-row.tsx:356 触发按钮缺 `aria-haspopup="menu"` 与 `aria-expanded={open}`（菜单容器已有 `role="menu"`、行有 `role="menuitem"`，但触发器语义不完整，屏幕阅读器无法获知展开状态）；
- changes-tab.tsx:569 作用域切换是 `role="tablist"` + 两个 button，但按钮没有 `role="tab"`/`aria-selected`，tablist 语义不完整；
- changes-tab.tsx:428-434：uncommitted 作用域且会话 store 尚无 cwd 时静默不加载也不提示（面板空白无解释，cwd 就绪前的短暂窗口会显得“面板坏了”）；
- 分支 chip 的图标/状态徽标（⎇、±N、📁、▲▼）均为 emoji/字符，跨平台渲染不一致（与 fileGlyph 的 ☕📝🖼⚙📄 同理）——零依赖的选择可以理解，列入 v0.1.1 美化项即可；
- 无虚拟化：500 行上限全展开 + diff 全量渲染 DOM（setAll(true) → 500 个 loading + 500 组 diff），大变更集下可能卡顿；changes-tab.tsx:455-475 的 effect 依赖含 `diffs`，逐文件装载会触发 O(n) 次 effect 重跑。

---

## 3. 测试与打包评估

**测试（总体：优秀，少量盲区）**

- Host：真实 git + 隔离全局配置（GIT_CONFIG_GLOBAL=/dev/null）的临时仓库集成测试，覆盖守卫、基线生命周期、子目录、子模块、二进制/超大、非法 ref、路径逃逸；回归测试与 R 系列编号互链——审计可追溯性做得非常好。
- 盲区：R5-1 的场景（基线建立前已存在 untracked）无测试——正是漏网原因；refresh 按钮测试漂移未被发现说明没有干净环境门禁；装配级（index.tsx inject 工厂）没有断言注入面内容（导致 R5-3 长期潜伏）。

**打包（总体：符合 mnemon 惯例）**

- tsdown 双配置正确：Host ESM 不打包依赖（schemastery 外部）；Client CJS 只外部化 react，`__ModuleLoader__` banner 与 dsh 客户端加载器匹配；lib/ 产物新鲜（含最新 UI 改动与全部 11 条路由构造）。
- `files` 只含 lib/patch/README ✓；engines node>=20.3 与 `AbortSignal.any` 需求一致 ✓；dsh.client.inject 五个包与客户端实际 import 一致 ✓。
- 未提交 VCS：插件目录本身不是 git 仓库（无 .git），多轮评审的修复没有版本历史可查——建议 `git init` 纳管，评审修复可追溯（.idea/ 也需要 .gitignore 排除）。

---

## 4. 发布前行动清单（建议顺序）

| # | 行动 | 对应 |
|---|---|---|
| 1 | 修 changes-tab 测试（getByTitle('Refresh')）+ 决定 pnpm-workspace allowBuilds 值，确保干净环境 `pnpm verify` 绿 | R5-2 |
| 2 | 基线捕获改 `--include-untracked`（或记录 untracked 集）+ 补会话前 untracked 回归测试 | R5-1 |
| 3 | rowInject 接线 workspaceTitle + 装配级测试 | R5-3 |
| 4 | 读路由/ensure-baseline 补注册表校验（或 agents-cwd 比对） | R5-6 |
| 5 | 清理全部调试残留（tmpdir 日志、console.*、10-routes 旧文案） | R5-7、R5-4 |
| 6 | README 路由/功能文档同步（11 条路由 + commit/revert 交互 + uncommitted 默认作用域） | R5-4、R5-11 |
| 7 | untracked 读取按 maxFiles 截止；FIFO→LRU；删死通道代码 | R5-5、R5-8、R5-9 |
| 8 | `git init` 纳管 + CI 跑 verify | 流程 |

---

## 5. 客户端深审（独立复审合并；编号 C-x 为客户端侧）

> 与 Host 侧重叠的发现已互相印证：C-1 ≡ R5-3（workspaceTitle 未接线）、C-18 ≡ R5-4/R5-9（README 通道声明过时、死代码）、console 调试残留 ≡ R5-7。

### C 系 major

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| C-1 | （≡R5-3）工作区标题死功能 | index.tsx:133-138 vs branch-row.tsx:365 | 见 R5-3；`titleOf` 与 `workspaces` inject 均为死代码 |
| C-2 | `undefined` 态被误标为“非 git 仓库” | guide-card.tsx:69-71、changes-tab.tsx:544-550 | Host 对空仓库（无提交）、未注册 cwd、基线捕获失败、git 不可用、RPC 失败一律返回 `undefined`；guide 卡与 tab 把它渲染成 `changes.noRepo`。全新 `git init` 项目会显示“当前项目不是 git 仓库”——事实错误。session 作用域 undefined 时 tab 则永久空白无提示。需要独立的“基线不可用”态 |
| C-3 | 中文错误串绕过 locale | branch-row.tsx:326-328, 307, 319, 343；changes-tab.tsx:495/500/520/527 | `validateBranchName` 返回硬编码中文（git/branches.ts:69-82）直接 setError；Host 写路径的 `result.message`（中文）也直接上屏。英文用户在建分支主流程看到中文报错。修复：校验器返回 reason code → locale 键；Host reason 已结构化，message 应按 reason 本地化 |
| C-4 | diff 展开行仅鼠标可操作 | changes-tab.tsx:319 | `<li onClick>` 无 tabIndex/role/键盘处理——面板最核心交互（看 diff）对键盘/读屏用户不可达。修复：行头改为 button 或补 role="button" + Enter/Space |
| C-5 | 会话/工作区切换时分支菜单不收敛 | branch-row.tsx:197-202, 260, 290, 429-431 | 切 cwd/sessionId 只清 branches/confirming：菜单仍开着显示永远 "Working…"（且 Working/empty/失败三态混在 429-431 一处）；error/filter/creating 残留；`branchesRequestRef` 只在 loadBranches 内自增 → 工作区 A 的在途请求在 reset 后落地，把 A 的分支列表灌进 B 的菜单；finishMutation 里 `refreshStatus(cwd)` 是 await 后的旧闭包，可能把旧工作区 status 钉到新工作区。修复：cwd/sessionId 变化时 `setOpen(false)` 或重载 + 令牌失效 + 全量重置 |

### C 系 minor（摘要）

- C-6 失败的刷新会让已展开行卡在 'loading'（epoch 抬升丢弃在途装载、失败路径不恢复缓存、effect 依赖不变不再重跑）
- C-7 每次刷新清空 diff 缓存 → 展开行每 30s/聚焦闪一次 "Working…"；interval 只看 tab 可见不看窗口聚焦
- C-8 首次加载无 loading 态（面板空白）
- C-9 `lastDirtyRef` 不按 session/cwd 键控：脏→脏换会话时 'always' 自动打开被抑制
- C-10 row+chip 双挂载 → status/uiOptions/ensureBaseline 三组重复 RPC、auto-open 每会话双触发
- C-11 guide-card effect 依赖每次注入新建的 `changes` 闭包 → 父组件每渲染都重拉
- C-12 uiOptions 失败 fail-open 默认值可能与 Host 配置相反（'never'→'firstTurn'；面板被 Host 关闭却仍挂载）
- C-13 `changes.empty`（“本会话还没有改动”）复用于默认的 uncommitted 作用域——该作用域下语义应是“工作区干净”
- C-14 revert 进行中未禁用其他行的 revert 按钮（点击静默 no-op）
- C-15 点击/拖选展开的 diff 内容会误触收起（diff div 缺 stopPropagation）
- C-16 `\ No newline` 标记被 HunkBody 当 context 行：两侧行号同时 +1 → 同 hunk 后续行号错位 1（Host 侧 diff.ts:79 保留了该标记行，渲染端未特判）
- C-17 触发按钮缺 aria-haspopup/aria-expanded；menu 无方向键导航；tablist 缺 role="tab"/aria-selected；±N 徽标无 aria-label（≡R5-14）
- C-18 ≡ R5-4/R5-9（README:34 仍声称走 RPC 通道；wire.ts 通道常量/接口为死代码）

### C 系 nit（摘要）

死 locale 键（menu.local/menu.error/changes.retry/commit.selected——后者在 changes-tab:576 被手拼替代）；不必要的 `as GitPilotKey`；uiOptions 永不 reject 上的死 .catch；'feature/YYYYMMDD-' 默认值三处重复（branch-row:349/api.ts:46/config.ts:52）；行 key 含 status 导致状态变化时行重挂载；条件注入 hook 模式 `(useTabInfo ?? fallback)()` lint 不友好且与 guide-card 写法不一致；api.call 无超时/abort 且 `as T` 未校验；repo 判定式第二子句恒死；无错误边界、FileRow/HunkBody 未 memo（500 行上限）；inject 数组声明 sidebar 服务必需 vs 代码处处判 undefined 的矛盾（要么死检查、要么无 sidebar 的 Host 会白白挂不上分支控件）。

### 客户端 R1–R4 修复复验（子代理逐条核对）

R3-8 ✅（残留 C-6）· R1-3 ✅ · R1-5 ✅ · R1-6 ✅（含空路径失效）· R1-7 ✅（副作用 C-6/C-7）· R2-3 ✅（缺口 C-17）· R2-4 ✅ · R4-1 ✅（注意 C-9）· R3-12 竞态 ✅/搜索回车建分支 ✅/当前行点击关闭 ✅/展开收起 ✅/截断提示 ✅/react external ✅，**stale 菜单清理 PARTIAL**（见 C-5）· R3-13 **未通过——生产断裂**（≡R5-3）。

### 客户端正面观察

编译期 zh/en 键位强一致（Record<GitPilotKey,string>，范例级）；所有异步路径的 token/epoch 纪律一致；零监听器/interval 泄漏（add/remove 全配对、disposer 全返回）；安全姿态干净（无 dangerouslySetInnerHTML/eval，git 输出走 React 转义，地址 encodeURIComponent + try/catch decode，checkout 确认令牌护栏）；客户端↔Host 契约验证一致（sessionId→excludeSessionId、scope:'head' 路由）；刷新期间选中/展开态保持；异步注册的 disposed-flag 守卫；全量 `--dsw-alias-*` token + fallback。

---

*评审方法说明：Host 侧与流程侧发现（R5-1…R5-14）由主评审独立完成并对全部源码/测试/打包/运行时契约逐文件核对，含 3 组真实 git 实证实验（untracked 泄漏、ref-format 门控、无 HOME 提交）与干净环境 verify 复跑；客户端发现（C-x）由独立复审全量阅读 8 个客户端文件 + 打包产物 + 运行时类型契约交叉验证后合并，重叠项已双向印证。*
