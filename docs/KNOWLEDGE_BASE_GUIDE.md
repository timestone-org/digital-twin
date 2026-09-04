# 知识库：完整说明

一份把知识库**从项目坐标讲到运行逻辑**的通读文档：它在这个仓的什么位置、
一份文档从上传到能被问出来中间经过了什么、每一段的判据与失败面是什么、
配错了会以什么形态表现出来。

三份既有文档各管一段，本文是把它们串起来的那一份：

| 文档 | 管什么 | 与本文的关系 |
|---|---|---|
| [KNOWLEDGE_BASE_DESIGN.md](KNOWLEDGE_BASE_DESIGN.md) | 为什么这么设计（支柱、七层、扩展点） | 本文第 8 章是它的索引 |
| [KNOWLEDGE_CHAT_DESIGN.md](KNOWLEDGE_CHAT_DESIGN.md) | 对话页的设计口径 | 本文第 6 章是它的流程展开 |
| [KNOWLEDGE_QUALITY_PLAN.md](KNOWLEDGE_QUALITY_PLAN.md) | 效果专项 P0–P7 的实施过程与实测数据 | 本文第 4、7、13 章的「实测」二字出自这里 |
| [`server/services/knowledge-server/CONTEXT.md`](../server/services/knowledge-server/CONTEXT.md) | 通用语言、边界、11 条不变式 | 本文第 2 章复述术语，不变式散在各章 |

⚠ 遇到冲突时，**代码是真源**，其次是各服务的 `CONTEXT.md`，再次是本文。
本文里凡是「实测」二字，出处都是 `KNOWLEDGE_QUALITY_PLAN.md` §0 与 §P0–P2。

---

## 0. 一页看懂

知识库是**来源驱动**的检索底座：它不是「文档库」，是「知识来源库」。
文档上传只是其中一路来源，外部系统（台账、工单、ERP）是并列的另一路，
**加一路来源不改任何调用方**。

它对外提供四件事：

1. **建库、传资料**——资料在后台被解析、切块、算向量、建索引，状态在界面上看得见。
2. **检索**——向量与关键词两路并行召回，按名次融合，接了重排档再排一次。
3. **问答与对话**——`:ask` 给不要对话的调用方；`/knowledge/chat` 给人，
   模型自己决定检索几次、去哪几个库找，答案里每句结论挂角标指回原文与插图。
4. **给 AI 助手当工具**——助手多一路只读工具（列库 / 检索 / 看整块），
   身份原样转发，助手检索不到用户本来检索不到的库。

四条铁律贯穿全文，其余细节都是它们的推论：

- **状态落库不落内存**——worker 可重启、可多副本，界面上必须看得见「它卡在哪一步」。
- **不许静默给空**——「传上去了、状态 ready、检索却查不到」与「这份文档里确实没这句话」
  长得一模一样，那是最难查的一类故障。
- **不自动重试**——一条链路只有一层负责重试，而这条链上那一层是人按的那一下。
- **降级必须说出来**——退化了不吭声，表现是「质量忽然变差了」，而没有任何一处报错。

---

## 1. 项目坐标

### 1.1 它在这个仓的什么位置

| | |
|---|---|
| 代码单元 | `server/services/knowledge-server/` |
| 部署单元 | `knowledge-server`（`ROLE=api`）、`knowledge-worker`（`ROLE=worker`）、一次性作业 `knowledge-migrate`；可选 `mineru` profile |
| HTTP 端口 | `8009`（`expose`，不映射到宿主，只经边缘网关） |
| 数据库 schema | `knowledge`，表前缀 `kb_` |
| 对外前缀 | `/api/v1/knowledge`；内部面 `/internal/v1/knowledge` |
| 对象存储前缀 | `knowledge/{base_id}/{document_id}/…`，**不匿名可读** |
| 前端 | `web/app/src/pages/Knowledge/`（管理页）、`web/app/src/pages/KnowledgeChat/`（对话页） |
| 路由 | `/knowledge`、`/knowledge/chat`，两条都只挂读码 `knowledge:use` |
| 权限码 | `knowledge:use` / `knowledge:write` / `knowledge:manage` |
| 错误码领域号 | 23（库与文档 `42301–42310`、对话 `42320+`、语音 `42340+`） |

⚠ **代码单元 ≠ 部署单元**：一份镜像按 `KNOWLEDGE_APP_ROLE` 跑出两种进程，
不为 worker 另建一个服务目录（ADR-0002）。两个角色**共用同一份 `Settings`**，
所以对象存储那四项每个角色都要给全，哪怕 api 角色一个字节都不读——启动即全量校验，
少给一处就是这个角色起不来，而现象是「检索面好好的，传上去的文档一直不动」。

### 1.2 目录结构

```
server/services/knowledge-server/
├── src/knowledge_server/
│   ├── app.py                 # api 角色的 FastAPI 装配、启停钩子、就绪探针
│   ├── worker.py              # worker 角色的进程装配与关停编排
│   ├── container.py           # 一个进程一份的长生命周期对象（库、缓存、目录、模型档）
│   ├── settings.py            # 全部环境变量与启动即校验
│   ├── catalog.py             # 模型目录缓存（从 platform 内部面拉）
│   ├── llm_adapters.py        # 对话档按「接入形态」装配（端点 / 订阅账号）
│   ├── llm_purposes.py        # 三个用途码，与 platform 逐字一致
│   ├── schema.py              # 启动时读一次库上向量列的真实维数
│   └── apps/
│       ├── knowledge/         # 库、来源、文档、块、图、检索
│       │   ├── api/           # bases / documents / sources / search / capabilities
│       │   ├── crud/  models/  schemas/
│       │   └── services/
│       │       ├── sources/     parsing/    chunking/
│       │       ├── embedding/   indexing/   retrieval/   reranking/     ← 七层
│       │       ├── ingest_pipeline.py  ingest_worker.py  ingest_queue.py
│       │       ├── ingest_figures.py   document_service.py  sync_service.py
│       │       ├── assembly.py  capability.py  search_service.py
│       ├── chat/              # 对话：会话、回合、工具、引用、标题
│       └── speech/            # 语音输入：到 FunASR 的 WebSocket 中继
├── migrations/versions/       # 7 份 alembic 迁移
└── tests/                     # unit / contract / integration，585 条
```

依赖方向恒为 `services → domain → lib`：本服务用 `server/domain/llmcore/`
（对话引擎、工具注册表、记忆窗口、事件帧），用 `server/lib/`
（配置、日志、异常、响应信封、DB、缓存、对象存储、Redis Stream）。
**不 import 任何别的服务**，也不被 ai-assistant 之外的服务调用。

### 1.3 外部依赖清单

| 依赖 | 谁用 | 缺了会怎样 |
|---|---|---|
| PostgreSQL + `vector` + `pg_trgm` | 两个角色 | **硬依赖**：装不上 = 迁移失败 = 整栈起不来（ADR-0045） |
| Redis Stream | api 投递、worker 消费 | 投不进去 / 没人消费；就绪探针会红 |
| 对象存储（RustFS/MinIO 口径） | 原件与插图字节 | 传不了文档、取不到图；**不进就绪探针**——它挂了不该让检索跟着不可用 |
| platform-server 内部面 | 模型目录、订阅账号登录态、`platform` 来源取数 | 退回环境变量那一档；拉不到不阻塞启动 |
| 嵌入端点（经模型目录） | worker 摄取 | **摄不进任何文档**，每份文档判 `failed` 并说清缺什么 |
| 对话端点（经模型目录） | 对话页、`agentic` 策略 | 对话页 409、`agentic` 如实不可用（不退化成 hybrid） |
| 重排端点（**只有目录一个来源**） | `hybrid` / `agentic` | 按融合名次返回，`/capabilities` 如实说没接 |
| MinerU（可选 profile） | PDF 与扫描件解析 | 不收 PDF，传 PDF 的人拿到一句点得出名字的错 |
| FunASR（可选，现场自建） | 语音输入 | 没有麦克风键 |

### 1.4 架构决策索引

| ADR | 定了什么 |
|---|---|
| [0032](adr/0032-知识库独立成代码单元且LLM客户端下沉domain.md) | 独立成代码单元；LLM 客户端下沉 domain |
| [0033](adr/0033-知识来源与解析按注册表分层.md) | 来源与解析按注册表分层，上传也走同一个接口 |
| [0034](adr/0034-向量索引走端口并按扩展探测选实现.md) | ~~按扩展探测选实现~~（决策二至五已由 0045 作废） |
| [0035](adr/0035-检索编排是策略注册表.md) | 检索编排是策略注册表，agentic 是其中一个 |
| [0037](adr/0037-对话引擎并入domain-llmcore.md) | 通用对话引擎并入 `llmcore`，两侧各接各的工具 |
| [0038](adr/0038-语音输入走自建FunASR经知识库服务中继.md) | 语音走自建 FunASR，由本服务中继 |
| [0039](adr/0039-模型供应商目录由平台持有两端按用途取用.md) | 模型目录由 platform 持有，按用途取用 |
| [0041](adr/0041-订阅账号凭据归平台持有.md) | 订阅账号凭据归平台，本服务只领不刷 |
| [0042](adr/0042-重排是第三种模型种类且方言可插拔.md) | 重排是第三种模型种类，方言可插拔 |
| [0043](adr/0043-解析后端可插拔且外部解析服务留口.md) | 解析后端两级扩展点，外部服务留口 |
| [0044](adr/0044-对话检索范围钉在会话上.md) | 检索范围钉在会话上，`NULL` ≠ 空列表 |
| [0045](adr/0045-向量与关键词索引改为硬依赖.md) | 向量与关键词改为硬依赖，无回退档 |

---

## 2. 通用语言

写代码、写提示词、写界面文案都用这一套词，别处的同名词不是它。

