# 知识库设计

知识库是**来源驱动**的：它不是「文档库」，是「知识来源库」。文档上传只是其中一路来源，
外部系统（台账、工单、ERP）是并列的另一路，**加一路来源不改任何调用方**。

对应的代码单元是 `server/services/knowledge-server/`（端口 8009、schema `knowledge`），
两个部署单元：`api` 角色与 `worker` 角色。前端在 `web/app/src/pages/knowledge/`。

架构范式整体照抄 AI 助手的能力分层（[ADR-0029](adr/0029-助手按能力分层且每层一个注册表.md)）：
**每层一副骨架 `ports.py` + `registry.py` + 实现目录**，扩展一层被钉死成三步——
加一个实现文件、注册元组里加一行、加一条契约测试。

决策见 [ADR-0032](adr/0032-知识库独立成代码单元且LLM客户端下沉domain.md)
至 [ADR-0035](adr/0035-检索编排是策略注册表.md)。

---

## 1. 三条支柱

### 1.1 来源是可插拔的，文档只是其中一路（[ADR-0033](adr/0033-知识来源与解析按注册表分层.md)）

真正会变的不是「支持几种文件格式」，是「知识从哪来」。所以最外面那一层不是解析器，
是 `KnowledgeSource`：

| | 上传来源 `upload` | 外部系统来源 `dataset` |
|---|---|---|
| 原件在哪 | 对象存储里的一个 key | 别人服务的 HTTP 面 |
| 谁触发同步 | 用户传一个文件 | 周期拉取 / 手动触发 |
| 一条「文档」是什么 | 一个文件 | 一次拉取的一行 / 一份记录 |
| 失败意味着 | 这份文件我们解不了 | 那边此刻不可达，或口径变了 |

⚠ **上传那一路也走同一个 `KnowledgeSource` 接口**，不给它开后门。开了后门的话，
第二路来源要么复制一遍摄取管线，要么把管线改成认两种形状的 `if`——而那个 `if`
会在第三路来源出现时变成三个分支。

⚠ **外部系统来源经对方的 HTTP 面拿数据，绝不读对方的库。** 抄一份别人的数据进
自己的库已经够危险（那边改了，这边的副本不会跟着变），再绕过它的权限判定去抄，
就等于用知识库当越权通道。

### 1.2 摄取是可续跑的状态机，状态落库不落内存

一份文档从进来到能被检索，要走完 `解析 → 切块 → 嵌入 → 建索引` 四段。每一段都可能
慢（几十秒到几分钟）、可能失败、可能重复投递。所以：

```
pending ──→ parsing ──→ chunking ──→ embedding ──→ indexing ──→ ready
   │           │            │            │             │
   └───────────┴────────────┴────────────┴─────────────┴──→ failed
```

- 状态与失败原因**落在 `kb_documents` 行上**，不留内存：worker 是多副本、可重启的，
  留内存的话一次重启就把「它到底卡在哪一步」全丢了，而界面上表现为「一直在处理中」。
- 队列是 Redis Stream 消费组（复用 `platform_server/stream.py` 那一套，
  [ADR-0032](adr/0032-知识库独立成代码单元且LLM客户端下沉domain.md) 决策五要求它上移到 `lib`）。
  **at-least-once 是常态**，所以消费者按**当前状态**判幂等：已经越过这一段的直接跳过。
  ⚠ 「先查再插」不是幂等——判据必须是那一行的状态，不是「有没有查到」。
- **不自动重试。** 一份解不动的文档重试一万次也解不动，而重试会把 worker 占满。
  失败即写 `failed` + 一句人话，由人在界面上按「重新解析」
  （runtime-resilience §4：一条链路只有一层负责重试，而那一层是人按的那一下）。

⚠ **解析跑在进程池里，不在事件循环里。** docx/xlsx/pptx 的解析是纯 CPU 且阻塞的，
放进 async 会把整条消费循环连同健康探针一起冻住，而现象是「服务好好的，队列不动了」。
照抄 `TrainerPool` 的形状：单工进程池 + 超时 + 超时后杀进程换新池
（`ProcessPoolExecutor` 没有公开的「杀掉在跑任务」的口，被掐断的解析会继续烧 CPU）。

