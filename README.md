# dsh-git-pilot

Git branch copilot and per-session change insights for DeepSeek Harness (DSH).

- **Branch control** — a Cursor-style branch row under the composer (plus a compact chip in the composer tool row): the workspace's current branch appears automatically with every session, the menu searches/switches branches (selecting a remote branch creates its local tracking branch instead of detaching HEAD), and `+ Create Branch` creates and checks out a new branch with a configurable name template.
- **Changes tab** — a right-Sidebar tab that tracks what the *current session* changed against its baseline: cumulative file count and `+added −deleted` lines, per-file statuses and counts, and a per-file unified diff. Baseline = the repository state captured when the session opened, so totals mean "this session's work", survive agent commits, and include edits made through Bash.

English | [中文](#中文)

## Install

```bash
pnpm add dsh-git-pilot
```

Then mount it in your DSH profile — the shipped `cordis.patch.yml` inserts the plugin row (`id: git-pilot`); apply it with your profile patch or the plugin manager, then restart DSH (or reload a live profile).

## Use

- Open any session whose workspace is a git repository: the branch appears under the composer. Click it to search, switch (guarded), or create a branch.
- When the session starts changing files, the `±N` badge next to the branch opens the right-Sidebar **Changes** tab; the tab also opens itself after the first changing turn (`autoOpenChanges`).
- Outside a git repository, or without git, every surface stays hidden — no noise, no errors.

### Branch-switch guards

`checkout` never runs silently. Depending on the state you get, and must confirm, one of:

| Guard | Trigger | Token |
|---|---|---|
| Dirty worktree | uncommitted changes present | `dirty` |
| Busy sessions | other live sessions share the workspace | `busy-sessions` |
| Protected branch | target matches `protectedBranches` | `protected` |

Mutations ride the `/git-pilot-write` RPC channel and, when a workspace registry exists, are restricted to registered workspace paths. Only names that resolve to a local or remote-tracking branch are accepted (a checkout of a path or option string is rejected before git runs). Note for this runtime generation: the connection transport ignores per-channel authority labels, so the effective gate is the Host/Origin fence plus browser auth — the confirm-token guards live in the service layer.

## Config

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `branchChip` | `true` | Compact chip in the composer tool row. |
| `composerBranchRow` | `true` | Branch row under the composer card. |
| `changesPanel` | `true` | Right-Sidebar Changes tab type. |
| `autoOpenChanges` | `firstTurn` | `never` / `firstTurn` / `always`. |
| `remoteBranches` | `false` | List remote branches in the menu. |
| `autoFetch` | `false` | `git fetch --prune` when the menu opens (network side effect). |
| `timeoutMs` | `10000` | Per-command git timeout. |
| `maxBranches` | `200` | Menu rows kept. |
| `maxFiles` | `500` | Change rows kept (totals stay complete). |
| `maxFileBytes` | `2MiB` | File read cap for counts/diffs. |
| `branchNameTemplate` | `feature/YYYYMMDD-` | Create-branch prefill; `YYYY`/`MM`/`DD` expand. |
| `protectedBranches` | `['master','main','release/*']` | Checkout-in guard patterns. |

## Understand the implementation

- **Host half** (`lib/index.js`): provides the `gitPilot` service over `subprocess`; every git command runs with a timeout, scrubbed env (`GIT_TERMINAL_PROMPT=0`…), and bounded output; the macOS `/usr/bin/git` Xcode stub is probed like the workspace-changes plugin does.
- **Baseline**: captured once per session (lazy, or at first UI mount). `git stash create` records the tracked worktree+index state as a commit object without touching the stash ref; an all-clean tree falls back to HEAD. Session changes = `git diff --name-status/--numstat <baseline>` for tracked paths plus untracked paths from `git status --porcelain=v2` (line counts via a capped read; DR-2: non-empty lines).
- **Browser half** (`lib/client.js`): registers into the shipped seats only — `conversation.composer.dock`, `conversation.input.left`, and a keyed `sidebar.right.pane.tab` type (`dsh-resource://git-pilot-changes/session/<id>`). Copy lives in the `gitPilot` locale namespace (zh/en); colors use `--dsw-alias-*` tokens.
- **HTTP routes**: eight authenticated exact routes on the connection service's fetch registry — `/api/git-pilot/read/*` (status, branches, session changes) and `/api/git-pilot/write/*` (create-branch, checkout) — the same mechanism the official `/api/changes.summary` route uses.

### Known limitations

- Renames are shown as delete+add pairs (`--no-renames` keeps the `-z` parsing unambiguous). Submodule pointer moves are listed without counts (marked "submodule"); dirty submodule content is ignored as phantom work.
- Untracked line counts skip empty lines; once git tracks the file its numstat counts every line.
- The Changes tab refreshes on navigation, window focus, a 30 s soft interval, and manual refresh — not on a live filesystem watch.
- Branch switches affect the whole worktree (git semantics): other sessions on the same directory see the switch, hence the busy-session guard. A successful switch resets the baselines of every session on that workspace, so the panel restarts from the new branch's state.
- Baselines live in Host memory and are anchored under `refs/git-pilot/<session>` so a `git gc` cannot erase them; after a Host restart the panel shows only the changes made after the restart (leftover anchor refs are harmless and never fetched).
- Line-count reads for untracked files stop at `maxFiles` rows; a summary marked "truncated" may under-count beyond that.

## Develop

```bash
pnpm install
pnpm verify        # typecheck + tests + build
```

Tests run real git against temporary repositories through a node-based subprocess double; client components are covered with Testing Library under jsdom.

## 中文

`dsh-git-pilot` 为 DeepSeek Harness 提供两个能力：

1. **分支助手**：新会话自动带出项目当前分支；点击分支可搜索、切换、按模板新建分支（composer 下方分支行 + 工具行紧凑 chip 两个挂载点）。
2. **会话变更面板**：右侧栏 `Changes` 标签页，以「会话基线 → 当前工作区」统计本会话累计改动（文件数、+行 / −行、逐文件 diff，含 Bash 产生的改动），Agent 提交后统计依然稳定。

切换分支有三重护栏：脏工作区确认、同工作区其他会话确认、保护分支确认；所有写操作仅由用户点击触发。非 git 目录或 git 不可用时全部界面自动隐藏。

详细需求设计见 `docs/requirements-design.md`。

## License

MIT