| 词 | 指什么 | 不指什么 |
|---|---|---|
| **知识库** base | 一组共享同一嵌入档与检索策略的知识 | 不是文件夹，也不是权限域 |
| **来源** source | 知识从哪来的一路实例（一次上传通道、一个外部系统） | 不是一份文档 |
| **文档** document | 来源里的一个条目：一个上传的文件，或外部系统的一条记录 | **不一定是文件** |
| **原件** raw item | 字节 + media type + 文件名，解析层的入参 | 不含「它从哪来」 |
| **块** chunk | 检索与引用的最小单位 | 不是一段、也不是一页——切法由 `Chunker` 定 |
| **定位** locator | 一个块在原件里的位置（页码 / 工作表与行号 / 幻灯片序号 / 标题路径 / 版面框） | 不是块的 id |
| **图** figure | 解析出来的插图或表格截图 | 不是块，块与图靠联结表相连 |
| **策略** strategy | 一次检索怎么走（单次召回 / 混合 / 带补检的循环） | 不是一个模型 |
| **范围** scope | 一次对话去哪几个库取数，用户自己划、钉在会话上 | **不是权限**，也不是一次检索的入参 |
| **角标** mark | 答案里的 `①②③`，由服务端在检索回执上发 | 不是模型自己编的号 |
| **转写** transcript | 语音识别到目前为止的**整段**文字 | 不是一帧增量 |

两个必须避开的撞名：

- ⚠ 「**节点**」在本仓指三样东西（画布节点 / 采集点位 / OPC UA 地址空间节点），
  本服务一个都不涉及，所以提示词与响应里**不许出现这个词**。
- ⚠ 「**知识块**」在助手那边另有所指（`assistant.knowledge_chunks`，助手自己的
  长期记忆，ADR-0030）。两者不共表也不同步。说本服务的块，一律说「块」。

---

## 3. 系统全景

### 3.1 一次请求怎么走完

```
浏览器
  │  Authorization: Bearer <access token>
  ▼
边缘网关 nginx
  │  auth_request → auth-server 判「这条路径 + 这个方法要哪几个码」
  │  过了就注入 7 个 X-Auth-* 签名头（用户 id、角色、权限码…）
  ▼
knowledge-server (api)
  │  lib.auth 验签 → CallerContext → require(KNOWLEDGE_USE) 之类的依赖
  ├─ 读侧：直接查 knowledge schema
  ├─ 写侧：落行 → 事务提交之后才把摄取任务投进 Redis Stream
  └─ 代表用户调 platform 时：原样转发那 7 个头，绝不用服务级密钥替他读
        ▼
knowledge-worker  ← 消费 Redis Stream，跑摄取管线，状态写回文档行
```

⚠ **权限判定有两道**：边缘的闸 1（路径 + 方法 → 权限码，规则在
`auth-server/.../catalog/rules_knowledge.py`）与服务里的闸 2（`require(...)` 依赖）。
两道都过才算过；只加端点不登记规则的表现是那个码在角色配置界面上是个点了没效果的勾。

### 3.2 两个角色分别在跑什么

| | `api` 角色 | `worker` 角色 |
|---|---|---|
| 接不接流量 | 接 | **不接**，无 `expose`、无探针 |
| 启动钩子 | 读一次向量列维数、预拉一次模型目录 | 无（目录由摄取管线自己刷） |
| 就绪探针 | `postgres` + `redis` | 无 |
| 进程池 | 无 | `ProcessPoolExecutor(max_workers=1)` |
| 副本 | 可多副本 | **可多副本**，队列消费组自动分活 |
| 关停 | 摘就绪 → drain → 关 platform 客户端 → 关缓存 → 关库 | 停收新活 → drain（30 s）→ 关池 |

⚠ **liveness 严禁查依赖**，就绪探针也只放 Postgres 与 Redis：嵌入端点与对话端点
抖一下不该让整组副本被摘掉——知识库在模型不可达时仍要能列文档、看块。接没接由
`/capabilities` 如实回答，不由就绪状态代表。

⚠ worker 的 drain 超时（30 s）**比一份文档的解析超时（默认 10 min）短**：
等满一次解析等于让编排器的强杀先到，而那会把这份文档永远留在 `parsing` 上。

---

## 4. 流程一：摄取（一份文档怎么变成可检索的块）

### 4.1 上传是三步，字节从不经过本站 API

```
① POST /documents:upload-ticket   { base_id, filename, content_type, size_bytes }
     └─ 服务端：校后缀 → 校大小(≤64 MB) → 铸 document_id(uuid7) → 签一张 POST policy
        回 { document_id, url, fields, object_key, expires_seconds }   ⚠ 不落任何行
② 浏览器直接 POST 到对象存储的 url + fields（多部件表单）
     └─ 字节落 knowledge/{base}/{doc}/staging…    ⚠ 这一前缀不匿名可读
③ POST /documents                 { base_id, document_id, filename }
     └─ 服务端：把暂存字节读一遍算 sha256 → 挪到正式键 → 删暂存 → 落一行 kb_documents
        事务提交之后再 queue_ingest() 投队列
```

⚠ **id 在第一步就铸好并编进对象键**：登记那一步只认这个键，客户端没法把字节传到
一个 id 下、再拿另一个 id 来登记。

⚠ **哈希在服务端算，不信客户端报的**：客户端报什么就存什么的话，去重是一句空话——
两份不同内容报同一个哈希，第二份会被当成重复丢掉。

⚠ **投队列排在事务提交之后**（禁事务内投队列）：提交前投的话，消费者可能先于
可见性读到那一行，而现象是「刚传的文档一进来就报『找不到』」。

⚠ 重复由 `UNIQUE(base_id, content_hash)` 挡住，翻成 `42308 DuplicateDocument`
（HTTP 409）。不翻的话冒上去的是一条 500，里面写着 `duplicate key value violates…`，
而它其实是件完全正常的事。

### 4.2 队列信封

Redis Stream `knowledge:ingest`，消费组 `knowledge-ingest-workers`。

```json
{"envelope_version":"1","document_id":"…","base_id":"…","traceparent":"00-…"}
```

- ⚠ **只带 `document_id`，不带「该走到哪一步」**：以库里那一行的 `status` 为准。
  带步骤的话，「从头解析」与「只补嵌入」就成了两种消息，而状态本来就写在库里。
- ⚠ **信封里必须带 `traceparent`**：队列是异步的，不带它链路在这一跳齐断，
  而每一段单看都是完整的。
- 滞留超过 `ingest_claim_idle_ms`（默认 5 min）的消息由别的消费者认领。

### 4.3 状态机

```
pending ──→ parsing ──→ chunking ──→ embedding ──→ indexing ──→ ready
   │           │            │            │             │
   └───────────┴────────────┴────────────┴─────────────┴──→ failed
```

这七档是**线上契约**：`kb_documents.status` 上有 CHECK，前端文案按它写。
加一档要连着改 CHECK、前端与契约测试。

`ingest()` 的实际执行序（`services/ingest_pipeline.py`）：

| # | 做什么 | 关键判据 |
|---|---|---|
| 0 | `_claimed`：读那一行，已 `ready` 就跳过，否则推进 `parsing` | **判幂等看状态**，不是「先查再插」 |
| 1 | `_embeddable`：先刷一次模型目录，再问「这套部署此刻算得出向量吗」 | 算不出就**当场** `failed`，排在取原件之前 |
| 2 | `_raw_of`：按来源把原件取回来 | 先读来源配置再关事务，**事务里不做外部 IO** |
| 3 | `_parsed`：挑一路后端解开 | 外部后端排在本地之前；两支不合成一个函数 |
| 4 | 推进 `chunking`；`_figures_of` 存图 | 存图**不新增状态**，算在 parsing 的产出里 |
| 5 | `_chunked`：切块，切完当场验有没有超窗 | 有超窗就 `failed` 并说清是哪一格配错了 |
| 6 | `_saved_chunks`：整体替换块行 + 重建块—图联结 | 两件事**同一个事务** |
| 7 | 推进 `embedding`；`_indexed`：按批嵌入并写向量 | **每批一个事务**，嵌入调用在事务之外 |
| 8 | `mark_ready`：写 `chunk_count` 与 `ready_at` | |

⚠ **每一段自己一个事务**。整条管线一个事务的话，中间那几次 `mark_status`
在提交之前谁都看不见——于是「界面上看得见它停在哪」这句话是假的，
外面只看得到 `pending` 与终态两种。

⚠ **第 1 步那次刷目录不能省**：worker 进程里没有别的地方刷它，`can_embed` 问的是
手上那份快照。不刷的话它恒假，于是每一份文档都跳过嵌入走到 `ready`，
而界面上的能力面（api 进程刷过）说的是「已接」。

⚠ **本地解析跑在进程池里**，不在事件循环里。docx/xlsx/pptx 的解析是纯 CPU 且阻塞的，
放进 async 会把整条消费循环连同健康探针一起冻住，而现象是「服务好好的，队列不动了」。
池子**单工**：一份文档解到一半吃满内存是常事，并行两份的峰值内存翻倍——要更快就
多起一个 worker 副本。

⚠ **失败分两档**：`IngestFailed`（这一份摄不进来，重试没有意义）写 `failed` + 一句
人话；`SourceUnavailable`（对方此刻不可达）才是可重试的。混成一档的话，一份解不动的
文档会被无限认领重投。`failure_reason` **会原样上界面**，所以不许带表名、SQL、内网地址。

### 4.4 切块：上限由嵌入档的窗口说了算

这是整条链上最容易配错、且配错完全不报错的一格。

**实测**（`KNOWLEDGE_QUALITY_PLAN.md` §0.1）：拿两段只有结尾不同的中文喂
`bge-large-zh-v1.5`，共同前缀 500 字时余弦 0.952，到 **520 字恰好等于 1**——
两条向量逐位相同，结尾那句被整个丢掉了。**嵌入端点对超出窗口的那一截静默截断、不报错。**

于是：

- 切块上限 = `KNOWLEDGE_EMBEDDING_MAX_INPUT_TOKENS × 0.9`，由 `limits_for()` 折出来，
  **不是切块层自己的常量**。给它单独一格配置就等于允许两者漂开，而漂开的那一侧不报错。
- 单块本身超窗时**在句读处断开**（`chunking/sentences.py`）。硬切出来的块从半句话开始，
  在向量空间里几乎没有区分度。
