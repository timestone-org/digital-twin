# AI 助手 V4 规划：七层能力分层，与四项能力补齐

本期把助手从「25 个模块平铺在 `services/` 里」整理成**七层能力分层**，每层一个
显式注册表；并补上长期记忆、摘要压缩、用户贴图、MCP 四项能力。

## 0. 这份规划解决什么、不解决什么

**解决**：横向扩展没有落脚点。今天加一路模型来源要改 `provider.py` 的函数体，
加一种附件格式要改 `tables.py` 的 `if` 链，加一个服务端工具要同时动规格、
handler、技能清单三处——每一处都是「漏了不报错、只表现为模型调一次失败一次」。

**不解决，且明确不动**：

- **回合形态**。单模型 + 计划工具，不建 planner/executor 双层（[ADR-0024](adr/0024-助手计划执行循环用单模型加计划工具.md)）。
  那条 ADR 的四条理由里，「回合边界零侵入」「计划渲染进提示词而不是每步现拼」
  「自动续推放前端」三条与模型能力无关，至今成立。
- **工具在浏览器里执行**（[ADR-0023](adr/0023-助手改画布的工具在浏览器里执行.md)）。
- **上下文按缓存稳定性分四层**（[ADR-0025](adr/0025-助手上下文按缓存稳定性分四层.md)）。
  本期每一项新能力都要证明自己**不引入第五个前缀断点**，由既有的
  `tests/contract/test_prompt_prefix.py` 守着。

⚠ **七层是能力分层，不是执行流水线。** 把它做成 `层1 → 层2 → … → 层7` 的物理管道，
会与真实控制流（`think ⇄ use_tools` 的环，中间还跨网络挂起）正面冲突。分层的落法
见 [ADR-0029](adr/0029-助手按能力分层且每层一个注册表.md)。

## 1. 七层落在哪

```
apps/chat/
  api/                  ← HTTP/SSE 边缘，不变
  crud/  models/  schemas/   ← 不变
  services/             ← 跨功能 import 的必经段（check_feature_modules_use_public_face）
    __init__.py         ← 只做再导出，其余包一律经它对外
    perception/         ← 层 1 感知输入
    intent/             ← 层 2 意图理解
    planning/           ← 层 3 规划编排
    memory/             ← 层 4 记忆
    tools/              ← 层 5 执行与工具
    reflection/         ← 层 6 反思反馈
    output/             ← 层 7 输出
  skills/               ← 不动（技能已是一个目录 + 显式注册元组）
llm/                    ← 模型接入，重整成适配器 + 注册表
```

**为什么七层长在 `services/` 之内而不是与它平级**：结构闸
`check_feature_modules_use_public_face` 的判据是「跨功能 import 的路径第 4 段必须是
`services`」（`_reaches_inside`，段之下不限深度）。所以
`…apps.chat.services.memory.ports` 机械满足，而与它平级的 `…apps.chat.memory.ports`
当场被拦。CLAUDE.md 又规定功能内是 `api → services → crud → models` 四层——
放里面两条都满足，放外面两条都违。

⚠ 闸只管到「第 4 段是不是 `services`」，**不强制经过 `services/__init__.py`**。
所以「跨功能只认再导出面」是本仓自己加的一条约定，要靠评审与文档守，闸兜不住。

每个层包同一副骨架：

```
<layer>/
  __init__.py      # 只导出这一层对外的那几个名字
  ports.py         # Protocol：这一层的扩展点长什么样
  registry.py      # 显式注册元组 + 按名字取
  <impls>/         # 一个实现一个文件
```

⚠ **注册一律是显式元组，不靠 import 副作用。** 与 `skills/__init__.py` 同一口径：
隐式注册会让「装了哪些实现」取决于 import 顺序，而顺序在测试里与生产里可以不同。

## 2. 逐层的扩展点

### 2.1 层 1 · 感知输入 `services/perception/`

