/** Copy for both surfaces, keyed for the plugin's own locale namespace. */
export const NS = 'gitPilot'

export type GitPilotKey =
  | 'chip.detached'
  | 'menu.searchPlaceholder'
  | 'menu.empty'
  | 'menu.truncated'
  | 'menu.createBranch'
  | 'menu.createPlaceholder'
  | 'menu.createConfirm'
  | 'menu.switch'
  | 'menu.switchTo'
  | 'menu.dirtyConfirm'
  | 'menu.busyConfirm'
  | 'menu.protectedConfirm'
  | 'menu.cancel'
  | 'menu.working'
  | 'menu.local'
  | 'menu.remote'
  | 'menu.error'
  | 'changes.tabTitle'
  | 'changes.onBranch'
  | 'changes.onDetached'
  | 'changes.summary'
  | 'changes.empty'
  | 'changes.noRepo'
  | 'changes.truncated'
  | 'changes.refresh'
  | 'changes.expandAll'
  | 'changes.truncatedNote'
  | 'changes.collapseAll'
  | 'changes.binary'
  | 'changes.oversized'
  | 'changes.gitlink'
  | 'changes.status.modified'
  | 'changes.status.added'
  | 'changes.status.deleted'
  | 'changes.status.unmerged'
  | 'changes.status.untracked'
  | 'changes.loadFailed'
  | 'changes.retry'
  | 'guide.description'
  | 'guide.loading'
  | 'scope.uncommitted'
  | 'scope.session'
  | 'commit.action'
  | 'commit.placeholder'
  | 'commit.confirm'
  | 'commit.working'
  | 'commit.selected'
  | 'commit.nothing'
  | 'commit.failed'
  | 'revert.action'
  | 'revert.confirmTitle'
  | 'revert.confirm'
  | 'revert.cancel'
  | 'revert.working'
  | 'revert.unsupported'
  | 'revert.newFile'
  | 'revert.failed'

export const zh: Record<GitPilotKey, string> = {
  'chip.detached': '分离 HEAD',
  'menu.searchPlaceholder': '搜索分支…',
  'menu.empty': '没有匹配的分支',
  'menu.truncated': '分支过多，仅显示部分',
  'menu.createBranch': '创建分支',
  'menu.createPlaceholder': '新分支名称',
  'menu.createConfirm': '创建并切换',
  'menu.switch': '切换',
  'menu.switchTo': '切换到该分支',
  'menu.dirtyConfirm': '工作区有 {count} 个未提交文件，切换可能带来冲突或把改动带到新分支。仍要切换吗？',
  'menu.busyConfirm': '还有 {count} 个会话正在使用此项目，切换分支会影响它们。仍要切换吗？',
  'menu.protectedConfirm': '{name} 是受保护分支，通常不应直接切换。仍要继续吗？',
  'menu.cancel': '取消',
  'menu.working': '处理中…',
  'menu.local': '本地分支',
  'menu.remote': '远程分支',
  'menu.error': '操作失败',
  'changes.tabTitle': '变更',
  'changes.onBranch': '分支 {branch}',
  'changes.onDetached': '分离 HEAD',
  'changes.summary': '{files} 个文件 · +{added} −{deleted}',
  'changes.empty': '本会话还没有改动任何文件',
  'changes.noRepo': '当前项目不是 git 仓库',
  'changes.truncated': '仅列出 {shown} 个文件，共 {total} 个',
  'changes.refresh': '刷新',
  'changes.expandAll': '全部展开',
  'changes.truncatedNote': '输出过大，diff 已截断',
  'changes.collapseAll': '全部收起',
  'changes.binary': '二进制',
  'changes.oversized': '文件过大',
  'changes.gitlink': '子模块',
  'changes.status.modified': '修改',
  'changes.status.added': '新增',
  'changes.status.deleted': '删除',
  'changes.status.unmerged': '冲突',
  'changes.status.untracked': '未跟踪',
  'changes.loadFailed': '加载失败',
  'changes.retry': '重试',
  'guide.description': '查看本会话改动的文件与行数',
  'guide.loading': '统计中…',
  'commit.action': '提交',
  'commit.placeholder': '提交信息…',
  'commit.confirm': '确认提交',
  'commit.working': '提交中…',
  'commit.selected': '已选 {count}/{total} 个文件',
  'commit.nothing': '没有可提交的改动',
  'commit.failed': '提交失败',
  'revert.action': '恢复',
  'revert.confirmTitle': '恢复此文件？未提交的修改将丢失。',
  'revert.confirm': '确认恢复',
  'revert.cancel': '取消',
  'revert.working': '恢复中…',
  'revert.unsupported': '未跟踪文件不支持恢复',
  'revert.newFile': '新增文件不支持恢复',
  'revert.failed': '恢复失败',
  'scope.uncommitted': '未提交',
  'scope.session': '本会话',
}