- **换了标题不一定断，还要攒够 `KNOWLEDGE_CHUNK_MIN_TOKENS`**（默认 80）。
  只有一行标题的块又短又泛，与任何查询都有中等相似度，专挤名次。攒过小节的块，
  标题路径取这几块的**公共祖先**——取其中任一节都会让引用指向另一节，取祖先只是
  说得粗一点，从不指错。
- 相邻块按 `KNOWLEDGE_CHUNK_OVERLAP_CHARS`（默认 120）**在同一条标题路径内**带重叠。
  跨节带的话下一节开头会挂着上一节的结论，那正是「引用指错地方」的来路。
- **切完当场验一遍**（`oversized()`），有超窗的就判 `failed`，
  并点名说多半是 `KNOWLEDGE_EMBEDDING_MAX_INPUT_TOKENS` 配得比模型的窗口大。

P1 上线前后拿同一份真实报告重跑：

| | 旧 | 新 |
|---|---|---|
| 块数 | 14 | 24 |
| 最长一块 | 2031 字 / 1113 token | 836 字 / 445 token |
| 超窗的块 | **7 块（半数）** | **0** |
| 过短的块（<80 字） | 3 块 | **0** |
| **端点真正吃进去的比例** | **62%** | **100%** |

⚠ 换嵌入模型要跟着改 `KNOWLEDGE_EMBEDDING_MAX_INPUT_TOKENS`——窗口是模型的属性，
而 OpenAI 兼容口径里**问不出来**。

⚠ 改完切块口径要把已有文档**按「重新解析」全量重跑一遍**，否则改了等于没改。

### 4.5 解析产出的是保结构的文档，不是一坨字符串

`ParsedDocument` = 一串 `Block`，每块带 `kind`（`heading` / `paragraph` /
`table_row` / `list_item` / `caption` / `figure`）、`level`、`text`、`locator`。

⚠ **`locator` 不是可选的锦上添花，是引用能不能落地的前提。** 解析时丢掉它，
后面任何一层都补不回来，而表现是答得头头是道却指不出出处。

⚠ **切块只吃 `Block` 序列，不认原始格式。** 这条缝让「加一种格式」与「改切块策略」
彻底解耦：加 PDF 只是多一个后端，`StructuralChunker` 一个字都不用改。

各格式解到什么程度：

| 格式 | 解出什么 | 明确不解什么 |
|---|---|---|
| `.md` | markdown-it-py：ATX/setext 标题、围栏与缩进代码块、GFM 表格（表头折进每一行）、引用、嵌套与有序列表、YAML front-matter 当元数据剔掉 | 不把记号带进正文——`**温度**` 与 `温度` 不该是两个词 |
| `.txt` / `.log` | 逐行成块，**任何记号都不当记号** | ⚠ 刻意不按 markdown 解：日志里的 `# 注意` 是内容不是标题 |
| `.html` | 剥标签取文本，`h1`–`h6` 成层级 | 不执行脚本、不跟外链 |
| `.json` | 摊成「路径 = 值」，深度有上限 | 解不动就退纯文本，不抛 |
| `.docx` | 段落与表格**按文档序**穿、标题层级（认 `Heading N` 也认「标题 N」）、列表项、表格行、超链接文字、文本框文字、每节页眉页脚各一次、**嵌在段落里的图** | 不跑宏；**批注刻意不收**（审阅过程的对话，收进来会答出还没定稿的说法）；脚注尾注与多级列表真实层级 python-docx 1.2 够不着 |
| `.xlsx` / `.xlsm` | 一行一块，表头拼进每一行 | 只读值不读公式 |
| `.pptx` | 一页一组块，页码进 `locator`，每页第一个文本框当标题 | 没有 `text_frame` 的形状跳过 |
| `.pdf` / 图片 | 走 MinerU（见下） | 关着 MinerU 时**当场拒收**，不是收下之后解成空的 |

### 4.6 外部解析后端：MinerU 那一路

`parsing/` 的扩展点分两级，因为外部服务与本地库不是一个形状：

| | 本地库解 `DocumentParser` | 外部服务解 `ExternalParserBackend` |
|---|---|---|
| 跑在哪 | 本进程（调用方扔进**进程池**） | 另一个进程 / 另一台机器 |
| 是什么活 | 阻塞的 CPU | 网络 IO，**每次调用必须有超时** |
| 签名 | `def parse(raw)` | `async def parse_remote(raw, timeout_s)` |

⚠ **两个方法故意不同名。** 同名的话，把外部后端当本地的调用会拿到一个没 `await`
的协程当 `ParsedDocument` 用，而那既不是类型错误也不是运行期异常——它只表现为
「这份文档解出来是空的」。

MinerU 这一路从**真跑一遍**里得来的口径：

- ⚠ **只声明 `.pdf` 与图片后缀，不声明 Office。** 外部那一路排在本地之前，
  声明了 `.docx` 就会把它从解得更准的 `DocxParser` 手里抢走，还多花几十秒 CPU。
- ⚠ **吃 `content_list` 不吃 `md_content`**——markdown 那一份里没有页码，
  用它等于在这一步把 `locator.page` 丢掉。而 `content_list` 本身是**一个 JSON 字符串**，
  要再 `json.loads` 一次；当成数组用的话拿到的是三千多个单字符，且不报错。
- ⚠ **必须显式带 `backend=pipeline`**（服务端缺省的 `hybrid-engine` 要 GPU），
  且 `return_content_list` / `return_images` 都默认 `false`。
- ⚠ **走异步 `/tasks` 而不是 `/file_parse`**：纯 CPU 上一份几十页的扫描件按分钟算。
- ⚠ **失败是 HTTP 409 不是 5xx**，包体是任务信封、原因在 `error` 里；
  客户端要按 `status != "completed"` 判失败。
- ⚠ **标题层级是 MinerU 自己判的**：实测一份 PDF 里 `h1` 与 `h2` 会一起回
  `text_level=2`，所以 `locator.path` 只到「最近的一个标题」。
- OCR **不是无损的**：实测把表格里的破折号「—」读成了「二」。界面上别把它说成「原文」。

⚠ 接了 MinerU 之后有一个静默坑：注册表从常量改成 builder 时，
`capability.py` / `document_service.py` / `worker.py` 三处调用点必须**一起改**，
否则表现是「接了 MinerU，界面还是不收 PDF，传上去还被拒，而两边单看都对」。
仓里有一条契约测试就是这个坑的闸门。

### 4.7 图：字节落对象存储，块与图靠联结表连

- 解析出来的插图与表格截图落 `kb_document_figures`，字节进
  `knowledge/{base}/{doc}/figures/`；`kb_chunk_figures` 记「这一块的正文里真的出现了这张图」。
- ⚠ **不按页反查。** 一页上可能有五张图，而某一块只讲其中一张——按页反查会把另外
  四张也贴进引用，而那正是「依据里堆一堆没用的东西」。
- ⚠ **docx 的图也走这一条**：`a:blip/@r:embed` 挂在 `w:p` 底下，所以「图在哪一段」
  是准的。docx 没有页的概念，那几张图的 `page` 因此是空的——引用面上按文档名列，不编页码。
- ⚠ 图的名字用**内容哈希**而不是序号：重新解析时同一张图算出同一个键，不必重传、
  桶里也不会留孤儿。序号会随切分变化而漂。
- ⚠ **图注要进块的正文**：不进的话「图 1 冷却水回路示意图」这句话在库里根本不存在，
  检索不到。没有图注的图用一句占位——块的正文不许为空。
- ⚠ 取图走 `GET /documents/{id}/figures/{fid}` **流字节**，不发预签名 URL：
  预签名一旦生成就绕过了权限，而流字节每一次都经边缘判 `knowledge:use`。
  知识库里可能有涉密图纸，一条「谁拿到谁能看」的链接是不能给的。
  取原件那条（`/documents/{id}/raw`）同源同理，另加两条护栏头
  （`nosniff` 与 `default-src 'none'; sandbox`），且**只有白名单里的类型才 `inline`**
  ——用户传上来的 HTML 以 inline 摊在本站域名下就是一次存储型 XSS。

### 4.8 外部系统来源的同步

`POST /sources/{id}:sync` 触发一次拉取：`discover` 分页列条目 → 逐条 `fetch` →
渲染成原件落对象存储 → 登记成文档（内容重复就跳过）→ 投队列。

⚠ **在用户按下那一刻、用用户自己的身份跑**（api 角色，原样转发签名头），
**不存任何凭据**：存了的话，一次配置泄露等于把那个人的权限交出去，
而 worker 会拿着它在无人值守时不停地读。

⚠ **只收平台自己的路径，不收完整 URL**：收 URL 的话，这一格就成了一个可以指向
任何内网地址的探针（SSRF）。接别的系统请写它自己的来源实现。

⚠ 摄进知识库的东西，**可见性就交给知识库的权限模型了**——`knowledge:use` 看得见它，
哪怕那个人在 platform 那边看不见原始记录。配来源的人（`knowledge:manage`）要为
这件事负责，界面上要说清。

---

## 5. 流程二：检索

### 5.1 三种策略

| 策略 | 怎么走 | 什么时候用 | 缺依赖时 |
|---|---|---|---|
| `naive` | 单次向量召回 | 基线，也是「召回忽然变差了」时唯一的对照组 | 没嵌入档就不可用 |
| `hybrid`（**默认**） | 向量 + 关键词各召一批，RRF 融合，接了重排再排 | 绝大多数提问 | 没嵌入档时**退成只走关键词**并写进 `note` |
| `agentic` | 改写 → 召回 → 评分 → 不够再来一轮 → 合池重排 → 合成带引用的答案 | 要一个开箱即用的答案 | 没对话档就**如实不可用**，不悄悄退成 hybrid |

⚠ `naive` **不接重排**：它是基线，也是对照组。

⚠ `agentic` 的循环有**硬上限**：`MAX_ROUNDS = 3`、`MAX_QUERIES = 3`。到顶就把手上
最好的那一批连同 `is_complete=false` 一起交出去——没有上限的话，一次问不到的提问
会把进程占住。

⚠ 认不出的策略名**当场拒**（`42305`），不退回默认——退回的表现是「配的策略一直没生效」。

### 5.2 混合召回与 RRF