**现状**：附件解析 `tables.py`（200 行 × 30 列 × 单元格 120 字，纯文本 24k，
截断如实说）、截图 `vision.py`（图只活一轮）、环境快照 `surface_context.py`。

**扩展点**：

```python
class InputDecoder(Protocol):
    """一种输入的解码器。加一种格式 = 加一个文件 + 注册表一行。"""
    name: str
    suffixes: tuple[str, ...]
    media_types: tuple[str, ...]

    def decode(self, raw: bytes, filename: str) -> Decoded: ...
```

`decoders/{table,text,image}.py`。`Decoded` 分两态：`AsText`（进对话正文）与
`AsImage`（进视觉档的图片块）——两态的差别决定这一轮走哪一档模型。

⚠ **accept 名单收成一份**。今天前端 `features/ai/attachment.ts:17` 写死一份、
后端 `tables.py::_TEXT_SUFFIXES` 又写一份，两份漂开的表现是「选得中的文件传上去被拒」。
改成由 `/capabilities` 下发注册表算出来的那一份，前端不再写死。

### 2.2 层 2 · 意图理解 `services/intent/`

**这一层只做归位，不新增运行时步骤。**

理由：意图由主模型在同一次调用里定，而多插一次分类调用会打断前缀缓存——
那正是 ADR-0025 花一整轮修的东西（静态区 11 812 字符，断点曾落在第 789）。
「识别约束条件」这件事今天**只有一道**机械过滤在做：工作面过滤
`tool_select.specs_for(surface_kind, client_tools)`。

⚠ **本该有的第二道并不存在。** `SkillManifest.required_codes` 在五个技能上都声明了，
但服务端从不校验（`skills_for` 只按 `surface_kind` 过滤），前端也没有一个消费者——
它和 `is_vision_enabled` 一样是个死信号。不是安全漏洞（工具最终调 platform，
由那边按端点判权限，CONTEXT.md §2），但代价是实的：模型会看见它这个账号根本用不了的
技能，先试一次、被 platform 拒、再换路。

**扩展点**：把过滤收成命名接缝，并把缺的那一道补上。

```python
class Gate(Protocol):
    """收窄这一轮模型看得见的东西。多道 Gate 按注册序依次收窄。"""
    def narrow(self, ctx: TurnContext, allowed: Allowed) -> Allowed: ...
```

**本期在这一层新增唯一一道 Gate**：`PermissionGate` 按调用者的权限码收窄技能集，
让 `required_codes` 从死信号变成真过滤。再往后要加「这张屏是只读的」「这个角色不许
删画布节点」，有地方放。

### 2.3 层 3 · 规划编排 `services/planning/`

**不动。** `plan.py` 与 `turn.py` 平移进来，图仍是 `think ⇄ use_tools` 两节点。

唯一的接缝：把「计划纪律」从提示词常量里抽成 `PlanPolicy`，让「多少步以上要立计划」
「续推几次」这类阈值可配。⚠ 阈值只能是**取值**不能是**行为**（config-and-secrets §6）。

### 2.4 层 4 · 记忆 `services/memory/`

```python
class ShortTermStore(Protocol):        # 现 history.py
    def window(self, rows, limit, step) -> list[ChatMessage]: ...

class Summarizer(Protocol):            # 本期新建，见 §4.1
    async def fold(self, dropped: list[ChatMessage]) -> Summary | None: ...

class LongTermStore(Protocol):         # 本期新建，见 §4.3
    async def remember(self, item: Knowledge) -> str: ...
    async def search(self, query: str, scope: Scope, limit: int) -> list[Hit]: ...
```

三个 Protocol 各自默认装一个 `Null*` 实现——**装不上就如实缺席**，与前端那套
ports 范式同一口径。

### 2.5 层 5 · 执行与工具 `services/tools/`

