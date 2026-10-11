# AI 助手技能与上下文工程

技能格式遵循 [Agent Skills 规范](https://agentskills.io/specification)。
页面决定推荐哪些技能，用户权限和已实现工具决定实际能力；映射不是授权。
运行边界见 [助手 ADR-0002](../server/services/ai-assistant/docs/adr/0002-标准技能包与页面映射分离.md)。

## 安装与映射

内建资源在 `server/services/ai-assistant/src/ai_assistant/apps/chat/skills/`：

```text
skills/
├── library/
│   ├── dashboard-binding/
│   │   ├── SKILL.md
│   │   └── references/
│   └── ...
├── routes.json          # 页面路径 → 技能，多对多
├── integrations.json    # 本项目内建技能的权限、工具与旧客户端工作面回退
├── manifest.py          # 进程内值对象
├── loader.py            # 标准包解析与有界资源读取
├── registry.py          # 显式启动装配
└── routing.py           # 助手路径前缀适配
```

包解析、元数据、路径匹配、资源读取、成功技能恢复与执行前校验由
`server/domain/llmcore/` 提供，助手目录中的同名模块保留兼容入口。知识库复用同一
机制，使用单入口的固定技能目录，配置与业务范围独立，见 [知识库接入指南](KNOWLEDGE_SKILLS.md)。

把外部技能整个目录复制进 `library/`，在 `routes.json` 增加映射。源码运行时重启
助手生效；打包部署时重新构建并替换助手镜像，文件会随镜像发布。
也可以把扩展包单独挂载到服务主机，配置：

```dotenv
ASSISTANT_SKILLS_DIRECTORY=/opt/digitaltwin/assistant-skills
ASSISTANT_SKILLS_ROUTES_FILE=/opt/digitaltwin/assistant-skill-routes.json
```

两个配置独立可选；空值使用内建配置。扩展目录与附加映射加入内建集合，重名、缺少
正文、无效元数据、映射引用不存在的技能会在启动时拒绝。目录只在启动时读取；修改
包或映射后重启，不在请求中隐式重新扫描。多个副本应挂载相同版本。

Docker 中变量指向容器内路径，部署方通过 Compose override 只读挂载，例如：

```yaml
services:
  ai-assistant:
    volumes:
      - ./assistant-skills:/opt/digitaltwin/assistant-skills:ro
      - ./assistant-skill-routes.json:/opt/digitaltwin/assistant-skill-routes.json:ro
```

挂载方案首次接好后，后续复制技能与修改映射只需重启助手，不必重建镜像。

一个最小技能：

```text
assistant-skills/pump-guide/
├── SKILL.md
└── references/pump.md
```

```markdown
---
name: pump-guide
description: 核对水泵操作说明和维修记录；用于解释设备参数及维护步骤。
---

先确认设备型号和资料来源。查维护步骤时读取 [规程](references/pump.md)。
根据已读取的证据回答，指出资料缺项及需要现场核实的条件。
```

附加映射文件：

```json
{
  "routes": [
    {
      "paths": ["/datasets/:tableId/**", "/reports/templates/:templateId"],
      "skills": ["pump-guide"]
    }
  ]
}
```

路径取 Vue Router 的应用内 pathname；浏览器 `/ai/` 前缀自动去掉。`:参数` 与 `*`
匹配一个非空路径段，末尾 `/**` 匹配本路径及子路径；多条命中取技能并集，按名称
稳定排序。query、fragment 和域名不参与匹配，也不注入模型。页面缺少路径的旧
客户端继续按内建工作面配置选技能；提供了路径但未匹配时不猜测回退。

URL 映射可直接复用已接入助手的页面。新增页面的助手入口及浏览器业务操作仍需
实现 `AiSurface`；复制技能不会生成页面工具。格式兼容包括标准 frontmatter、
`references/`、`scripts/`、`assets/` 和附加客户端文件。其他客户端的特有元数据不
改变本项目的权限政策。资源按相对路径读取；脚本可读源码但不会在服务主机执行。
依赖 Bash、桌面应用或特定 MCP 的技能，需要本部署已有对应的受控工具才能执行。

## 编写技能

入口只保留任务触发条件、主流程、必要约束与可核验的完成条件。某个分支才需要的
字段语义和操作示例放 `references/`，在入口指明何时读取；资源不自动全量注入。

把输入身份的来源说清楚，例如 `node_key` 从点位检索和详情核对取得，实体 `id`
从同一 section 的名片取得。把“调用成功”“草稿已改”“已保存”“已读回实时值”
分别验收。工具失败时按返回的恢复步骤处理，尚未完成的对象保留在计划中。

普通外部技能只需目录与页面映射；不需要新增 Python 清单。只有要扩展实际业务
工具时，才在工具注册表实现并声明工具，并为相关内建集成配置权限和浏览器能力。
`allowed-tools` 不能安装工具、启动脚本或绕过用户授权。

## 上下文结构与预算

| 内容 | 生命周期 | 装配规则 |
| --- | --- | --- |
| 系统规则 | 产品版本 | 固定中文行为约束，不放用户和具体对象信息 |
| 能力目录 | 页面映射与权限 | 同一份技能选择结果用于提示词、工具选择及技能加载 |
| 历史摘要与消息 | 会话 | 台阶窗口保留最近 40 条；回执紧邻所属调用，未知结果明确标注 |
| 已加载技能 | 任务 | skills.load 单独执行；历史窗口外只恢复最近两个仍获准技能 |
| 当前状态 | 每次推进 | 页面路径、标题、选中项、快照和计划放末尾，不落库为历史快照 |
| 参考资料 | 按需 | skills.read_resource 按行读取，使用 next_line 续读 |

内建大屏常驻提示词保持 1800 字以内。技能入口限制 16000 字符，恢复技能总预算
18000 字符，超出时保留重新加载指引。单次工具文本最多 20000 字符；快照 JSON
最多 6000 字符，优先保留页面与选中项，省略部分显式标记且保持 JSON 合法。
资源单文件最多 256000 字节，每次默认 80 行、最多 200 行及 12000 字符。图片只在
当前轮传递，历史留占位。模型自身的窗口预算继续由 llmcore 执行。

浏览器在一轮开始时固定页面路径与工作面实例，续轮或派发工具前检查；切页后停止
旧回合，不让旧调用落到新对象。已执行调用仍沿用实际回执保存流程。

## 工具契约与失败恢复

每个内建工具的模型声明含输入 JSON Schema、执行位置、输出语义与副作用。
`tools.describe({"name":"twin.list_entities"})` 可按需获取完整契约，不必把所有
示例一次塞进系统提示词。服务端执行前按同一 Schema 校验；浏览器工具由页面的
参数与业务校验执行，失败回执交回模型并保留。

失败信息包含稳定 code、execution、retryable 与 next_action。参数错误在执行前
拒绝，说明字段路径、期望类型或约束；未知工具只从本轮清单重选。业务失败与未知
执行结果不会伪装成空查询结果，也不能被当作成功。写操作超时或异常先读回核验，
不能因“可重新调用”而盲目重复写入。外部异常原文不回显连接串与凭据。

实时绑点仍按“读现状 → 找候选 → 核对详情 → 写草稿 → 告知整份保存 → 保存 →
读回数值 → 诊断”验收。仅进入工具历史、仅生成计划或仅显示绑定都不等于完成。
