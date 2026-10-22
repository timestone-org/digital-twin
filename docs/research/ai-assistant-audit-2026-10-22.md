# AI 助手提示词、工具与本地实现审计

日期：2026-10-22。源码基线：`bd36331c170542c6dd413acd9b657eef213a616a`。

本轮是分析，不修改产品代码。依据为当前仓库源码、现有规范及离线调用；下面区分已确认的实现偏差与需要真实任务验证的风险。没有把注册成功、契约测试通过或工具返回成功等同于实际业务任务已完成。

## 结论

可以优化。现有的“工作面选技能、浏览器修改草稿、服务端读取业务数据、回执落库、技能按需加载”结构可以保留。主要投入应放在工具契约与实际行为的一致性、整段上下文预算、实时结果验收及任务级评测。单纯加长系统提示词不能解决这些问题。

## 审计边界与证据

- 本报告的提示词部分覆盖常驻 prompt、状态块、计划、历史摘要、技能恢复、9 个内建技能的全部正文与 9 份参考资源、routes/integrations、当前工具选择与元数据说明。
- 离线导入实际注册表，检查技能提及的工具与各工作面可见工具；没有发起计费模型请求。
- 离线构造长历史，调用真实 `assemble()` 观察模型输入大小；这证明预算接线情况，不宣称已复现当前部署模型的上下文拒绝。
- 运行容器、全部工具逐项对照、后端工具和前端专项实测尚未完成，见后续待验证清单。

上下文预检：AI 助手 `CONTEXT.md`、`web/CONTEXT.md`、`llmcore/README.md`；根 ADR-0023、0029（deprecated）、0030、0032、0035、0037（superseded）、0041、0055；助手 ADR-0001、0002。遵循页面映射不授权、写入浏览器草稿、当前用户身份访问业务服务等已有决定。本次没有建议推翻这些边界。

## 当前能力与提示词成本

当前注册表有 **64 个内建工具、9 个技能**。以下按每个工作面全部内建技能获准、页面上报其实现工具并带 `user.ask` 计算；不含部署动态 MCP。字符数是 `json.dumps(..., ensure_ascii=False)` 的结果长度，不是 token 数。

| 工作面 | 工具数量 | 工具声明 JSON 字符数 | 常驻提示词字符数 |
| --- | ---: | ---: | ---: |
| 大屏编辑器 | 43 | 29,634 | 1,640 |
| 三维孪生编辑器 | 33 | 23,883 | 1,611 |
| 二维孪生编辑器 | 29 | 21,063 | 1,426 |
| 台账详情 | 22 | 14,841 | 1,360 |
| 报告模板编辑器 | 24 | 16,883 | 1,366 |
| 大屏运行页 | 17 | 11,764 | 1,295 |
| 采集配置页 | 17 | 11,764 | 1,295 |