**现状的问题**：一个工具的**规格**（`TOOL_SPECS`）与**实现**（`server_tools._handlers()`）
分住两处，技能清单里还有第三处名字。漏一处不报错，表现是「模型看得见、调一次失败一次」，
而那与「这一页没实现它」长得一模一样。

**扩展点**：把规格与实现收成同一个对象。

```python
class ToolProvider(Protocol):
    """一批工具的来源。加一个来源 = 加一个文件 + 注册表一行。"""
    name: str
    def specs(self) -> tuple[ToolSpec, ...]: ...
    async def run(self, name: str, arguments: dict[str, Any]) -> Any: ...
```

`providers/`：

| provider | 装什么 | 在哪跑 |
|---|---|---|
| `server.py` | 现 `server_tools.py` 那 14 个 | ai-assistant 进程 |
| `client.py` | 现三份 `client_tool_specs*.py` | 浏览器（只有规格，`run` 恒抛） |
| `mcp.py` | 外部 MCP server（§4.4） | ai-assistant 进程 |

⚠ `client.py` 的 `run` 必须**抛**而不是静默成功：客户端工具在服务端压根没有实现，
静默成功会让模型以为改好了、接着往下走，最后给用户一个「已完成」而画面纹丝不动。

### 2.6 层 6 · 反思反馈 `services/reflection/`

**现状**：基础设施侧已经很硬——断路器 + 失败分档（`_OUR_FAULT` 三类绝不开断路）、
三处 `max_retries=0`（一条链路只有一层重试）、工具失败必回执、`history.fillers`
给没等到回执的调用补失败回执。语义侧则散在三处：提示词纪律（截图自检）、
`dashboard.validate`、`formula.validate`。

**扩展点**：

```python
class Verifier(Protocol):
    """一步做完之后，回答「这一步成没成」。"""
    def applies(self, step: TurnStep) -> bool: ...
    async def check(self, step: TurnStep) -> Verdict: ...   # ok / warn / failed + 一句人话
```

⚠ **本期只做接缝与归位，不新增运行时环节。** 每加一次真实检验就多一次模型往返，
而现有三样已经覆盖了最要紧的场景。先把它们归位，让第四样有地方加。

HITL 同样归位：`user.ask`（内建客户端工具）与「台账/采集页只提议不写入」是同一件事
的两种形态，收进 `reflection/hitl.py` 说清边界。

### 2.7 层 7 · 输出 `services/output/`

**现状几乎没缺口**：SSE 闭合事件集 6 档、`step_preview` 给人看的一份与喂模型的一份
刻意不同口径、`DtMarkdown.vue` 零 `v-html`（渲染不可信文字安全）。

**唯一的缺口**：扩一档事件要同步四处（`events.py`、`api/advance.py` 分帧、
`contracts/assistant.ts`、`turnRunner.ts`）。收成声明式一条：

```python
@dataclass(frozen=True)
class EventSpec:
    name: str
    payload: type          # pydantic 模型，前端类型由它生成
```

四处同步降成一处 + 一条契约测试。

## 3. 模型接入：适配器，与两个已确认的缺陷

### 3.1 今天分到了哪一步

「视觉与语言分开」**已经分了一半**：分的是「档」，没分的是「源」。

| 分了 | 在哪 |
|---|---|
| 两档类型 | `llm/provider.py:21` `ModelKind = Literal["chat","vision"]` |
| 路由 | `advance_service.py:301` 只有带图那一轮走视觉档 |
| 模型名 | `settings.model_chat` / `settings.model_vision` |

没分的在 `build_model_source()` 同一个函数里——`base_url`、`api_key`、`timeout`、
`extra_body` **对两档是同一份**，只有 `model` 一格按档取。所以「对话走一家、看图走
另一家」今天做不到；而且两格默认值都是 `qwen3.8-max`，物理上就是同一个模型。

### 3.2 两个缺陷

