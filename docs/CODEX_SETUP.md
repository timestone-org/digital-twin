# Codex 项目配置

在 Codex 中打开本仓库，并从仓库目录启动新任务。根目录 `AGENTS.md` 是统一的项目指令入口，包含原 Claude 配置中的全部工程规范摘要；按任务范围继续阅读其中引用的 `docs/agents/` 文档。

## 配置对应关系

| 原配置 | Codex 中的处理 |
|---|---|
| `CLAUDE.md` 中的项目规范 | 已迁入根目录 `AGENTS.md`；`CLAUDE.md` 保留为引用它的兼容入口 |
| Claude 项目 memory | 已按“决策 / 规范 / 历史状态”分类；有效决策进入 ADR 或已有设计文档，操作经验进入工程规范或闸门，历史状态不复制 |
| `docs/agents/*.md` 工程文档 | 保留原路径，由 `AGENTS.md` 指引按需阅读 |
| `.claude/settings.local.json` 的 `permissions.allow` | 属于 Claude 的本地执行授权，未直接转换；Codex 使用当前客户端的权限与沙箱设置 |
| `.claude/worktrees/` | 保留原 Git 工作树及其未提交内容；不复制或移动到 Codex |
| `.claude/scheduled_tasks.lock` | 本机会话锁，不包含可迁移的任务定义，保留并忽略 |

仓库内没有需要转换的项目级 MCP 配置或 hooks；工程技能已位于 `.agents/skills/`。Claude 在 `~/.claude/projects/.../memory/` 保存的项目记忆不会被 Codex 自动读取，因此其内容不能作为架构真源。迁移后的权威入口是 `AGENTS.md`、`CONTEXT-MAP.md`、相关 `CONTEXT.md`、`docs/adr/` 与 `docs/agents/`。

## 权限与模型

本项目不强制模型、账号、推理强度或权限策略，因此无需新增 `.codex/config.toml`。Codex 继续使用客户端及用户配置；原 Claude 对 `git *`、`gh pr *` 等命令的放行记录不会自动成为 Codex 的授权。

需要自定义时，用户级配置位于 `~/.codex/config.toml`，项目级配置位于 `.codex/config.toml`。项目配置仅在项目受信任时加载，且仍受客户端覆盖项和管理策略约束。不要将 Claude 的 JSON 权限通配符直接粘贴到 TOML。

此次迁移不涉及应用运行时的 LLM 提供商、OAuth 凭据或 `docker/.env`：这些属于 DigitalTwin 服务配置，与编程助手的项目指令独立。

## 验证与日常使用

1. 在本仓库目录启动新的 Codex 任务，让它列出加载的项目指令来源，应包含根目录 `AGENTS.md`。
2. 提交任务时直接描述需求；Codex 应在编辑前列出它按修改范围读取的领域上下文与 ADR。
3. 修改工程规范时，更新 `AGENTS.md` 或对应 `docs/agents/` 文档；Claude 的兼容入口共享同一份规范。

已有会话不保证重新加载新增的指令文件，使用新任务验证加载结果。此次变更只包含代理指令和文档；业务代码的测试与发布仍遵循 `docs/agents/ci-gates.md`。

## 官方文档

- [AGENTS.md 的发现与加载规则](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Codex 配置层级与权限设置](https://learn.chatgpt.com/docs/config-file/config-basic)