主要常驻成本来自工具 Schema 与工具说明，而非约 1,300–1,640 字的系统提示词。每个工具还由 `with_guides()` 追加执行位置、影响、输出和失败提示，完整契约又可经 `tools.describe` 获取。应先实测精简重复说明、按任务分组暴露工具的收益，不能只压缩系统提示词。工具授权与发现需分别处理，仍保留明确的跨模块只读入口。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/services/intent/select.py:33-76,105-125`；`server/services/ai-assistant/src/ai_assistant/apps/chat/services/tools/guides.py:255-262`；`server/services/ai-assistant/src/ai_assistant/apps/chat/skills/registry.py:13-23`。

所有技能正文引用的业务工具名称在总注册表中均存在。未发现内建技能引用一个完全不存在工具的情况。不过，共用技能需要继续按工作面细化：孪生页面的 `dashboard-binding/references/special-bindings.md` 仍提到当前工作面未提供的 `dashboard.set_config`；历史章节的 `dashboard.read_config` 已明确限定大屏编辑器，不应误报为缺失实现。

## 已确认偏差与优化项

### P1：整段上下文预算机制没有接到 AI 助手入口

`advance()` 创建 `TurnDeps` 时只传 `model/specs/run_tool/choice`；`max_context_chars` 保持默认 0，`prepare_messages` 保持 None。回合循环中 0 表示不限预算：不会因为累计内容过大而撤下工具，单次结果仍最多 20,000 字符。`assemble()` 只做消息条数窗口及用户要求恢复，没有调用按字符裁剪的 `history.fitted()`。模型外壳也不进行总预算投影。

离线构造 20 组、每组 20,000 字符的工具回执后，真实 `assemble()` 经 40 条台阶窗口处理，仍产出 **33 条消息、301,976 字符**，尚未加入约 23,883 字符的三维页面工具声明。这里没有调用真实模型。可以确认的是“总预算未启用”；是否已超过当前所选模型窗口，要结合实际模型配置判断。

优化：把模型窗口、预留输出、工具声明、当前用户原文、状态块、必要技能和累计工具结果统一计入预算；优先分页读取与压缩旧结果，保住当前要求和未完成任务。不能只给 `max_context_chars` 赋值，因为已有过长历史仍需在首次模型调用前处理。预算不足时给模型明确的剩余范围，避免把工具消失解释成任务完成。

验收：较小窗口模型、多次大结果、技能恢复、图片回执及长用户要求的组合输入均不超预算；持久化历史保持原样，裁剪只改变本次模型输入。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/services/advance_service.py:234-261,373-380`；`server/domain/llmcore/src/llmcore/turn/loop.py:125-135,475-495`；`server/domain/llmcore/src/llmcore/memory/history.py:182-215`；`server/domain/llmcore/src/llmcore/guard.py:100-141`。

### P2：联动技能错误描述了当前预览能力

技能说“编辑画布与预览都不跑联动引擎”，要求保存后打开查看页验收。当前 `EditorPreview.vue` 已调用 `usePreviewInteraction()`，它从草稿节点和规则初始化联动引擎，支持预览中的普通交互；只有跨屏跳转在预览中显示提示而不跳走。

影响：助手会把已经存在的预览能力说成不支持，要求用户进行不必要的保存与切页。

优化：分别写清设计画布、全屏预览、正式查看页三种状态。普通显隐、互斥切换、弹窗可在预览核验；跨屏跳转再到查看页核验。助手当前截图工具是否能主动打开预览或触发交互，应由工具实际能力决定，不能仅因页面有预览就宣称助手已经验证。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/skills/library/dashboard-interact/SKILL.md:30-38`；`web/app/src/pages/DashboardEditor/components/EditorPreview.vue:46`；`web/app/src/pages/DashboardEditor/scripts/usePreviewInteraction.ts:52-80`。

### P2：dashboard.set_visible 的追加说明与实际副作用相反

原工具声明正确地说它修改节点初始显隐，浏览器实现也通过 `editor.apply()` 修改可撤销草稿。可是 `guides.py` 追加“运行态显隐结果；不更改持久化配置”“更改运行态显隐”。同一次工具声明中同时出现两套相反口径，`tools.describe` 也会重复错误口径。

优化：统一为“修改当前草稿的节点初始显隐，可撤销，保存后影响运行页初始状态”；联动触发时的临时显隐另行说明。输出与副作用从一个权威元数据来源生成，增加语义契约检查。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/services/tools/guides.py:152,220,255-262`；`server/services/ai-assistant/src/ai_assistant/apps/chat/services/tools/providers/client_specs/interaction.py:101-122`；`web/app/src/pages/DashboardEditor/scripts/aiSurfaceInteraction.ts:147-163`；`web/app/src/pages/DashboardEditor/scripts/editorActions.ts:189-190`。

### P2：同一次服务端循环内，最新计划与状态块可能不同步

系统提示词要求以最后的 `<当前状态>` 为准。状态块在一次 `advance` 起始时组装，`plan.write` 更新数据库与前端事件，但回合内下一次模型调用仍沿用原消息列表中的旧状态块。工具结果仅返回 `ok/state/done/total`，并不返回 `tools.describe` 承诺的“规范化后的完整计划及各项状态”。