**缺陷一：断路器按 `profile` 分，不按 `kind` 分。**
`guard.py:81` 是 `self._breaker_of(choice.profile)`，`container.py:93-94` 只建了
`default` 与 `codex` 两个。今天两档共用端点时看不出来；**一旦把视觉分到另一家，
视觉端点连挂 5 次会把同一路的对话一起短路掉**——用户看到的是「助手整个不能说话了」。

**缺陷二：订阅账号那一路会把图喂给一个自报不接图的模型。**
`registry.py:110` 的 codex 分支完全不看 `choice.kind`，而它自己在 `registry.py:75`
声明 `has_vision=False`。`dashboard.capture` 是页面自报的工具，`tool_select` 不按档位
过滤，所以图照样发出去。

顺带：`is_vision_enabled` 服务端算了、契约里声明了、**全仓没有一个消费者**。

### 3.3 目标形状

```
llm/
  ports.py            # ModelAdapter / EmbeddingAdapter 两个 Protocol
  registry.py         # 按 (profile, kind) 取一路
  adapters/
    __init__.py       # ADAPTERS = (OPENAI_COMPAT, CODEX_OAUTH)  ← 加一路 = 加一行
    openai_compat.py
    codex_oauth.py
  guard.py            # 断路器键从 profile 改成 (profile, kind)
```

```python
class ModelAdapter(Protocol):
    id: str
    def supports(self, kind: ModelKind) -> bool: ...
    async def build(self, choice: ModelChoice) -> BaseChatModel: ...
    def profile(self) -> ModelProfile: ...     # 能力面如实报，含 has_vision
```

`ModelChoice` 形状不变（已经是 `(kind, profile, effort)`）。调用方（`turn.py`、
`advance_service.py`）**一个字都不用改**——这正是先立接缝的理由。

⚠ codex 适配器的 `supports("vision")` 返回 `False`，`registry.resolve` 在取不到时
**如实拒绝**（回一句「这一路不接图，换按量档或别截图」），不再静默发出去。

### 3.4 配置形态分两步

- **本期**：视觉档独立一组扁平配置
  `ASSISTANT_VISION_{BASE_URL,API_KEY,MODEL,TIMEOUT_S,EXTRA_BODY}`，
  **每一格缺省显式回落到对话档那一格**，回落链写全、启动即全量校验。
- **等真出现第三路来源**再换成模型清单式配置。接口立住了，换配置形态不动调用方。

⚠ 密钥类**绝不给默认值**，也不回落——弱默认的密钥等于没有密钥。视觉档没配自己的
密钥时，回落的是「用对话档那一把」，而不是「用一个空串」。

## 4. 四项新能力

### 4.1 摘要压缩（层 4）

**问题**：`history.window` 把窗口外的消息**直接丢**。一个跑了几十轮的会话，
最早那几十条里的结论（查到的点位、定下的口径）就此消失，模型会重新查一遍。

**设计**：窗口外的那一截折叠成一条摘要消息，插在历史区**最前面**。

⚠ **它必须与 C 层同频，否则就是第五个前缀断点。** 做法是把摘要**锚在同一个台阶上**：

- 摘要覆盖区间 `[0, drop)`，而 `drop` 已经是 `HISTORY_DROP_STEP` 的整数倍。
- 摘要**落库**（`chat_sessions.summary_json`，可空 JSONB，扩展步），
  存 `{through_seq, text, model, created_at}`。
- 只有 `drop` 跨过下一个台阶时才重新生成一次，其余轮次逐字复用。
  于是摘要与历史窗口一起、每 10 条才变一次。

**装上下文的顺序**：`A 常驻 → B 工作面 → [摘要] → C 历史窗口 → D 状态块`。
摘要在 C 层头部、与 C 同频，四层结构不变。

⚠ 生成失败**退回今天的行为**（直接丢），不阻塞回合——fail-open，与模型不可用时
同一口径。
⚠ 摘要用哪一档模型：`ModelKind` 新增 `summary` 档，缺省回落 `chat`。这是 §3 的
适配器立起来之后白拿的一格。