⚠ **认不出的格式必须当场报错，不许静默给空。** 静默给空的表现是「这份文档传上去了、
状态是 ready、检索却永远查不到它」——那与「这份文档里确实没这句话」长得一模一样。

### 1.3 检索策略可插拔，agentic 是其中一个策略（[ADR-0035](adr/0035-检索编排是策略注册表.md)）

AgenticRAG 的「agentic」落在**两侧**，各解决一半：

| | 助手侧（原语工具） | 知识库侧（检索策略） |
|---|---|---|
| 谁在决策 | 助手已有的 `think ⇄ use_tools` 环 | `retrieval/` 层的一个策略实现 |
| 给什么 | `knowledge.search` / `knowledge.get_chunk` / `knowledge.list_bases` | `POST /knowledge-bases/{id}:ask` |
| 好在哪 | 决策带着整轮对话的上下文，改写查询这件事它做得最好 | 非对话消费方开箱可用，质量集中一处可控 |
| 缺什么 | 非对话消费方用不上 | 助手看不见中间过程（"一步一步看得见"那一半没了） |

两侧共用同一个 `RetrievalStrategy` 注册表，一期装三个实现：

- `naive` —— 单次向量召回。基线，也是出问题时的对照组。
- `hybrid` —— 向量 + 关键词各召一批，按名次融合（RRF）。**默认**。
- `agentic` —— 改写 → 路由 → 召回 → 评分 → 覆盖不足再来一轮 → 合成带引用的答案。
  它要一路 LLM；LLM 端口缺席时**这个策略如实不可用**，不是悄悄退化成 `naive`
  （悄悄退化的表现是「质量忽然变差了」，没有任何一处报错）。

⚠ **打分只排序不取舍，并把「为什么它排在这」一并交出去。** 这条与点位召回同源
（AI_ASSISTANT_DESIGN §3）：得分为 0 的候选一律不返回；硬凑几条出来的话，
模型会以为「就这些了」然后从里面挑一条。

---

## 2. 六层与它们的扩展点

`src/knowledge_server/apps/knowledge/services/` 下六个子包，每个一副 `ports.py` +
`registry.py` + 实现目录：

| 层 | 扩展点 | Protocol | 一期实现 |
|---|---|---|---|
| `sources/` | 知识**从哪来** | `KnowledgeSource` | `UploadSource`、`DatasetSource` |
| `parsing/` | 一份原件**解成什么** | `DocumentParser` | `TextParser`、`DocxParser`、`XlsxParser`、`PptxParser` |
| `chunking/` | 怎么**切块** | `Chunker` | `HeadingChunker`、`FixedWindowChunker`、`RowChunker` |
| `embedding/` | 用哪一路**嵌入** | `Embedder` | `DomainEmbedder`（走 `server/domain/llm`）、`NullEmbedder` |
| `indexing/` | 向量与关键词**存哪、怎么查** | `VectorIndex` / `KeywordIndex` | `PgVectorIndex` / `BruteForceIndex`；`TrgmKeywordIndex` / `LikeKeywordIndex` |
| `retrieval/` | **检索策略** | `RetrievalStrategy` | `NaiveVector`、`Hybrid`、`Agentic` |

⚠ 六层是**能力分层，不是执行流水线**（ADR-0029 决策一）。摄取那条链确实按顺序穿过
前五层，但检索只穿过后两层，而 `agentic` 策略会**反复重入** `indexing/`——
按执行顺序分层的话，每一层都要能被重入，那与「分层」这件事本身矛盾。

### 2.1 解析产出的是**保结构的文档**，不是一坨字符串

`DocumentParser.parse()` 给的是 `ParsedDocument`：一串 `Block`，每块带
`kind`（`heading` / `paragraph` / `table_row` / `list_item`）、`level`、`text`、
以及一格 `locator`（页码 / 工作表名与行号 / 幻灯片序号 / 标题路径）。

⚠ **`locator` 不是可选的锦上添花，是引用能不能落地的前提。** 解析时丢掉它，
后面任何一层都补不回来，而表现是助手答得头头是道却指不出出处——用户没法核对，
这份答案就等于没有。

