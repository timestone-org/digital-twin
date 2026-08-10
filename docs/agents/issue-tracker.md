# Issue tracker：GitHub

本仓的议题与规格以 GitHub issue 的形式存放。所有操作统一走 `gh` CLI。

## 约定

- **建 issue**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读 issue**：`gh issue view <number> --comments`，评论用 `jq` 过滤，同时把标签一并取出。
- **列 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` 与 `--state` 过滤。
- **评论**：`gh issue comment <number> --body "..."`
- **加/去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

仓库从 `git remote -v` 推断——在克隆目录里运行时 `gh` 会自动完成这一步。

## PR 是否算一个分诊入口

**PR 作为需求入口：否。** _（若本仓把外部 PR 当作需求提报，改成"是"；`/triage` 会读这个开关。）_

改成"是"之后，PR 与 issue 走同一套标签和状态，命令换成 `gh pr` 对应项：

- **读 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待分诊的外部 PR**：`gh pr list --json` **没有** `authorAssociation` 字段（兄弟仓 2026-08-02 实测：`gh pr list --json foo` 会列出合法字段集，其中不含该字段；`gh pr view --json` 同样如此）。改用 REST API，它确实暴露这个字段：
  `gh api "repos/{owner}/{repo}/pulls?state=open" --jq '[.[] | {number, title, body, labels: [.labels[].name], author: .user.login, authorAssociation: .author_association}]'`
  然后只保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR`、`NONE` 的项（丢掉 `OWNER`/`MEMBER`/`COLLABORATOR`）。该响应里没有评论正文，需要时按 PR 单独取：`gh pr view <number> --json comments`。
- **评论/标签/关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用同一个编号空间，所以孤立的 `#42` 可能是其中任意一种——先 `gh pr view 42`，失败再回退到 `gh issue view 42`。

## 当 skill 说"publish to the issue tracker"

建一个 GitHub issue。

## 当 skill 说"fetch the relevant ticket"

执行 `gh issue view <number> --comments`。

## Wayfinding 相关操作

供 `/wayfinder` 使用。**map** 是一个 issue，**child** 是挂在它下面的子 issue，一条子 issue 即一张票。

- **Map**：一个打了 `wayfinder:map` 标签的 issue，正文承载 Notes / Decisions-so-far / Fog 三段。`gh issue create --label wayfinder:map`。
- **子票**：以 GitHub sub-issue 的方式挂到 map 上（走 `gh api` 的 sub-issues 端点）。若该仓未启用 sub-issue，就在 map 正文的任务列表里加一行，并在子票正文顶部写 `Part of #<map>`。标签用 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。被认领后，票指派给推进它的人。
- **阻塞**：用 GitHub **原生的 issue dependencies**，这是唯一在 UI 上可见的权威表示。加一条边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞方的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，**不是** `#number`，也不是 `node_id`）。GitHub 会返回 `issue_dependencies_summary.blocked_by`（只统计未关闭的阻塞方——这就是实时闸门）。若该能力不可用，退回到子票正文顶部的一行 `Blocked by: #<n>, #<n>`。所有阻塞方都关闭了，这张票才算解除阻塞。
- **前沿查询**：列出 map 下所有未关闭的子票（`gh issue list --state open`，范围限定在 map 的 sub-issues 或任务列表内），剔除仍有未关闭阻塞方的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里还有未关闭的 issue）以及已有 assignee 的；剩下的按 map 里的顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`——这是一次会话的第一个写操作。
- **结票**：先 `gh issue comment <n> --body "<answer>"`，再 `gh issue close <n>`，然后把一条上下文指针（gist + 链接）追加到 map 的 Decisions-so-far 段里。