**验收**：`test_prompt_prefix.py` 保持绿（断点仍只出现在 D 层）；新增一条断言
「同一个台阶内的相邻两轮，摘要段逐字相同」。

### 4.2 用户贴图（层 1）

**设计**：图不走 `attachments:parse`（那条是解析成文本），由 `ImageDecoder` 判成
`AsImage`，直接作为图片块附在用户消息上。`advance_service.has_image()` 已经会把
这一轮切到视觉档——**复用已验证的链路，零新机制**。

⚠ **MIME 白名单只收 `png/jpeg/webp`，明确拒 `svg`。** svg 可以内嵌脚本，而前端
要给用户看一张缩略图——那是一条真实的 XSS 路径。这一条写在解码器里，不是写在前端。
⚠ 尺寸上限沿用 `MAX_IMAGE_CHARS = 4_000_000`，超了当场拒并说清。
⚠ **本期与截图同口径：图只活当轮，落库存占位。** 跨轮引用（「照着我刚发那张图」）
要把图落对象存储、会话里存 `asset:id`，那是 `InputDecoder` 之上的第二个实现，
留到真有人要时再做——它会引入对 platform 素材面的新依赖。

**验收**：贴一张 png 走视觉档、贴一个 svg 被拒、贴超限被拒、第二轮里那张图是占位。

### 4.3 长期记忆（层 4）

⚠ 这一项**推翻了 CONTEXT.md §5 一条已记录的决定**（「知识块表不建」），
故单独立 [ADR-0030](adr/0030-助手建长期记忆的知识块表.md)，并同步改 CONTEXT.md。

**为什么现在可以建**：当初不建的理由是「空着的表比不存在的表更容易被误用」。
本期给它配了**明确的写入来源**——不是爬别人的数据，而是两个显式工具：

| 工具 | 干什么 |
|---|---|
| `memory.remember` | 用户说「记住：本项目 1 号机组指的是…」时写一条 |
| `memory.search` | 动手前先查一次本项目的既有约定 |

表一定不空，语义也清楚。

**选型：不依赖 pgvector。**
库是**外部托管**的（`docker/compose.yml` 里没有 postgres），且一库多 schema——
装扩展是运维请求，影响同一个库里的每一个服务。本期：

- 嵌入向量存 `bytea`（float32 紧凑编码），检索在应用层做余弦。
- 显式 remember 出来的条目量级是几百到几千条，应用层扫得动。
- 量级或延迟超阈值时换 pgvector 实现——**换的是一个实现文件 + 一次迁移，
  调用方不动**。这正是 `LongTermStore` 这个 port 买到的东西。

**表**：`assistant.knowledge_chunks`（扩展步、加列可空、开头设 `lock_timeout`、
索引 `CONCURRENTLY`、迁移里不回填）。

⚠ **隔离**：条目带 `scope`（`user` / `project`）与 `owner_id`，检索按调用者身份过滤。
助手是纯消费方、代表用户行事——它绝不能让 A 用户 remember 的东西被 B 检索到。
这条由一条集成用例守。

⚠ 嵌入模型是**第三路模型来源**，走 `EmbeddingAdapter`（§3.3），不复用对话档。

⚠ 嵌入调用失败时 `remember` **仍然写入**（存文本、标「没有向量」、回执如实说这条
暂时检索不到），补救走**下一次 `search` 惰性补算**——不另建关键词检索路径，
两条召回路径迟早给出不同结果。

**验收**：两个身份各 remember 一条、互相检索为空（集成用例）；嵌入档没配时
`remember` 仍可用且回执说得清；无向量条目在下一次 `search` 被补算后能召回。

### 4.4 MCP（层 5）

⚠ 单独立 [ADR-0031](adr/0031-MCP工具只接HTTP传输且默认只读.md)，两条边界：