⚠ 切块**只吃 `Block` 序列，不认原始格式**。这条缝让「加一种格式」与「改切块策略」
彻底解耦：加 PDF 只是多一个 `PdfParser`，`HeadingChunker` 一个字都不用改。

### 2.2 一期不认 PDF——但它只是注册表里少一行

用户拍板一期只做 Office（docx/xlsx/pptx）与纯文本（md/txt/html/json）。
PDF 是工业现场最常见的格式，所以这里明确记一笔：

- 加 PDF = 加一个 `parsing/pdf.py` + 注册元组一行 + 一条契约测试。**不动任何调用方。**
- 在此之前，传 PDF 的用户拿到的是一句点得出名字的错（「暂不支持 .pdf」），
  **不是**一个状态 ready 却检索不到的空文档。
- 扫描件（图片型 PDF）与原生文本 PDF 是两件事，将来做的时候要分开报：
  「这是扫描件，需要 OCR」比「解析失败」有用得多。

---

## 3. 数据模型

schema `knowledge`，域前缀 `kb_`（database-standard §1）。

| 表 | 是什么 | 要紧的列 |
|---|---|---|
| `kb_bases` | 一个知识库 | `name`、`embedding_model`、`dimensions`、`retrieval_strategy` |
| `kb_sources` | 一个库下的一路来源实例 | `base_id`、`kind`、`config_json`、`last_synced_at` |
| `kb_documents` | 一份文档 | `base_id`、`source_id`、`external_ref`、`object_key`、`content_hash`、`status`、`failure_reason` |
| `kb_chunks` | 一个块 | `document_id`、`ordinal`、`text`、`locator_json`、`token_count` |
| `kb_chunk_vectors` | 一个块的嵌入结果（bytea） | `chunk_id`、`embedding`、`embedding_model`、`dimensions` |

⚠ **`embedding_model` 与 `dimensions` 钉在库上**，不是钉在块上。一个库里混两种维数
的向量算不出有意义的余弦，而表现只是「召回忽然变差了」——没有任何一处会报错。
换嵌入模型 = 建一个新库或整库重嵌，界面上要明说这件事。

⚠ **`content_hash` 是摄取的幂等键。** 同一份文件传两次不该解两遍、更不该在检索里
出现两份。判据是内容哈希而不是文件名——文件名一改就当成新文档，是最常见的重复来源。

⚠ **向量单独一张表**，不挂在 `kb_chunks` 上。理由是取数形态完全不同：检索时
先按向量收窄再回表取正文，而列表页永远不需要向量。挂在一起的话，一次「列一下这个库
有哪些块」就把几千条 6KB 的向量一起拖出来，而它只表现为「列表页有点慢」。

### 3.1 pgvector 是**加速物化**，bytea 是**持久真相**（[ADR-0034](adr/0034-向量索引走端口并按扩展探测选实现.md)）

- `kb_chunk_vectors.embedding` 是 `BYTEA`（小端 float32），**全环境都有**，
  由主线迁移建。它是「不想再花一次嵌入的钱」那一份。
- pgvector 那一路的 `kb_chunk_vectors_pgv(chunk_id, embedding vector(N))` + HNSW 索引
  **不由主线迁移建**，是一步显式的运维动作（`python -m knowledge_server.index --enable-pgvector`）。
  它是「查得快」那一份。
- 服务**启动时探测扩展与加速表在不在**，据此选 `PgVectorIndex` 或 `BruteForceIndex`，
  探测结果如实进 `/capabilities`。

⚠ 为什么加速结构不进 alembic：`CREATE EXTENSION` 是**库级**动作，而本仓的结构闸
明令「一个服务的迁移不许动别的 schema」；更要紧的是，目标库装不上 pgvector 时
迁移会当场失败，而迁移是 compose 的前置作业——**整栈起不来**。把它挪出迁移之后，
「装没装 pgvector」就只是取值不同，不是行为不同（config-and-secrets §5）。

⚠ 双份存储是**有意付的代价**：1536 维一条 6KB，十万块就是 1.2 GB 两份。换来的是
重建索引不必重新调一遍嵌入 API——那是真金白银，而且重建索引这件事一定会发生。

---

## 4. 检索

### 4.1 混合召回