确定的是状态块与输出契约不一致；尚未实测模型因此重复执行。风险在于计划规范化（例如多项 `in_progress` 被改为 `pending`）后，模型未收到完整真实结果，而旧状态又被宣称最高时效。

优化：`plan.write` 返回规范化完整计划，或模型输入投影在每次调用前从 `plans.latest` 刷新状态块；当前回合新增回执比起始快照更新的优先级必须写清。不要把新的状态块永久追加进数据库历史。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/services/memory/prompt.py:59-63`；`server/services/ai-assistant/src/ai_assistant/apps/chat/services/advance_service.py:254-261,373-392`；`server/services/ai-assistant/src/ai_assistant/apps/chat/services/planning/plan.py:224-233`；`server/services/ai-assistant/src/ai_assistant/apps/chat/services/tools/guides.py:23-25`。

### P2：旧配置指引仍描述已经被校验器拦下的行为

`dashboard-compose` 多处称不存在的键、子编辑器字段写入“不会报错但不生效”。当前 `checkedConfigPatch()` 对未知字段、由子编辑器接管的字段会直接拒绝。数组参考资料前半说“删中间项后绑定会错位”，后半又写“会错位时工具拒绝”；实际删除路径先调用 `assertConfigRemovalSafe()` 再写入。

优化：删除过时解释，统一为“先读当前声明，非法字段写入前拒绝；删除影响绑定身份时先说明影响并按确认范围处理”。同时清理相邻的工具长描述。不要给模型两套事故恢复路线。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/skills/library/dashboard-compose/SKILL.md:38-60`；`server/services/ai-assistant/src/ai_assistant/apps/chat/skills/library/dashboard-compose/references/config-items.md:21-32`；`web/app/src/features/ai/configValidation.ts:160-182`；`web/app/src/pages/DashboardEditor/scripts/aiSurfaceConfig.ts:175-204`。

### P2：实时绑定收尾的措辞比证据更确定

绑定技能要求对 `waiting` 告诉用户“订上了还没来第一帧，过一会儿就有”。但当前值报告在缓存没有样本时就返回 `waiting`；仅凭缓存为空无法区分订阅未建立、源未产数、首帧未到等原因。即使订阅已确认，也不能保证之后一定有值。

优化：收尾应表达“已保存，尚未读到有效值，实时验收未完成”；用有上限的等待/复读机制取得第一帧，仍无值则返回数据源与订阅诊断。保存、订阅确认、有值、质量合格应是独立证据，不让提示词用一句“过一会儿就有”补齐证据。前端专项应继续核对连接状态与 quality 是否进入工具回执。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/skills/library/dashboard-binding/SKILL.md:59-69,108-113`；`web/app/src/features/ai/valueReport.ts:103,124-144`；`web/app/src/runtime/bindingReader.ts:24-25`。

### P3：无技能时的能力描述与实际下发工具不一致

没有匹配技能时系统提示词说“只能解读与回答问题”，但工具选择器仍提供跨模块读取、记忆和计划等工具。离线调用 `specs_for('collect-source',['user.ask'],skills=())` 仍得到 17 个工具。

优化：改成“本页没有专用编辑技能；可使用本轮列出的读取工具，不能推断具有页面写入能力”。描述应由实际可用能力生成，避免把没有技能误当成没有工具。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/services/memory/prompt.py:69,107-108`；`server/services/ai-assistant/src/ai_assistant/apps/chat/services/intent/select.py:52-76,105-125`。

### P3：保存授权、提问条件与公共规则需要去冲突

常驻规则只给实时绑定主动保存例外；三维技能又允许用户明确要求时 `dashboard.save`。该工具实际也可用。应把“用户明确要求保存”与“助手为了完成实时绑定主动保存”分别列出，和 ADR-0023 的保存边界保持一致。