**一、只接 HTTP/SSE 传输的 MCP server，不接 stdio。**
stdio 要求每个副本起一个子进程，而 api 角色无状态且要能水平扩；子进程的生命周期、
崩溃恢复、优雅关停都得重新回答一遍。HTTP 传输则与 `upstream/platform.py` 那条
已有的出站链路同构（超时、断路、`traceparent` 传播全都现成）。

**二、MCP 工具默认只读，写操作要显式白名单 + `user.ask` 确认。**
MCP server 是外部代码，**它的工具描述会进提示词**——那是一条提示词注入面。
工具描述一律当**数据**看，不当指令；且没进白名单的写操作一律不下发。

**其余约束**：

- 工具名加前缀 `mcp__<server>__<tool>`。⚠ 不能用点号：Codex 那一路的线名有约束
  （`llm/codex/wire_names.py`），MCP 工具名要过同一道转换。
- 每个 MCP server 一个断路器，与模型那套同构。
- server 清单从配置来（`ASSISTANT_MCP_SERVERS`，JSON 列表）。密钥不进 URL。
- **装不上就如实缺席**：某个 server 连不上时，它的工具这一轮不下发，其余照常。

**验收**：一个 server 连不上时其余工具照常下发；没进白名单的写工具**不出现在**
下发集合里（不是下发了再拦）；工具名过 `wire_names` 转换后在订阅账号档也调得动。

## 5. 分期与 PR 切法

⚠ 全期总量远超 400 行的规模闸。切法的原则是**把机械移动与行为改动分开**——
前者用标题里的 `[机械]` 走规模豁免（`check_pr_policy.MECHANICAL`），后者笔笔都小。

| 期 | 做什么 | 规模闸 |
|---|---|---|
| P0 | 七个层包骨架 + `ports.py`，无任何行为改动 | 正常 |
| P1 | 现有 25 个模块按层归位（纯移动 + 改 import） | `[机械]` 豁免 |
| P2 | 模型适配器 + 视觉源分离 + 修 §3.2 两个缺陷 | 正常 |
| P3 | `InputDecoder` 注册表 + accept 名单收成一份 | 正常 |
| P4 | 用户贴图（含 svg 拒收与尺寸闸） | 正常 |
| P5 | `Summarizer` + 摘要压缩（含 `summary_json` 迁移） | 正常 |
| P6 | `ToolProvider` 收拢规格与实现 | 正常 |
| P7 | `LongTermStore` + 知识块表 + 两个记忆工具 | 迁移单独一 PR |
| P8 | MCP provider | 正常 |
| P9 | `Verifier` 归位 + `EventSpec` 收拢 + `PermissionGate`（补上缺的那道过滤） | 正常 |

**顺序不能换的两处**：P1 必须在 P0 之后（骨架先在，才有地方归位）；P2 必须在 P5、
P7 之前（摘要档与嵌入档都是它立起来之后白拿的）。

## 6. 每期的验收与回退

- 每期都要过 `scripts/ci-local.sh --fast` 与全量用例。
- **P5、P7 额外要过 `test_prompt_prefix.py`**——它们是本期唯二可能引入第五个前缀
  断点的改动。
- 迁移一律只做扩展步：加列可空、不回填、索引 `CONCURRENTLY`、开头设 `lock_timeout`。
  「新结构 + 旧代码」必须可用。
- 每期的回退都是 revert 那一个 PR；P7 的表留着不删（删表是收缩步，另起一次发布）。

## 7. 本期仍不做

- **planner/executor 双层**（ADR-0024 的四条理由至今成立）。
- **图跨轮引用**（要引入对 platform 素材面的新依赖，§4.2）。
- **语音输入**。`InputDecoder` 的 port 能装下它，但没有实现——本仓没有任何一处
  需要它的场景，而一个没人用的解码器会在第一次改动时被顺手改坏。
- **自动往长期记忆里写**（爬大屏/台账的描述文本）。助手是纯消费方，去爬别人的
  数据会把「谁是这份数据的属主」搅浑；显式 remember 已经够用。