向量那一路答的是「意思像」，关键词那一路答的是「就是这个词」。工业资料里两者缺一不可：
「K1 机组」「GB/T 4728」这类**编号与型号**在向量空间里几乎没有区分度，而
「怎么判断轴承要换了」这类问法一个关键词都对不上。

- 每一路各召 `limit × 4` 条（`LANE_WIDTH = 4`）。
- 关键词那一路用 `pg_trgm`。⚠ **Postgres 内建分词不切中文**：
  `to_tsvector('simple','热水出口温度')` 给出的是整串一个词，任何部分匹配都命不中。
  trigram 对中文够用，代价是索引大。
- 融合用 **RRF**（`score += 1/(60 + rank)`）而不是按分数加权：两路的分数根本不同量纲，
  加权融合要先定标，而定标参数会随语料漂移——名次不会。

### 5.3 重排

融合解决的是「两路量纲不同」，解决不了「这十条里哪一条真的答得上这句话」。
重排把 query 与一批候选一起交给交叉编码模型，拿回针对这句话的相关度。

- **要 N 条先召 3N**（`RERANK_WIDEN = 3`，封顶 `RERANK_MAX_CANDIDATES = 60`）。
  只召 N 条的话，重排能做的只有把这几条换个顺序，而它真正的价值是把排在 N 之外、
  其实最相关的那一条捞上来。上限是硬的：每条候选的**全文**都随请求发出去。
- `agentic` 在**合池之后**对着**原问题**排一次，不让每条改写式各排一遍：
  几路的分数不是同一个基准，合池之后按它们排序等于按噪声排序。
- **重排不落库。** 与嵌入不同，换重排模型不作废任何存量向量、也不用重建索引。
- **排不成就退回融合名次，并把这件事写进 `note`。** 它是排序增强，挂了不该让用户
  拿到一句「检索失败」；而**不标注**才是那条真正的坑。
- **没接就在 `/capabilities` 里说，不在每次检索的 `note` 里念**：那是这套部署的常态
  而不是这一次的意外，每次都念的话真正的失败反而被淹掉。
- ⚠ **「接了」与「接了而且排得成」是两件事。** 实测过一次：端点接着、`/v1/models` 秒回、
  `/v1/rerank` 挂住不回，于是每次检索先等满 `KNOWLEDGE_RERANK_TIMEOUT_S`，
  而能力面报的是「接了、一切正常」。现在断路器不是关着的时候，`rerank.reason` 会说
  「连着几次没排成，已暂时短路」。
- 重排端点**不在 OpenAI 兼容口径里**，各家线形不同：方言配在**供应商**上，跟着端点走。

### 5.4 引用是一等公民

每条召回带 `document_id` / `document_title` / `heading_path` / `locator` / `score` / `why`。

⚠ **引用指到块，不指到文档。** 指到文档的话，用户拿到的是「答案在这份 200 页的手册里」，
而那等于没给出处。

⚠ **打分只排序不取舍，并把「为什么它排在这」一并交出去**（`why`）。得分为 0 的候选
一律不返回；硬凑几条出来的话，模型会以为「就这些了」然后从里面挑一条。

`locator` 各格按格式各取所需——PDF/PPTX 用 `page`（跨页时带 `page_end`），
xlsx 用 `sheet` + `row`，md/docx 用 `path`。⚠ 给人看的那句 `label` **由后端拼**：
各端各拼一份一定会漂。

### 5.5 两个端点

| 端点 | 给谁 | 出什么 |
|---|---|---|
| `POST /knowledge-bases/{id}:search` | 试验台、助手工具、任何调用方 | `hits[] / strategy / rounds / is_complete / note` |
| `POST /knowledge-bases/{id}:ask` | 不要对话的程序调用方 | `answer / citations[] / strategy / rounds / is_complete / note` |

⚠ `:ask` 里 **`citations` 的顺序即角标**：乱序的话引用全指错，而看着完全正常。

⚠ 点名一个只召回不作答的策略走 `:ask` 会被拒（`42309`）——把一个空答案交给用户
比报错更糟。

⚠ 库还检索不了（没配嵌入档 / 还没建过索引）时回 `42306`，**不返回空表**：
空表与「确实没有相关内容」长得一模一样，而模型会把它读成「查过了，没有」然后接着往下答。

---

## 6. 流程三：知识库对话

一个独立页：对着知识库多轮提问，模型自己决定检索几次、去哪几个库找，
歧义时反问并给选项，会话可列可改可归档。

⚠ 对话**不调 `:ask`**。两条编排叠起来会互相抢，且用户看不出这一轮到底是谁在决定
要不要再查一次。`:ask` 保留给不要对话的调用方。

### 6.1 一轮里发生什么

```
用户问一句
  └─ 模型看到：常驻提示词 + 这次对话的检索范围 + 历史窗口(≤40 条，超了每次脱 10 条折成摘要)
     ├─ 歧义？ → user.ask（客户端工具）→ 浏览器渲染选项 → 用户点一个 → 回同一个回合
     ├─ kb.search(base_id, query)      ← 可多次、可跨库；越界当场抛
     ├─ kb.read_chunk(chunk_id)        ← 要看全文；越界同样抛
     └─ 够了 → 带角标的答复
  └─ 服务端：扫答案里的角标 → 解析成引用 → 补图 → 落库 → 发 citations 帧 → turn.done
  └─ 首轮结束后：拿这一轮问答向**摘要档**要一个 ≤16 字标题 → 落库 → 发 session_titled 帧
```

### 6.2 事件流（SSE）

`POST /chat-sessions/{id}:advance` 回 `text/event-stream`，帧名如下：

| 帧 | 载荷 | 说明 |
|---|---|---|
| `message.delta` | `{channel, text}` | 模型又吐了一小块；**一块一帧不攒** |
| `step` | `{kind,name,state,title,error,input,output}` | 一步跑完了，入参与产出带钳过的预览 |
| `citations` | `{items:[…]}` | 这一轮答案真正用到的那几条 |
| `session_titled` | `{title,row_version}` | 自动起名成功，前端就地改清单那一行 |
| `client_tool.request` | `{calls:[…]}` | 停下来等浏览器（`user.ask`） |
| `turn.done` | `{reply}` | 回合结束 |
| `error` | `{code,message,trace_id}` | 回合内失败，**不断流** |

⚠ **`citations` 帧必须排在 `turn.done` 之前**：前端拿到 outcome 就把回合标成结束了，
之后再来的帧要么被丢掉、要么显得像「答完了又冒出来一块」。

⚠ **新增帧要排在兜底那一行之前**（`_frame_of`）：兜底当的是 `TurnOutcome`，
漏一档的表现是那一帧被当成 outcome 序列化，而前端读到一个没有 `reply` 的结束帧——
回合看着结束了，答案没了。

⚠ 边缘那条 SSE 路由是**正则 location**，必须写在 `/api/v1/knowledge/` 前缀之前，
且关掉缓冲。

### 6.3 三个工具与范围硬过滤

| 工具 | 收什么 | 给什么 | 范围怎么拦 |
|---|---|---|---|
| `kb.list_bases` | — | 有哪些库、各自的策略与索引档 | 只列范围内的 |
| `kb.search` | `base_id`、`query`、`limit` | 若干召回：库名、文档名、位置、正文、为什么命中、**角标** | 库不在范围里即抛 |
| `kb.read_chunk` | `chunk_id` | 那一块的完整原文与它前后各一块 | 块所属的库不在范围里即抛 |

⚠ **范围是硬过滤，不是提示词里的一句请求。** 提示词如实说这次能查哪几个库，
但真正拦住越界取数的是工具层每一次调用前的那一道判定。只写提示词的话，
模型多数时候听话、偶尔不听，而不听的那一次没有任何一处报错。

⚠ 三道拦截里 **`kb.read_chunk` 那道最容易漏**：前两个拦住了，模型仍可能从更早的
历史消息里翻出一个越界的 `chunk_id`，而它换回来的是整段原文。

⚠ 越界一律**抛错**而不是回空表。

⚠ 一期**不给写工具**：让模型能改库里的东西，等于让一句话就能改掉所有人以后检索到的
内容，而这件事没有撤销栈。

### 6.4 检索范围（ADR-0044）

范围钉在会话上（`kb_chat_sessions.base_scope_ids`），输入框上方的选择器改它。

- **`NULL` = 全部知识库**，是新对话的缺省；**空列表非法**，当场 400（CHECK 与入参
  校验各拦一道）。两者分不开的表现是「用户清空了选择，检索却悄悄扩到了全部库」。
- 出参 `base_scope` 带库名（`[{base_id,name,is_missing}]`）：只回 uuid 的话前端显示
  不出人话，而它手上那份库清单是分页的、也会过期。
- 范围里的库**被删了就标 `is_missing`，不抹掉**：抹掉等于替用户把边界改宽。
  同一条理由，那一列不建外键。
- 改范围推进 `row_version`；带了 `expected_version` 就断言，对不上回 `42323`（409）。
- **范围不是权限**：对话面仍然只要 `knowledge:use`。它是用户给自己划的取数边界。

### 6.5 引用：只列用到的那几页

答完之后扫一遍答案里的角标，把真被引到的那几条摊成一块「依据」——按文档收拢、
页码合并成不重叠的区间（「《现场手册》 第 4–6、9 页」），展开才看原文与图。

- ⚠ **没有角标就没有引用。** 检索回执里那十来条，模型多半只用了两三条；把查到的全
  列出来等于让用户自己从一堆里找哪几条支撑了那句话。所以扫不出角标时**不出引用块**。
- ⚠ **角标由服务端发**（`kb.search` 每条回执带一个 `mark`），不让模型自己编号：
  编号要跨多次检索连续，而模型只看得见这一次的回执。同一块被两次检索都召回时
  **复用同一个角标**。
- ⚠ 用**圆圈数字**而不是 `[3]`：正文里本来就有标准号与数组下标（`GB/T 4728`、`a[3]`），
  而 `①` 这类字符在中文技术文档正文里几乎不出现。1–50 有字符可用，超了退回 `(51)`。
  扫描时两种形态都认——模型偶尔会写成 `(3)`。