组态技能要求新增配置项后必问来源；实际上用户可能已指定来源，常驻规则又要求能查清的不问。联动技能要求每次删除必经 `user.ask`，常驻规则却允许已授权的范围继续。重复确认会拖慢任务，也使模型不易判断哪些授权能持续。

优化：把共同规则只保留在常驻约束中，技能只说明例外条件；已明确授权且范围清楚时直接执行，未知身份/歧义/超范围时才提问。调整保存政策若超出当前 ADR，先作产品决定并同步文档，不静默放宽。

依据：`server/services/ai-assistant/src/ai_assistant/apps/chat/services/memory/prompt.py:32-42`；`server/services/ai-assistant/src/ai_assistant/apps/chat/skills/library/twin-configure/SKILL.md:22-23`；`server/services/ai-assistant/src/ai_assistant/apps/chat/skills/library/dashboard-compose/references/config-items.md:18-19`；`server/services/ai-assistant/src/ai_assistant/apps/chat/skills/library/dashboard-interact/SKILL.md:37-38`；`docs/adr/0023-助手改画布的工具在浏览器里执行.md:8-12`。

## 提示词的建议组织方式

保留四层，并减少重复：

1. 常驻规则：范围、授权、真实回执、未知执行结果不重复写、资料不改变权限。只写所有工作面成立的规则。
2. 当前能力：由本轮工具集合生成可做事项、不可执行原因、是否具备截图/保存/提议能力。没有视觉模型时不能仍硬要求截图闭环。
3. 技能：目标定位、读取、修改、验收，使用统一模板；具体字段与专项参数留在 references。共用技能显式分工作面。
4. 任务状态：目标名单、已完成与未验证对象、用户已确认范围、最新回执、剩余计划。不要把只剩的截断片段当全集。

建议验收短句：

> 仅报告工具回执能证明的状态。分别说明草稿修改、保存、订阅确认和有效读数；未完成的检查保留为未验证。读取返回分页或截断信息时继续读取或明确本次覆盖范围。

这不是直接替换整份系统提示词的补丁。应先修正工具元数据与状态契约，再用任务评测验证措辞。

## 建议的任务级评测

现有单元与契约测试应继续保留，另外固定一组脱敏场景，比较当前版和优化版的完整轨迹：

| 场景 | 关键验收 |
| --- | --- |
| 20 台设备按名称批量绑点 | 身份全遍历、候选核对、范围不扩大、保存与有效读数分开统计 |
| 相同前缀的第 201 个点位 | 详情必须精确定位，不把第一页遗漏说成不存在 |
| 断网后读取已有点值 | 不把缓存值宣称为当前在线有效值 |
| 修改外观与普通联动 | 正确说明草稿、预览能力与撤销边界 |
| 长回合、连续大工具结果 | 不超窗，仍保留用户要求、技能约束与待办 |
| 参数错误、写操作超时、取消后续回执 | 修参可恢复，执行结果未知不重复写，已执行结果仍可追溯 |
| 报告模板试算、台账公式提议 | 不把试算或提议说成已保存/已生成 |
| 用户已授权删除、用户只要求分析 | 前者不重复追问，后者不写入 |

度量建议：任务成功率、错误修改率、漏对象率、无效工具调用数、重复确认数、模型调用数、总输入/输出 token、首个有效动作时间、全部完成时间。需要任务证据时再调用真实模型；本轮未运行这些计费评测。

## 本地运行、后端工具和前端专项待验证

尚未完成运行容器与工作区一致性、实际启用配置、工具逐项矩阵、后端精确读取/知识片段/长期记忆、前端回执和本地页面的专项核验。本报告不提供部署或业务写入验收结论。

## 建议实施顺序

1. 先修已确认的业务事实错误和工具契约错误：精确对象读取、数据完整性/状态、元数据副作用、过期技能说明。
2. 接通总上下文预算及计划状态刷新，建立长回合回归用例。
3. 用固定真实任务基线评估工具声明精简、分组披露、批处理和有界等待。
4. 功能扩展另列需求，不把没有实现的能力写进提示词或技能来冒充已经支持。