export const en: Record<GitPilotKey, string> = {
  'chip.detached': 'detached HEAD',
  'menu.searchPlaceholder': 'Search branches…',
  'menu.empty': 'No matching branches',
  'menu.truncated': 'Too many branches; showing a subset',
  'menu.createBranch': 'Create Branch',
  'menu.createPlaceholder': 'New branch name',
  'menu.createConfirm': 'Create & switch',
  'menu.switch': 'Switch',
  'menu.switchTo': 'Switch to it',
  'menu.dirtyConfirm': '{count} uncommitted file(s) in the worktree. Switching may conflict or carry them over. Switch anyway?',
  'menu.busyConfirm': '{count} other session(s) are using this project; switching affects them. Switch anyway?',
  'menu.protectedConfirm': '{name} is a protected branch and is usually not switched to directly. Continue?',
  'menu.cancel': 'Cancel',
  'menu.working': 'Working…',
  'menu.local': 'Local branches',
  'menu.remote': 'Remote branches',
  'menu.error': 'Operation failed',
  'changes.tabTitle': 'Changes',
  'changes.onBranch': 'On {branch}',
  'changes.onDetached': 'On detached HEAD',
  'changes.summary': '{files} file(s) · +{added} −{deleted}',
  'changes.empty': 'This session has not changed any file yet',
  'changes.noRepo': 'The current project is not a git repository',
  'changes.truncated': 'Showing {shown} of {total} files',
  'changes.refresh': 'Refresh',
  'changes.expandAll': 'Expand all',
  'changes.truncatedNote': 'Output too large; diff truncated',
  'changes.collapseAll': 'Collapse all',
  'changes.binary': 'binary',
  'changes.oversized': 'too large',
  'changes.gitlink': 'submodule',
  'changes.status.modified': 'modified',
  'changes.status.added': 'added',
  'changes.status.deleted': 'deleted',
  'changes.status.unmerged': 'unmerged',
  'changes.status.untracked': 'untracked',
  'changes.loadFailed': 'Failed to load',
  'changes.retry': 'Retry',
  'guide.description': 'Files and lines this session changed',
  'guide.loading': 'Counting…',
  'commit.action': 'Commit',
  'commit.placeholder': 'Commit message…',
  'commit.confirm': 'Commit',
  'commit.working': 'Committing…',
  'commit.selected': '{count}/{total} files selected',
  'commit.nothing': 'Nothing to commit',
  'commit.failed': 'Commit failed',
  'revert.action': 'Revert',
  'revert.confirmTitle': 'Revert this file? Uncommitted changes will be lost.',
  'revert.confirm': 'Revert',
  'revert.cancel': 'Cancel',
  'revert.working': 'Reverting…',
  'revert.unsupported': 'Untracked files cannot be reverted',
  'revert.newFile': 'Added files cannot be reverted',
  'revert.failed': 'Revert failed',
  'scope.uncommitted': 'Uncommitted',
  'scope.session': 'This session',
}