- ⚠ **提示词明确禁止模型自己在末尾抄一份「依据」列表**：界面已经按角标列了，
  再抄一遍只会长且容易抄错，而抄错的那一条看起来与对的一模一样。
- ⚠ 图**只给真被引到的块查**：一次召十来条，为没被引到的那些查图是白花的往返。
- ⚠ **引用跟着那条助手消息落库**（`kb_chat_messages.citations_json`），回放时照原样
  摆回时间线。只作为一帧流出去的话，重开这条对话整块依据凭空消失——而那几张文档插图
  **只挂在依据上**，现象是「问的时候看得见图，回来就没了」，且不报任何错。
  所以角标要在落库**之前**解析完，不是落完再算。
- ⚠ 帧与那一列共用同一个摊法（`citations.as_json`），前端类型由 `ChatCitationOut`
  经 openapi 钉住。各摊一份的话，直播画得出来的那一格回放时会少掉，而两边单看都对。

### 6.6 自动标题

首轮答完之后，拿这一轮的问答向**摘要那一档**模型要一个 ≤16 字的标题。

- ⚠ **起不出来也绝不留空**：模型挂了/超时/回了空，退回用户那句话的前 16 字。
  一排「未命名」谁也分不清哪个是哪个。
- ⚠ **只在标题为空时起，用户手填过的绝不覆盖**。落库前**再判一次**：问模型那几秒里
  用户可能刚改了名字。
- ⚠ **排在 `turn.done` 之后**：起名要再调一次模型，而用户此刻已经看到答案了。
- ⚠ **停在等浏览器时不起名**：那时 `reply` 是「我准备这么做」那句，不是答案。
- ⚠ 起名走**摘要档**而不是对话档：断路器因此与对话那一路分开，起名连挂不会把对话
  也短路掉。

### 6.7 走哪一路模型

对话档按**接入形态**查一张显式的表（`llm_adapters.KIND_BUILDERS`）：模型目录里给
`knowledge.chat` 分配了哪一路就走哪一路，没分配才退 `KNOWLEDGE_MODEL_*` 那一档。

- ⚠ 接不了的形态**如实缺席**，不退回环境变量那一档：静默改走另一路的差异只出现在账单上。
- ⚠ 订阅账号那一路的登录态归 platform，本服务经内部面领一份短时令牌、**只领不刷**——
  刷新是写操作，两个消费方各自去刷会互相把对方的令牌作废，现象是「用着用着就掉登录」。
- ⚠ 那一路的端点只认 `^[a-zA-Z0-9_-]+$` 的工具名，而三个工具都带点号：出去换成 `__`、
  回来换回去。不换是每一次带工具的对话都撞一条 400，而那条 400 里既不说是哪个工具、
  也不说问题出在点号上。

---

## 7. 流程四：语音输入

输入框旁一枚麦克风键：按一下、说一句、转写整体进草稿，说完再按一下。

```
浏览器 ──(wss, 子协议 dt.auth + token)──▶ 边缘 /_auth_ws 把子协议 token 映射成
  Authorization 再问闸 1 ──▶ knowledge-server /api/v1/knowledge/speech/ws
                                    └──(ws, 内网明文)──▶ 自建 FunASR
```

- 消息契约的**唯一真源**是 `apps/speech/services/protocol.py`，前端
  `features/speech/protocol.ts` 逐字复述，由契约用例按路径读源码比对。
  改任何一个字面量都要连着前端一起改；只改一边的表现是「握手成功、一个字都不出来」。
- 帧：`system{event:ready|done}`、`data{payload:{stage:partial|final,text}}`、`error`。
  客户端动作只有 `stop` / `cancel`。
- ⚠ `text` 永远是**整段**（已定稿各句 + 当前句的在线增量），客户端整体替换、不自己拼：
  让客户端拼的话，一帧丢了或重了，两侧的文本就永远对不上。
- ⚠ **收口前补 3 秒尾部静音**（`KNOWLEDGE_ASR_TAIL_SILENCE_S`）：FunASR 靠 VAD 判
  「说完了」，尾部静音不够长它判不出来、不给终稿——本部署实测 1.5 s 不够、3 s 够；
  太短的表现是每一句都要等到超时才拿到不带标点的在线整段。
- ⚠ 关闭码分档：`1008` 未认证（客户端不该重连）、`1013` 没接或 FunASR 不可达、
  `1003` 认不出的帧、`1011` 中继自己出错。
- ⚠ **中继一次都不重试**：这条链上负责重试的那一层是用户再按一次麦克风。
- ⚠ **浏览器开麦要 HTTPS 或 localhost**：这是浏览器的安全上下文要求。
  `http://` 页面上麦克风键会报一句能定位问题的错，现场部署要给边缘配 TLS。

---

## 8. 逻辑骨架：七层与它们的扩展点

`apps/knowledge/services/` 下七个子包，每个一副 `ports.py` + `registry.py` + 实现目录。

| 层 | 扩展点 | Protocol | 现有实现 |
|---|---|---|---|
| `sources/` | 知识**从哪来** | `KnowledgeSource` | `UploadSource`、`PlatformSource` |
| `parsing/` | 一份原件**由谁解、解成什么** | `DocumentParser` / `ExternalParserBackend` | 本地：`TextParser`（md/txt/log/html/json）、`DocxParser`、`XlsxParser`、`PptxParser`；外部：`MineruBackend` |
| `chunking/` | 怎么**切块** | `Chunker` | `StructuralChunker`、`FixedWindowChunker`、`RowChunker` |
| `embedding/` | 用哪一路**嵌入** | `Embedder` | `DomainEmbedder`、`NullEmbedder` |
| `indexing/` | 向量与关键词**存哪、怎么查** | `VectorIndex` / `KeywordIndex` | `PgVectorIndex`、`TrgmKeywordIndex`（各只有一个） |
| `retrieval/` | **检索策略** | `RetrievalStrategy` | `Naive`、`Hybrid`、`Agentic` |
| `reranking/` | 召回之后**怎么重排** | `Reranker` | `RemoteReranker`、`NullReranker` |

**扩展一层被钉死成三步**：加一个实现文件 → 注册元组里加一行 → 加一条契约测试。

⚠ 七层是**能力分层，不是执行流水线**。摄取那条链确实顺序穿过前五层，但检索只穿过
后三层，而 `agentic` 会**反复重入** `indexing/`——按执行顺序分层的话，每一层都要能被
重入，那与「分层」这件事本身矛盾。

⚠ 注册一律是**显式元组**，不靠 import 副作用：隐式注册让「装了哪些实现」取决于
import 顺序，而顺序在测试里与生产里可以不同。

⚠ 两条**今天走不到**的备选路径，写代码时别误以为它们是活的：`chunking` 里的
`rows` 与 `window` 两路——摄取管线写死 `_chunked(parsed, "", …)` 用默认那一路，
而 `kb_bases` 上没有「这个库用哪种切法」这一列。

---

## 9. 数据模型

schema `knowledge`，域前缀 `kb_`。主键 UUIDv7，时刻一律 `timestamptz` 存 UTC，
**禁原生 ENUM**（闭合集合用 CHECK）。

### 9.1 表

| 表 | 是什么 | 要紧的列 |
|---|---|---|
| `kb_bases` | 一个知识库 | `name`、`embedding_model`、`dimensions`、`retrieval_strategy`（CHECK: naive/hybrid/agentic，默认 hybrid）、`owner_id` |
| `kb_sources` | 一个库下的一路来源实例 | `base_id`、`kind`（CHECK: upload/platform）、`config_json`、`sync_cursor`、`last_synced_at`、`last_error` |
| `kb_documents` | 一份文档 | `base_id`、`source_id`、`external_ref`、`object_key`、`content_hash`、`status`（CHECK 七档）、`failure_reason`、`chunk_count`、`ready_at` |
| `kb_chunks` | 一个块 | `document_id`、`ordinal`、`text`、`locator_json`、`heading_path`、`token_count` |
| `kb_document_figures` | 一张图 | `document_id`、`ordinal`、`kind`（image/table）、`page`、`bbox_json`、`caption`、`object_key`、`content_hash` |
| `kb_chunk_figures` | 这一块引了这张图 | 复合主键 `(chunk_id, figure_id)` + `ordinal` |
| `kb_chunk_embeddings` | 一个块的嵌入（`vector(N)` + HNSW） | `chunk_id`、`base_id`、`embedding`、`embedding_model` |
| `kb_chat_sessions` | 一次对话 | `user_id`、`title`、`is_archived`、`base_scope_ids`、`row_version`、`summary_json`、`last_error` |
| `kb_chat_messages` | 一条消息 | `session_id`、`seq`、`role`、`content_json`、`usage_json`、`citations_json` |
| `kb_chat_steps` | 一步 | `message_id`、`seq`、`kind`、`name`、`state`、`input_json`、`output_json`、`error`、`started_at`、`ended_at` |

### 9.2 几条要紧的不变式

- ⚠ **`embedding_model` 与 `dimensions` 钉在库上**，不是钉在块上。一个库里混两种维数
  的向量算不出有意义的余弦，而表现只是「召回忽然变差了」——没有任何一处会报错。
  换嵌入模型 = 建一个新库或整库重嵌。
- ⚠ **`content_hash` 是摄取的幂等键**（`UNIQUE(base_id, content_hash)`）。判据是内容哈希
  而不是文件名——文件名一改就当成新文档，是最常见的重复来源。
- ⚠ **向量单独一张表**，不挂在 `kb_chunks` 上。取数形态完全不同：检索时先按向量收窄
  再回表取正文，而列表页永远不需要向量。挂在一起的话，一次「列一下这个库有哪些块」
  就把几千条 6 KB 的向量一起拖出来，而它只表现为「列表页有点慢」。
- ⚠ **`kb_chunk_embeddings` 没有 ORM 模型**：`vector(N)` 没有对应的 SQLAlchemy 类型
  （不引第三方包的话），读写都在 `services/indexing/pgvector.py` 里走裸 SQL。
- ⚠ `vector(N)` 的 **N 建表时定死**，取自 `KNOWLEDGE_EMBEDDING_DIMENSIONS`，
  **必须**等于模型目录里分配给「知识库嵌入」那个模型的维数。对不上时一份文档都摄不进来。
