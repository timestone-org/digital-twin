# 知识库技能与上下文工程

知识库和 AI 助手共用 `llmcore.skills` 的 [Agent Skills](https://agentskills.io/specification)
包格式与工具校验机制。知识库只有一个对话入口，使用固定技能目录，
模型根据用户问题与技能简介按需加载正文；不采集页面信息或配置 URL 映射。
边界见 [知识库 ADR-0001](../server/services/knowledge-server/docs/adr/0001-知识库对话使用标准技能且保留检索边界.md)。

## 目录与接入

```text
server/domain/llmcore/src/llmcore/
├── skills/                 # 标准包解析、资源分页、技能恢复
├── tools/execution.py      # JSON Schema 校验、元数据工具、可恢复错误
└── turn/                   # 通用回合循环；模型输入投影与持久化消息分离

server/services/knowledge-server/src/knowledge_server/apps/chat/
├── skills/
│   ├── library/
│   │   ├── knowledge-retrieval/SKILL.md
│   │   └── knowledge-live-data/SKILL.md
│   └── integrations.json   # 内建技能的权限与工具说明
└── services/
    ├── context.py          # 知识库预算投影，保留问题与完整工具批次
    ├── prompt.py           # 常驻只读、引用、范围规则
    └── tools/              # 知识库硬范围过滤与工具实现
```

外部技能可以整目录复制到 `skills/library/<name>/`，重启 API 后自动加入固定目录；
不需要新增 Python 清单。标准入口必须为大写 `SKILL.md`，frontmatter 包含 `name`
和 `description`，`name` 与目录同名。附加 `references/`、`scripts/`、`assets/`
及其他客户端元数据可以保留，脚本只提供源码读取，不在服务主机执行。

示例包：

```text
knowledge-skills/equipment-manual/
├── SKILL.md
└── references/checklist.md
```

```markdown
---
name: equipment-manual
description: 根据设备型号和知识库资料回答操作与维护问题，核对证据来源及缺项。
---

先确认设备型号，用 kb.list_bases 和 kb.search 取得真实库与片段。
引用原样保留系统 mark；不足时说明缺项。检查维护步骤时读取
[核对清单](references/checklist.md)。完成前核对每条结论与其引用是否对应。
```

内建目录提供 `knowledge-retrieval` 与 `knowledge-live-data`；附加包与内建包
统一按权限过滤并列出简介。选择哪一个技能由问题内容决定，原有六个业务工具
保持可用。

可选部署配置：

```dotenv
KNOWLEDGE_SKILLS_DIRECTORY=/opt/digitaltwin/knowledge-skills
```

目录配置可选，空值使用内建包；配置后将附加目录中的包加入内建集合。Docker 路径
指容器内部，需要通过 Compose override 只读挂载：

```yaml
services:
  knowledge-server:
    volumes:
      - ./knowledge-skills:/opt/digitaltwin/knowledge-skills:ro
```

修改包后重启 API；多个副本应使用同一版本。复制到源码目录的包需重新
构建镜像。API 启动时拒绝重名、无效元数据、缺少正文；worker
不加载对话技能，其摄取任务不依赖这些资源。

只会展示已有客户端实现的工具。第三方技能若要求 Bash、桌面应用或特定 MCP，需
另外接入对应受控工具；`allowed-tools` 等元数据不会自动安装能力或扩大权限。

## 上下文层次

| 层 | 内容 | 生命周期和预算 |
| --- | --- | --- |
| 稳定规则 | 中文回答、只读、引用、取消选择、工具失败口径 | 同一能力集合保持稳定，不放用户信息 |
| 会话范围 | 数据库记录的全部库或指定库 | 每次推进重新读取，三个知识库工具各自硬过滤 |
| 摘要与历史 | 结构化摘要、最近消息、调用与回执 | 台阶窗口；小窗口时再按实际总成本裁剪 |
| 当前问题 | 最近的用户问题和正在处理的工具批次 | 优先保留，工具调用和所有回执成组处理 |
| 技能正文 | `skills.load` 的成功回执 | 单独加载；窗口外恢复最近两个当前仍可见技能 |
| 参考资料 | 技能包资源、检索到的原文 | 按需读取，不把整个资源目录塞入提示词 |

已知模型窗口时，每次请求按真实工具 Schema、规则、范围、摘要、历史和技能恢复的
总大小计算预算。投影只改变发送给模型的消息，图状态与落库会话仍保留完整
记录。裁剪后重新计算技能恢复，避免恢复内容再次挤满窗口；确实无法容纳当前问题
或工具批次时返回可理解的错误，要求缩小查询或增加模型上下文预算。

`KNOWLEDGE_MODEL_CONTEXT_TOKENS=0` 仍表示未知，不猜测窗口大小。正值应采用模型
端点的有效单请求窗口；字符换算是保守估算，不是分词器的精确计量。小窗口需要把
长 Skill 入口拆成短流程与 `references/`，资源索引和正文均有文件大小限制。

## 工具契约与失败

原有工具名称、参数结构、执行位置不变：

| 工具 | 执行位置 | 结果与约束 |
| --- | --- | --- |
| `kb.list_bases` | 服务端 | 会话范围内的真实库、策略与总数 |
| `kb.search` | 服务端 | 命中片段、系统 mark、库、文档、定位，保留引用账本 |
| `kb.read_chunk` | 服务端 | 块及相邻正文，再次核对块所属库是否在范围内 |
| `user.ask` | 浏览器 | 选项、多选、自由输入及取消状态；点位选择取消即停止 |
| `collect.search_points` | 浏览器 | 真实点位及来源，返回完整 node_key |
| `collect.watch_point` | 浏览器 | 创建持续推送卡片；读数、质量、连接状态留在卡片 |
| `skills.load` | 服务端 | 完整指令及资源索引；必须单独调用 |
| `skills.read_resource` | 服务端 | 完整文本行、行号、has_more、next_line；按续读位置读取 |
| `tools.describe` | 服务端 | 本轮实际工具的输入 Schema、输出、副作用与恢复方式 |

服务端执行前按实际 Schema 校验参数。错误包含 `code`、`message`、`execution`、
`retryable` 和 `next_action`：`invalid_arguments` 修正字段，`out_of_scope` 由用户
调整会话范围，`context_budget_exceeded` 缩短技能入口或增大预算，依赖失败不当成
空结果。未确定写入结果时不建议盲目重试；知识库对话本身只提供只读业务工具。

技能与资源工具按本次完整 JSON 回执预算执行：正文不能完整返回时明确失败，
资源则按完整行分页并准确更新 `next_line`，不让通用结果裁剪器再截断成功回执。
路径必须来自资源索引且仍位于技能目录内；隐藏文件、缓存与符号链接不提供给模型。

## 功能一致性约束

范围硬过滤、引用账本与持久化、`session_titled` / citations 在 `turn.done` 之前的
顺序、待续工具回填、实时卡片和语音输入保持原约定。导入、解析、分块、向量索引、
检索策略、重排、来源同步、worker 认领及数据库结构不因技能接入而改变。

旧工具参数以 `tests/fixtures/chat_tool_inputs.json` 固定，契约测试防止无意改动；
6656 token 配置的调用链测试覆盖加载技能、资源分页、检索点位、歧义多选和多卡片。