向量那一路答的是「意思像」，关键词那一路答的是「就是这个词」。工业资料里两者缺一不可：
「K1 机组」「GB/T 4728」这类**编号与型号**在向量空间里几乎没有区分度，而
「怎么判断轴承要换了」这类问法一个关键词都对不上。

- 关键词那一路用 `pg_trgm`。⚠ **Postgres 内建分词不切中文**：`to_tsvector('simple', '热水出口温度')`
  给出的是整串一个词，任何一次部分匹配都命不中。trigram 对中文够用，代价是索引大。
- 两路结果按**名次融合**（RRF）而不是按分数加权：两路的分数根本不同量纲，
  加权融合要先定标，而定标参数会随语料漂移——名次不会。
- `pg_trgm` 也可能装不上，所以关键词那一路同样有回退实现（`LikeKeywordIndex`）。
  回退的表现要如实进 `/capabilities`，不许装作一切正常。

### 4.2 引用是一等公民

每条召回带 `document_id` / `document_title` / `locator` / `score` / `why`。
`:ask` 的答案里每一句结论后面挂角标，角标指到具体的块。

⚠ **引用指到块，不指到文档。** 指到文档的话，用户拿到的是「答案在这份 200 页的手册里」，
而那等于没给出处。

---

## 5. 与 AI 助手的接缝

助手是知识库的**消费方**，不是它的一部分：

- 助手侧多一路 `ToolProvider`（`KnowledgeTools`），出三个只读原语工具。它排在
  **服务端工具之后、客户端工具之前**——注册序即工具在提示词里的先后，而先后影响
  模型的第一反应。
- 多一个技能 `knowledge-qa`：正文交代「先改写成 2–3 条检索式、召回不足就换词再查一轮、
  每句结论后面挂 `[来源:文档名 第N页]`」。技能适用于**所有工作面**——问知识库这件事
  与用户站在哪一页无关。
- ⚠ 助手调知识库时**原样转发边缘注入的七个 `X-Auth-*` 签名头**，由知识库自己判权限
  （AI_ASSISTANT_DESIGN §8 同一口径）。助手绝不用服务级密钥替用户读它本来读不到的库。
- ⚠ 知识库**不回调助手**（ARCHITECTURE §6 禁双向同步 RPC）。`agentic` 策略要的 LLM
  走 `server/domain/llm/`，不是走助手。

---

## 6. 身份与权限

三个权限码，按「读 / 写内容 / 管库」分：

| 权限码 | 管什么 |
|---|---|
| `knowledge:use` | 检索、问答、看块 |
| `knowledge:write` | 传文档、删文档、触发重新解析、跑来源同步 |
| `knowledge:manage` | 建库删库、改嵌入档、改来源配置、开关加速索引 |

⚠ `knowledge:manage` 比另外两条严：改嵌入档等于让整库的既有向量作废，
而那件事**没有任何运行期迹象**，只表现为召回忽然全错。

---

## 7. 可卸载

与助手同一口径（AI_ASSISTANT_DESIGN §9），任一层成立都是**干净地不出现**：

| 层 | 怎么关 | 效果 |
|---|---|---|
| 编译期 | 前端不注册知识库路由 | 入口不出现 |
| 部署期 | 编排里不起 `knowledge-server` | 能力探测失败 → 入口不出现，助手侧那一路工具缺席 |
| 账号 | 不给 `knowledge:use` | `PermGuard` 挡住入口 |

⚠ 探测失败一律读成「这套部署没有知识库」，不是「暂时故障」。

嵌入档同样可缺席：没配嵌入时服务照常起、能被上传与解析，检索**如实回答
「这个库还没建索引」**——不是返回空表。空表与「确实没有相关内容」长得一模一样。

---

## 8. 一期不做

- **PDF 与 OCR**（§2.2 已说清加它的代价只有一个文件）。
- 权限**下沉到文档**：一期权限的粒度是「这个库」，不是「这份文档」。
- 多租户隔离：一期所有库对有权限的人都可见。
- 增量重嵌：换嵌入档只能整库重嵌，没有「只补新块」的路径。
- 图表与图片内容的理解：解析时图片被记成一句占位，不进视觉档。
- 知识图谱 / 实体抽取：`agentic` 策略里没有它，检索是纯文本召回。