- ⚠ HNSW（`vector_cosine_ops`，余弦距离 `<=>`）**不吃 `WHERE base_id = ?`**，
  所以库过滤那一列另有一个 b-tree。
- ⚠ 重建索引**不必重算向量**：数据就在那一列上，`REINDEX` 读的也是它。
- ⚠ 图那张表有**两个唯一键**：`(document_id, ordinal)` 与 `(document_id, content_hash)`。
  后者是因为每页都有的图框会被解析出很多份，留重复行的表现是引用里同一张图贴好几遍。
- ⚠ `kb_chunk_figures` **反向那一列也要索引**：按 `figure_id` 反查「哪几块引了这张图」
  是删图前的必查，少了它那一查是全表扫描。
- ⚠ 跨 schema **不建外键**：`kb_chat_sessions.user_id` 不指向 auth 的用户表，
  `base_scope_ids` 也不指向 `kb_bases`。

### 9.3 迁移史

| 版本 | 做了什么 | 类型 |
|---|---|---|
| `a1c4e7b90d23` | 建五张表：库、来源、文档、块、块向量 | 扩展 |
| `b7d2e9f04a15` | 加对话三张表 | 扩展 |
| `c3f8a1d5e207` | 会话表加 `base_scope_ids`（可空 + CHECK 非空数组） | 扩展 |
| `d4a9c6b3f018` | 装 `vector` / `pg_trgm`，建 `kb_chunk_embeddings` 与三个索引 | 扩展 |
| `e5b7c2a91d46` | 删 bytea 那张旧向量表与运维脚本建的加速表 | **收缩** |
| `f6c8d3b25e17` | 加 `kb_document_figures` 与 `kb_chunk_figures` | 扩展 |
| `a7e1b4c96d38` | 消息表加 `citations_json`（可空） | 扩展 |

⚠ **迁移按扩展—收缩两次发布**：加列必可空、删列两步、禁改名与原地改类型、
迁移里**禁止回填数据**。`e5b7c2a91d46` 是本服务唯一一次收缩步，它只在「新结构 + 旧代码」
这套组合确定不再运行之后才做。

⚠ 这几张表建索引**不用 `CONCURRENTLY`**：那是给有活写入的存量表用的，
而这几张是新建的、建索引时还是空的。

---

## 10. 对外接口

统一信封 `{code,message,data,trace_id}`，**HTTP 状态码真实**（严禁恒 200）。
`openapi.json` 提交进仓、CI 校验一致，前端类型由它生成。

### 10.1 端点

| 方法 | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | `/capabilities` | use | 这套部署此刻能干什么 |
| GET | `/knowledge-bases` | use | 列库（`page` / `size` 分页） |
| POST | `/knowledge-bases` | **manage** | 建库 |
| GET | `/knowledge-bases/{id}` | use | 库详情 |
| DELETE | `/knowledge-bases/{id}` | **manage** | 删库（连文档、块、原件一起） |
| GET | `/knowledge-bases/{id}/sources` | use | 列来源 |
| POST | `/knowledge-bases/{id}/sources` | **manage** | 配一路来源 |
| POST | `/knowledge-bases/{id}:search` | use | 检索 |
| POST | `/knowledge-bases/{id}:ask` | use | 问答（带引用） |
| POST | `/documents:upload-ticket` | **write** | 申请直传凭证 |
| POST | `/documents` | **write** | 确认直传完成 |
| GET | `/documents` | use | 列文档（可按状态筛） |
| GET | `/documents/{id}` | use | 文档详情 |
| POST | `/documents/{id}:reparse` | **write** | 重新解析 |
| GET | `/documents/{id}/figures/{fid}` | use | 取一张图（**流字节**） |
| GET | `/documents/{id}/raw` | use | 取原件（**流字节**），页面里的预览与下载都走它 |
| DELETE | `/documents/{id}` | **write** | 删文档 |
| POST | `/sources/{id}:sync` | **write** | 跑一次来源同步 |
| GET | `/chat-sessions` | use | 对话列表 |
| POST | `/chat-sessions` | use | 新建对话 |
| GET/PATCH/DELETE | `/chat-sessions/{id}` | use | 详情 / 改标题·归档·改范围 / 删 |
| POST | `/chat-sessions/{id}:advance` | use | 推进一个回合（SSE） |
| WS | `/speech/ws` | use | 语音输入中继 |
| GET | `/health` `/ready` `/docs` `/openapi.json` | 免认证 | 探针与契约 |

⚠ 动作端点一律 `POST …:verb`，不造 `/documents/{id}/reparse` 这种伪资源。

### 10.2 错误码（领域号 23）

| 码 | HTTP | 什么意思 |
|---|---|---|
| 42301 | 404 | 知识库不存在，或存在但无权看见 |
| 42302 | 415 | 没有哪一路解析器认得这份原件 |
| 42303 | 404 | 文档不存在，或无权看见 |
| 42304 | 404 | 来源不存在，或无权看见 |
| 42305 | 400 | 点名的检索策略这套部署没装 |
| 42306 | 409 | 这个库还检索不了（没配嵌入档 / 没建过索引） |
| 42307 | 400 | 点名的文档状态不在闭合集合里 |
| 42308 | 409 | 这份内容已经在这个库里了 |
| 42309 | 409 | 点名的策略只召回不作答 |
| 42310 | 410 | 图那一行还在，字节已经不在对象存储里了 |
| 42311 | 404 | 这份文档没有原件（外部系统那一路的一行压根没有过文件） |
| 42312 | 410 | 文档那一行还在，原件的字节已经不在对象存储里了 |
| 42320 | 404 | 会话不存在，或无权看见 |
| 42321 | 409 | 这套部署没接对话档 |
| 42322 | 400 | 范围里点名的知识库不存在 |
| 42323 | 409 | 会话在别处改过了，手上那份是旧的 |
| 42340 | 400 | 语音：认不出的文本帧 |
| 52340 | 503 | 语音：FunASR 连不上或中途断（可重试） |
| 52341 | 500 | 语音：中继自己出错 |

⚠ **404 同时覆盖「不存在」与「存在但无权看见」**：id 是可枚举的，
用 403 区分这两件事等于逐个 id 回答「这一条确实存在」。

⚠ **`42310` 与 404 分开报**：行还在而字节没了意味着桶被清过，那是运维要知道的事，
不是「用户点了个不存在的图」。混成 404 的话，前者永远查不出来。
原件侧的 `42311` / `42312` 是同一条理由的两档：**「这一路来源本来就没有文件」与
「有过、字节没了」是两件事**，混成一个 404 的话，界面只能说「没有这份文档」——
而它明明就在那张表里列着。

⚠ **`42321` 用 409 不用 503**：这不是「暂时不行」，是没配。前端按码分支，指路去配置。

### 10.3 `/capabilities`：这套部署此刻能干什么

前端靠它决定摆不摆入口、accept 名单里放哪几个后缀、要不要摆麦克风键。

```jsonc
{
  "is_embedding_enabled": true,     // 没接 = 摄不进任何文档
  "is_model_enabled": true,         // 只决定 agentic 与对话页可不可用
  "is_asr_enabled": false,          // 没接 = 没有麦克风键
  "strategies": ["naive","hybrid","agentic"],
  "ready_strategies": ["naive","hybrid"],     // 装了 ≠ 此刻能用
  "source_kinds": ["upload","platform"],
  "accepted_suffixes": [".md",".txt",".docx","…"],  // ⚠ 前端不再写死一份
  "parsing": { "local_backends":[…], "external_backends":[], "reason":"这套部署没接外部解析服务…" },
  "index":   { "vector":"pgvector", "keyword":"trgm", "reason":"" },
  "rerank":  { "is_enabled":false, "model":"", "reason":"…" }
}
```

⚠ 它报的是「**此刻真能用什么**」，不是「配置想要什么」。两者不一致时以真实为准，
并把原因一并说出来——悄悄退化的表现是「有点慢」「有点不准」，而没有人会去查一件
没人说过的事。

⚠ `index.reason` 不是装饰：**维数对不上**这类毛病要在传文档之前就看得见，
否则第一次发现它的方式是每一份文档都摄取失败。那句话里会同时说出两个数字与
该改哪个环境变量——Postgres 自己那条「expected N dimensions」里两样都没有。

⚠ `accepted_suffixes` **由后端算出来下发**。前端写死一份的话，两份漂开的表现是
「选得中的文件传上去被拒」，而两边单看都对。

---

## 11. 权限与身份

| 权限码 | 管什么 |
|---|---|
| `knowledge:use` | 检索、问答、看块、看图、对话、语音 |
| `knowledge:write` | 传文档、删文档、重新解析、跑来源同步 |
| `knowledge:manage` | 建库删库、改嵌入档、改来源配置 |

⚠ `knowledge:manage` 比另外两条严：改嵌入档等于让整库的既有向量作废，
而那件事**没有任何运行期迹象**，只表现为召回忽然全错。

⚠ **同一段路径按方法分档**：`GET /knowledge-bases*` 要 use，
`POST/DELETE /knowledge-bases*` 要 manage。这正是闸 1 表达得了的形状。

⚠ **跑同步（write）与配来源（manage）分档**：能把外部记录摄进来不等于能改来源配置——
前者用的是调用者自己的身份去打上游，后者决定的是**去打哪里**。

⚠ **对话不新造 `knowledge:chat`**：它与 `knowledge:use` 之间不存在任何一种
「能 A 不能 B」的真实诉求，造出来只是角色配置界面上多一个没人分得清的勾。

⚠ **端点先落地、码再登记**：反过来的话，那个码没有任何规则要它，
在角色配置界面上就是一个点了没效果的勾。

⚠ 助手调知识库时**原样转发边缘注入的七个 `X-Auth-*` 签名头**，由知识库自己判权限。
助手绝不用服务级密钥替用户读它本来读不到的库。

⚠ WebSocket 那条：token 走**子协议**（`dt.auth`）而不是 `Authorization` 头
——浏览器的 WebSocket API 加不了自定义头。边缘用 `/_auth_ws` 把它映射成
`Authorization` 再来问闸 1。服务端 accept 时回子协议标记而**不回 token**：
回 token 等于把它写进响应头，会落进代理与浏览器的日志。

---

## 12. 配置

变量名 = `KNOWLEDGE_<组>_<键>`，**密钥类一律无默认值**。启动即全量校验，缺失即退出。

### 12.1 全表

| 变量 | 缺省 | 说明 |
|---|---|---|
| `KNOWLEDGE_APP_ROLE` | `api` | `api` / `worker` |
| `KNOWLEDGE_POSTGRES_*` | — | 主机、端口、用户、密码、库；schema 恒 `knowledge` |
| `KNOWLEDGE_REDIS_*` | — | 队列与缓存 |
| `KNOWLEDGE_OBJECTSTORE_*` | — | endpoint / bucket / ak / sk / public_base；**两个角色都要给全** |
| `KNOWLEDGE_EDGE_SIGNING_SECRET` | — | 验边缘身份头；⚠ 必须与 auth-server 取同一个值，分叉就是一律 401 |
| `KNOWLEDGE_EDGE_SERVICE_KEY` | — | 打内部面用的服务级密钥 |
| `KNOWLEDGE_PLATFORM_BASE_URL` | `http://platform-server:8005` | 模型目录、订阅登录态、外部来源 |
| `KNOWLEDGE_LLM_CATALOG_REFRESH_S` | `10` | 目录重拉间隔 |
| `KNOWLEDGE_LLM_CATALOG_TIMEOUT_S` | `3` | ⚠ 要比 platform 那条短：它在模型调用之前 |
| `KNOWLEDGE_LLM_LOGIN_TIMEOUT_S` | `15` | 领订阅登录态那一跳 |
| `KNOWLEDGE_EMBEDDING_ENABLED` | `false` | 开了就必须把 base_url / model / api_key 配全 |
| `KNOWLEDGE_EMBEDDING_DIMENSIONS` | `1536` | ⚠ **同时是库上 `vector(N)` 的 N**，迁移作业也要给 |
| `KNOWLEDGE_EMBEDDING_MAX_INPUT_TOKENS` | `512` | ⚠ **切块上限由它折算**；换模型必须跟着改 |
| `KNOWLEDGE_EMBEDDING_BATCH_SIZE` | `16` | 一次嵌入带几段；超了整批失败 |
| `KNOWLEDGE_EMBEDDING_TIMEOUT_S` | `30` | |
| `KNOWLEDGE_CHUNK_MIN_TOKENS` | `80` | 块的下限；上限**不在这里** |
| `KNOWLEDGE_CHUNK_OVERLAP_CHARS` | `120` | ⚠ 不能是 0：跨过一刀的问题两边都答不出 |
| `KNOWLEDGE_MODEL_*` | 关 | agentic 与对话页的**永久默认值**；目录里分配了就走目录 |
| `KNOWLEDGE_MODEL_BREAKER_FAILURES` / `_RESET_S` | `5` / `30` | ⚠ 只有「下游此刻不行」计数；401/403/400 一律不计 |
| `KNOWLEDGE_RERANK_TIMEOUT_S` | `15` | ⚠ 重排**只有目录一个来源**，没有环境变量那一档 |
| `KNOWLEDGE_INGEST_STREAM` / `_GROUP` | `knowledge:ingest` / `knowledge-ingest-workers` | ⚠ 与 worker 侧读同一对 |
| `KNOWLEDGE_INGEST_CLAIM_IDLE_MS` | `300000` | 多久算掉队 |
| `KNOWLEDGE_PARSE_TIMEOUT_S` | `600` | 本地解析；必须有，否则「队列不动了」 |
| `KNOWLEDGE_EXTERNAL_PARSE_TIMEOUT_S` | `180` | 外部解析投任务 + 轮询的总预算 |
| `KNOWLEDGE_MINERU_ENABLED` / `_BASE_URL` / `_LANG` / `_FORMULA_ENABLED` / `_TABLE_ENABLED` | 关 / `http://mineru:8000` / `ch` / 开 / 开 | 开了不给地址 = 启动即失败 |
| `KNOWLEDGE_ASR_ENABLED` / `_URL` / `_HOTWORDS` | 关 | 开了不给 `ws://`/`wss://` 地址 = 启动即失败 |
| `KNOWLEDGE_ASR_TAIL_SILENCE_S` | `3.0` | 实测 1.5 s 不够 |

不是配置、写死在代码里的两个：`MAX_HISTORY_MESSAGES = 40` 与 `HISTORY_DROP_STEP = 10`。
⚠ 按环境改行为会让两套部署跑出两种对话。

### 12.2 取值优先级

```
模型目录（platform 持有，按用途码分配）
   └─ 没分配 ──▶ KNOWLEDGE_EMBEDDING_* / KNOWLEDGE_MODEL_*   ← 永久默认值，不是一次性播种
重排 knowledge.rerank
   └─ 没分配 ──▶ 不启用（没有环境变量那一档）
```

三个用途码：`knowledge.chat` / `knowledge.embedding` / `knowledge.rerank`。
⚠ 它们在 `llm_purposes.py` 与 platform 的 `apps/llm_providers/enums.py` 里各有一份，
**逐字一致**由前端契约用例对着三份源码比对——服务之间不许互相 import，故只能复述。
漂开的表现是「界面上分配了、这一侧却还在用环境变量那一档」，而三边代码单看都对。

### 12.3 启动即失败的四条校验

`embedding_enabled` / `model_enabled` / `asr_enabled` / `mineru_enabled` 只要开着，
对应的地址、模型名、密钥就必须给全，否则**进程起不来**。

⚠ 不打 WARN 继续。留到第一次用才发现的话，服务已经接了流量，
而表现是「文档状态一直停在 embedding」「第一次开麦才报错」「每一份 PDF 都解析失败，
而能力面说的是『接了 mineru』」。

⚠ 迁移用的是**另一份只连库的配置**（`MigrationSettings`），刻意不继承完整 `Settings`：
跑一次建表与 Redis、对象存储、模型端点毫无关系，让它依赖整份配置的后果是——
任何只配了数据库的场合都会以 `Field required` 失败，而报出来的字段与建表这件事
完全对不上号。它破例带一格 `embedding_dimensions`，因为迁移要建 `vector(N)`。

---

## 13. 部署与运维

### 13.1 编排里的几个单元

```
knowledge-migrate   一次性作业：自己等库起来 → alembic upgrade head → 退出
knowledge-server    ROLE=api，expose 8009，healthcheck 打 /api/v1/knowledge/health
knowledge-worker    ROLE=worker，无 expose 无探针，可多副本
mineru              profile: mineru，第三方镜像，tag 钉死版本
mineru-models       profile: mineru，一次性下权重（约 2.4 GB）到具名卷
```

⚠ 真服务用 `service_completed_successfully` 等迁移作业——这正是「迁移先行」：
代码可回滚、数据库不回滚，故必须先让「新结构 + 旧代码」可用。

⚠ 迁移作业**自己等库**：库在本编排之外（与对象存储同档），compose 没法给它挂
healthcheck。不等就迁移，主机重启时 Docker 常比 Postgres 先起来，于是整栈拒绝启动。

⚠ **compose 不给服务挂 `env_file`**：宿主 `.env` 里配了而 compose 里没列的变量
**根本进不了容器**——而 `.env` 单看是配好的，两边都不报错。加一格配置要同时改
两份 `.env.example` 与 `compose.yml`（闸门 `check_config_secrets` 守着样例列全）。

⚠ MinerU 是**第三方镜像**：tag 钉死具体版本、**禁 `latest`**。它单开一个 profile，
因为体量大且没有它整套仍然能跑（只是不收 PDF）。权重挂卷不烤进镜像：
它与代码无关，烤进去每次重建都要重下一遍。

⚠ 起 MinerU 的三个实测坑：只装 `mineru[pipeline]`（`core`/`all` 会拖进 vlm 与 gradio）；
arm64 上要先从 `download.pytorch.org/whl/cpu` 钉住 `torch` 再装 mineru，
否则 PyPI 默认给 CUDA 版、镜像白胖 7 GB 而且一点报错都没有；
`mineru==3.4.5` 少声明了 `six`，表现是服务照常起来、健康探针也绿，
第一次解析才回一句 `No module named 'six'`（HTTP 409）。

### 13.2 边缘网关

```
/api/v1/knowledge/health|ready|docs|redoc|openapi.json     免认证直通
/api/v1/knowledge/speech/ws                                子协议 token → /_auth_ws
~ ^/api/v1/knowledge/chat-sessions/[^/]+:advance$           SSE，关缓冲
/api/v1/knowledge/                                          其余，auth_request + 注入身份头
```

⚠ **正则 location 压过前缀 location**，所以 `:advance` 与 `speech/ws` 两条必须写在
`/api/v1/knowledge/` 之前。

⚠ 这套部署不起 knowledge-server 时这几条一律 502——前端的能力探测把 502 读成
「这套部署没有知识库」，入口干净地不出现，而不是「暂时故障」。

### 13.3 扩缩与关停

- **api 角色**：可多副本，无状态。
- **worker 角色**：可多副本，队列消费组自动分活。⚠ 与 publisher 那种单活租约不是
  一回事——worker 没有 leader 概念。
- 关停顺序 = 先摘就绪 → 停收新活 → drain → 让资源。⚠ **停止顺序不是启动的逆序**：
  外部存储最后关，在途的摄取还要用它们把「这一步失败了」写回文档行——写不进去的话，
  界面上那份文档会永远转圈。

### 13.4 观测

结构化 JSON 日志，`event` 是稳定字面量。要认的几条：

| event | 什么时候 | 看什么 |
|---|---|---|
| `ingest_skipped` | 文档已删或已就绪 | 重复投递是常态，不是故障 |
| `ingest_chunked` | 切块完成 | `chunks`、`max_tokens`；⚠ 超窗数应恒为 0 |
| `kb_turn_failed` | 回合内失败 | `code` |

⚠ **4xx 不是 ERROR**；密钥 / PII / 请求体全文禁入日志。
⚠ 队列消息信封里必须带 `traceparent`，否则链路在异步处齐断。
⚠ 指标只用低基数标签——别拿 `document_id` 当标签。

### 13.5 换嵌入模型的正确姿势

这是最容易做错、且做错完全不报错的一次运维动作：

1. 在模型管理页上确认新模型的**维数**与**窗口**。
2. 改 `KNOWLEDGE_EMBEDDING_DIMENSIONS`（api / worker / **migrate 三处都要**）
   与 `KNOWLEDGE_EMBEDDING_MAX_INPUT_TOKENS`。
3. 重建向量表（新维数 = 新的 `vector(N)` = 一次新迁移）。
4. 把已有文档**全部按「重新解析」重跑**——存量向量不搬，它是另一路嵌入档算出来的一堆数。
5. 传一份文档验一遍，再看 `/capabilities.index.reason` 是不是空串。

⚠ 漏掉第 3 或第 4 步的表现分别是「每一次写向量都撞一条 expected N dimensions」
与「新老向量混在一个库里，召回忽然变差且一处不报错」。

---

## 14. 前端

### 14.1 两个页面

| 页 | 路由 | 干什么 |
|---|---|---|
| 知识库管理 | `/knowledge` | 左边选库，右边看文档摄取状态、传文档，底下一个检索试验台 |
| 知识库对话 | `/knowledge/chat` | 左边会话清单，右边对话 + 范围选择器 + 语音输入 |

两条路由都**只挂读码** `knowledge:use`；写码（`write` / `manage`）在页内用
`PermGuard` 挡住具体入口，只读账号看得见页面但看不见「传文档」「新建知识库」，
且 `explain` 会如实说明原因，免得以为功能没做。

### 14.2 几处容易踩的地方

- ⚠ **上传第二步不经过本站 API**：浏览器拿着签好的表单直接 POST 到对象存储。
  让字节穿过 API 进程的话，一个几百 MB 的手册会把一个 worker 占住几十秒。
- ⚠ API 客户端里路径写**相对知识库前缀**那一段，前缀由 `onKnowledge` 铺进 `baseUrl`：
  把整条 `/api/v1/knowledge/...` 当 path 传，客户端会再拼一次缺省的 auth 前缀，
  拿回来的是一个 403 的 HTML 页，前端只说得出「服务端响应格式异常」。
- ⚠ 引用里的图**取字节再转 object URL**，不把端点地址直接写进 `src`：
  `<img src>` 不带凭据，那条请求会被边缘挡掉。
- 管理页点文档名或眼睛图标**在页面里预览原件**：PDF 走 pdf.js 逐页画进 canvas
  （滚到哪画到哪）、Word 走 docx-preview 摊出真实版式、工作簿摊成 `DtTable`、
  图走 object URL、md/txt/log/json 走 `DtMarkdown` 或 `<pre>`、HTML 关进沙箱 iframe；
  `.pptx` 如实说画不了并给下载。文档行上的 `has_raw` 决定摆不摆这个入口——
  ⚠ 别拿 `media_type` 去推，上传那一路登记时把它留成空串。
  - ⚠ 三个解析库都**只许异步加载**：pdf.js 那一块 gzip 就有 130 KB，同步引进来
    是每次打开知识库页都白下一份，而多数时候用户根本不点预览。
  - ⚠ **HTML 预览与 docx 的 altChunk 各是一处安全边界**：前者必须
    `srcdoc` + `sandbox=""`（`blob:` 会继承本页的源）；后者是 .docx 里夹一整段
    HTML 的口子，docx-preview 默认把它画成一个**不带 sandbox 的 iframe**，
    必须显式 `renderAltChunks: false`。
  - ⚠ 预览入口**不进 `PermGuard`**：看原件要的是 `knowledge:use`，
    与重新解析、删除那两个写操作不是同一档。
- ⚠ 管理页**必须自己能滚**：窄屏（<xl）时左栏、文档表、试验台竖着堆，
  加起来必然高过视口，而 `AppShell` 的 `<main>` 是 `overflow-hidden`、自己不滚。
- ⚠ 摄取状态靠轮询（`useIngestPolling`）刷新，不是推送。
- ⚠ 语音协议前端复述的那一份由契约用例**按路径读后端源码**逐字比对。
- ⚠ 模板里的 prop / 插槽 / 注册名写错，**typecheck 与 lint 双双放行**，
  只能靠契约测试兜。

---

## 15. 测试与闸门

后端 542 个用例函数，分三层（`e2e/` 目录留着但一期为空）：

| 层 | 在哪 | 钉什么 |
|---|---|---|
| unit | `tests/unit/` | 解析各格式、切块口径、融合、重排、工具、标题、能力面 |
| contract | `tests/contract/` | 层名与注册表、错误码分段、语音协议、MinerU 线形夹具、对话与检索的一致性 |
| integration | `tests/integration/` | 真库跑：库/文档/检索/对话/图/同步/摄取管线/schema 事实 |

前端另有 `web/app/tests/contract/knowledge-*.contract.spec.ts` 与两页的 spec。

几道**只有闸门才逮得到**的契约：

- 配了 MinerU 之后 `/capabilities.accepted_suffixes` 里必须有 `.pdf`，
  且 `document_service` 的校验必须放行 `.pdf`（那三处调用点漏改的闸门）。
- `STRATEGIES` 两处一致：`kb_bases` 上的 CHECK 与 `retrieval/registry.py` 的注册表。
- 三个用途码在知识库、platform、前端三份源码里逐字一致。
- 语音协议常量前后端逐字一致。
- 引用帧与落库那一列共用同一个摊法。

⚠ 缺陷修复必须先有一条**修复前必红**的用例。
⚠ 增量覆盖 ≥ 85%，零容忍 flaky，**CI 不重试**。
⚠ 本地过闸用 `scripts/ci-local.sh`（`--fast` 秒级，其余走 act）；
**开发期不要推分支等 GitHub 的 CI——分支与 PR 上根本不触发流水线**。

---

## 16. 故障速查

| 症状 | 多半是 | 怎么确认 |
|---|---|---|
| 文档一直「处理中」 | worker 没起 / 队列名两侧不一致 / 解析卡在池里 | 看 worker 日志有没有 `ingest_chunked`；`XINFO GROUPS knowledge:ingest` 看有没有消费者 |
| 传上去状态 ready，检索查不到 | 嵌入档没接而 worker 那侧目录没刷（历史缺陷）/ 库还没建索引 | `/capabilities.is_embedding_enabled`；数一下 `kb_chunk_embeddings` 有没有行 |
| 一份文档都摄不进来，报 expected N dimensions | `KNOWLEDGE_EMBEDDING_DIMENSIONS` 与模型维数对不上 | `/capabilities.index.reason`——它会同时说出两个数字 |
| 「这一段明明有，就是搜不到」 | 块超窗被端点静默截断 | `ingest_chunked` 的 `max_tokens`；对照 `KNOWLEDGE_EMBEDDING_MAX_INPUT_TOKENS` |
| 检索忽然变慢，每次都卡十几秒 | 重排端点挂住不回 | `/capabilities.rerank.reason` 会说「已暂时短路」 |
| 召回质量忽然变差且一处不报错 | 换过嵌入模型但没整库重嵌 | 库里混着两种维数 / 两种口径的向量 |
| 传 PDF 被拒 | MinerU 没开，或开了但三处调用点漏改 | `/capabilities.parsing.external_backends` 与 `accepted_suffixes` |
| 每一份 PDF 都解析失败，而能力面说「接了 mineru」 | MinerU 起不来 / 没带 `backend=pipeline` / 缺 `six` | 直接打 MinerU 的 `/health` |
| 对话页整个用不了（409） | 没接对话档 | 错误码 `42321`，去模型管理页分配 `knowledge.chat` |
| 对话每一轮都撞 400 | 走订阅账号那一路而工具名带点号没换 | 看请求体里的 `tools[].function.name` |
| 「用着用着就掉登录」 | 两个消费方各自去刷订阅令牌 | 本服务应当**只领不刷** |
| 问的时候看得见图，重开对话就没了 | 引用没落库，只作为一帧流出去 | 查 `kb_chat_messages.citations_json` 是不是 NULL |
| 麦克风键报错 | 页面不是 HTTPS 也不是 localhost | 浏览器安全上下文要求，与本设计无关 |
| 每一句都要等超时才拿到不带标点的转写 | 尾部静音太短，FunASR 的 VAD 判不出说完了 | 调 `KNOWLEDGE_ASR_TAIL_SILENCE_S`（实测 3 s 够） |
| 知识库一律 401 | `EDGE_SIGNING_SECRET` 与 auth-server 分叉 | 两边取同一个值 |
| 检索面好好的，传上去的文档一直不动 | worker 角色缺对象存储那四项，起不来 | 两个角色共用一份 Settings，每个角色都要给全 |

---

## 17. 现在不做什么

写清楚是为了别把「有意不做」当成「漏了」：

- **权限下沉到文档**：一期粒度是「这个库」，不是「这份文档」。
- **多租户隔离**：所有库对有权限的人都可见。
- **增量重嵌**：换嵌入档只能整库重嵌，没有「只补新块」的路径。
- **对话面的写工具**：模型手上一个写工具都没有。
- **跨会话的长期记忆**：知识库的「记忆」就是知识库本身。
- **对话面的附件**：这一页的输入是问题不是资料；加资料走 `/knowledge` 的上传。
- **对话面的计划子系统**：知识问答不是多步施工，摆一个空计划栏只会占地方。
- **图片与图表的内容理解**：图只取图注与字节，不进视觉档。
- **知识图谱 / 实体抽取**：检索是纯文本召回。
- **库上选切块策略**：`rows` / `window` 在注册表里，但没有一列配置能选到它们。
- **父块回填与查询侧改写**（`KNOWLEDGE_QUALITY_PLAN.md` P6 的另一半）：等复量之后再定。

⚠ 每一条的加法都已经在对应章节里写清楚了代价——多数是「一个文件 + 注册表一行 +
一条契约测试」。之所以不做，是因为**没有真实需求时写出来的是一份猜的实现**，
而半吊子实现会让能力面报「接了」，比缺席更难查。
