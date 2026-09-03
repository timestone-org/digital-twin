# 知识库效果专项：从「能查」到「查得准、指得出、看得见」

一次把六件事做完的实施计划：接 MinerU、图片落位、页码映射、引用展示、会话自动命名、
预处理与切分。分七期（P0–P6），**一期一个 PR**，前后有依赖但每一期自己可验收。

设计基线见 [KNOWLEDGE_BASE_DESIGN.md](KNOWLEDGE_BASE_DESIGN.md)、
[KNOWLEDGE_CHAT_DESIGN.md](KNOWLEDGE_CHAT_DESIGN.md)，
以及 ADR [0033](adr/0033-知识来源与解析按注册表分层.md)、
[0035](adr/0035-检索编排是策略注册表.md)、
[0042](adr/0042-重排是第三种模型种类且方言可插拔.md)、
[0043](adr/0043-解析后端可插拔且外部解析服务留口.md)、
[0045](adr/0045-向量与关键词索引改为硬依赖.md)。

---

## 0. 先摆事实：现在这套的效果差在哪

下面七条都是**在本部署上实测出来的**，不是推断。

### 0.1 ⚠ 每一块正文有约四分之三从未进过向量

嵌入档是 `bge-large-zh-v1.5`（`http://140.80.0.212:8090/v1`）。拿两段**只有结尾不同**
的中文喂进去，量它们的余弦：

| 共同前缀 | 总长 | cos(A, B) |
|---|---|---|
| 200 字 | 218 字 | 0.881 |
| 400 字 | 418 字 | 0.912 |
| 480 字 | 498 字 | 0.931 |
| 500 字 | 518 字 | 0.952 |
| **520 字** | **538 字** | **1.000000** |
| 800 字 | 818 字 | 1.000000 |

**余弦恰好等于 1，意味着两段文本的向量逐位相同——结尾那句被整个丢掉了。**
这个模型的窗口是 512 token，约合 510–520 个汉字，**超出部分静默截断，端点不报错**。

而切块层的上限是 `MAX_CHUNK_CHARS = 2_000`（`chunking/structural.py`）。
库里那份《卷烟工厂绿色生产指数分析报告》14 个块：

```
块数 14   最短 25 字   平均 828 字   最长 2031 字
超窗（>520 字）的块：7 个   过短（<80 字）的块：3 个
```

**一半的块超窗**，最长那一块 2031 字里只有前 520 字进了向量，**另外 1500 字对向量
检索完全不存在**。它们只剩 trgm 那一路能命中，而 trgm 命的是字面。

这是「知识库效果不好」的**头号原因**，且它比任何检索侧调优都靠前——半数正文没进
向量的时候，调策略、加重排都是在噪声上做。

### 0.2 过度切分：三个块加起来不到 90 个字

同一份文档里有三个块是 25 / 29 / 32 字，内容就是「一、核心结论」这类**光秃秃的标题行**。
成因在 `structural.py::_cuts_here`：

```python
# ⚠ 换了标题路径就断，哪怕上一段很短
if not _same_section(previous, current):
    return True
```

只要标题路径一变就下刀，**不看攒了多少**。于是「标题 → 立刻又是下级标题」会切出一个
只有标题的块。这种块与任何查询都有中等偏上的相似度（它短、它泛），专门挤占名次。

### 0.3 重叠（`OVERLAP_CHARS = 200`）多数情况下是 0

```python
def _carried(rows, overlap):
    tail = rows[-1]
    if tail.kind == "heading" or len(tail.text) > overlap:
        return []          # ← 尾块比 200 字长就一个字都不带
    return [tail]
```

带的是**整块**不是尾巴，而正文段落经常超过 200 字——于是「跨过一刀的问题两边都答不出」
这个坑，注释里写着要防，实际没防住。

### 0.4 跨页的块只报首页

`_flush()` 取 `rows[0].locator` 当整块的位置。一块横跨 4–6 页时，引用只说「第 4 页」。

### 0.5 今天数据里根本没有页码

那份报告是 docx，`locator_json` 全是 `{"page": null, "row": null, "path": [...], "sheet": ""}`。
**「引用要标页码」这件事，今天在数据层面无从谈起**——不是展示没做好，是那一格是空的。
页码只能从有版面的格式（PDF / PPTX）来。

### 0.6 PDF 一律拒收，外部解析后端一个都没接

`EXTERNAL_BACKENDS = ()`（ADR-0043 一期刻意留空）。工业现场最常见的格式今天进不来。

### 0.7 重排那一路是空的

`platform.llm_assignments` 里没有 `knowledge.rerank` 这一行。检索直接吃融合名次，
而代码早就写好了。**这是零代码改动、纯配置的一档质量。**

### 0.8 会话标题永远是「未命名」

`session_service.py` 只在建会话时接受 `payload.title`，**没有任何一处自动生成**。
`sessionLabel.ts` 于是永远走「未命名 · 时刻」那一支。

---

## 1. 七期总览

已定的三件事（2026-09-03 拍板）：**MinerU 用本机 docker 跑**；**先做 P1**；
**引用角标用 ③ 这一档**（`①–⑳` + `㉑–㉟` + `㊱–㊿` 覆盖到 50，超出退回
`(51)` 这种形态——一轮里引到 50 段以上不现实）。

| 期 | 做什么 | 依赖 | 见效 |
|---|---|---|---|
| **P0** | 把一台 MinerU 跑起来，**只抓真实线形**，不写代码 | — | 拿到夹具 |
| **P1** ✅ | 切块口径与嵌入窗口对齐；反过度切分 | — | ⭐ 最大，立刻 |
| **P2** | `MineruBackend` 接进来：PDF + 页码 | P0 | 收 PDF |
| **P3** | 图片落对象存储，能在对话里看 | P2 | 看得见图 |
| **P4** | 引用展示重做：只列用到的页 | P2 | ⭐ 直接诉求 |
| **P5** | 会话自动命名 | — | 直接诉求 |
| **P6** | 检索质量（重排、父块回填） | P1 | 复量之后再定 |

**P1 与 P5 不依赖任何别的期，可以先开。** 尤其 P1——它是本清单里投入产出比最高的一项。

---

## P0 · 摸清 MinerU 的真实线形（不写一行 Python）

ADR-0043 的备选表里明写了不选「一期就写一个 MinerU 客户端」的理由：

> 没有真实端点可验，写出来的是一份猜的线形；而半吊子实现会让能力面报「接了」，
> 比缺席更难查。

所以第一步是**把线形抓下来**，不是写客户端。

### 做什么

1. 起一台 MinerU 的 web API。官方 docker 走 `vllm`，要 Volta 以上、8 GB 以上显存；
   `pipeline` 后端能在 CPU 上跑，一页几秒到几十秒。**装在哪台机器、有没有 GPU 要你拍板**（§8）。
2. 用一份**真实的现场 PDF**（最好一份原生文本的、一份扫描件）打一次：

   ```bash
   curl -X POST http://<mineru>:8000/file_parse \
     -F 'files=@现场手册.pdf' \
     -F 'backend=pipeline' -F 'lang_list=ch' \
     -F 'return_md=true' -F 'return_content_list=true' \
     -F 'return_images=true' -F 'return_middle_json=false' \
     -o /tmp/mineru-raw.json
   ```
3. **回包裁成夹具**落进
   `server/services/knowledge-server/tests/fixtures/mineru_file_parse.json`：留 2–3 页、
   把每张图的 base64 换成十几个字节的占位。它是 P2 那条契约测试的唯一输入。
4. 记一页事实：镜像与 tag、显存/内存占用、20 页 PDF 的耗时、`return_images` 这个参数
   在这一版**到底存不存在**、`response_format_zip=true` 那条路回的 zip 里有没有 `images/`。

### 要当场确认的四件事

- `content_list` 里每一项**是不是真的都带 `page_idx` 与 `bbox`**（文档说带，实测为准）。
- 图是随 JSON 回 base64，还是只能走 zip。**这决定 P3 的取图路径。**
- 表格 `table_body` 是不是 HTML，行列结构能不能直接拆。
- 超时与失败长什么样：打一份坏 PDF、打一份 300 页的，看它回什么。

### 验收

夹具文件进仓 + 一页事实记录。**这一期不写任何实现代码，也不改 `EXTERNAL_BACKENDS`。**

---

## P1 · 切块口径与嵌入窗口对齐（⭐ 先做这个）—— 已落地

**这一期不依赖 MinerU，改完重新解析一遍存量文档就见效。**

### 1.1 上限由嵌入档说了算，不再是一个写死的 2000

- `Embedder` 端口加一格 `max_input_tokens`（模型目录给不出时按配置，缺省 512）。
- 切块上限 = `max_input_tokens × 0.9`（留标题路径与拼接的余量），用 `tokens.estimated()` 折算。
- ⚠ 这不是「把数字改小一点」。今天那个截断**已经在发生**，只是发生在端点里、没人看得见；
  这一步是把它搬到切块层，搬到看得见的地方。

**加一道运行期硬断言**：任何一块 `estimated(text) > max_input_tokens` 就把这份文档判
`failed` 并说清楚。理由与 ADR-0045 让「算不出向量」判 failed 同源——一份**悄悄少了
四分之三**的文档，与一份好文档在界面上长得一模一样。

### 1.2 加下限，反过度切分

- `MIN_CHUNK_TOKENS`（建议 ≈ 80，约 80 汉字）。
- `_cuts_here` 改成「换了标题路径 **且** 已经攒够下限」才断。
- 纯标题块（一个标题后面紧跟着另一个标题）**并进下一块**，不单独成块。
- 攒跨了标题时，`heading_path` 取这几块的**公共祖先**，不取第一块的——取第一块的会
  让引用指向上一节（`_carried` 那条注释里已经写过这个坑，这里是同一个坑的另一面）。

### 1.3 重叠按字符真正生效

`_carried` 改成从上一块尾部截 `overlap` 个字符（在标点或换行处对齐，不在半个词中间），
作为下一块的开头。**仍然只在同一条标题路径内带**——跨节带的话下一节开头会挂着上一节
的结论，那正是「引用指错地方」的来路。

### 1.4 单行超窗也要断开（**表格行攒批挪到 P2**）

`RowChunker` 保持一行一块，只多做一件事：一行本身超窗时先在句读处断开
（一格里粘着整篇说明是现场常事）。

⚠ **攒批这件事挪到 P2**：攒了批之后引用只能说「第 3–18 行」，而 `Locator`
今天没有 `row_end` 这一格。加它会连着改 `LocatorOut` → `openapi.json` →
前端契约，属于对外契约变更；而 P2 本来就要为页码加 `page_end`，两件事一起做
只动一次契约。在那之前攒批会让引用**指不出是哪一条**，那比行块短更糟。

⚠ 另外：`rows` 与 `window` 两路今天都**走不到**——摄取管线写死
`_chunked(parsed, "")` 用默认那一路，而 `kb_bases` 上没有「这个库用哪种切法」
这一列。它们是注册表里的备选，不是活路径。

### 1.5 观测

摄取完成时记一条 `ingest_chunked`：`chunks`、`p50_chars`、`p95_chars`、`over_window`
（这一格应恒为 0）。⚠ `event` 是稳定字面量，指标只用低基数标签。

### 契约测试

- 一份构造的长文档 → 每一块都 ≤ 窗口（**这一条今天必红**）。
- 一份满是短标题的文档 → 不含短于下限的块（末块除外）。
- 相邻两块有 N 字公共的尾/头 —— 重叠真的存在。
- 一张 200 行的表 → 块数远小于 200，且每一块都带表头。

### 实测结果（拿库里那份真报告，从对象存储取原件重跑一遍）

| | 旧 | 新 |
|---|---|---|
| 块数 | 14 | 24 |
| 最长一块 | 2031 字 / 1113 token | 836 字 / **445 token**（上限 460）|
| 超窗的块 | **7 块（半数）** | **0** |
| 过短的块（<80 字）| 3 块（25/29/32 字）| **0** |
| 中位长度 | 约 500 字 | 682 字 |
| **端点真正吃进去的比例** | **62%** | **100%** |

最后一行是这一期的全部意义：这份文档 6668 token 里，端点以前只吃进 4111——
剩下的 2557 token **既没报错也没进向量**。

### 存量数据

老块仍是旧口径。P1 上线后**要把已有文档按「重新解析」全量重跑一遍**，否则改了等于没改。
本部署只有 1 份文档，代价可以忽略；将来库大了要按库分批。

---

## P2 · MinerU 接进来：PDF 与页码

依赖 P0 的夹具。**不动任何调用方**（ADR-0043 决策一至三已经把缝留好了）。

### 2.1 `parsing/mineru.py`

实现 `ExternalParserBackend`：`async def parse_remote(raw, timeout_s)`。

**⚠ 吃 `content_list`，不吃 `md_content`。** `md_content` 里没有 `page_idx`
（MinerU 自己的文档说得很清楚，也没有参数能让它加），用它就等于在这一步把页码丢了——
而 ADR-0033 说这一格丢了后面任何一层都补不回来。这条也正是 ADR-0043 决策二
「不许把产出放宽成一坨 markdown 字符串」的实例。

翻译表：

| `content_list` 项 | → `Block` |
|---|---|
| `text` + `text_level ≥ 1` | `heading`，`level = text_level` |
| `text` + 无 `text_level` | `paragraph` |
| `equation` | `paragraph`，正文取 `text`（LaTeX） |
| `image` | `figure`（新 kind），正文取 `image_caption` 拼接 |
| `table` | `table_caption` → `caption`；`table_body`(HTML) → 若干 `table_row`；表图另出一个 `figure` |

- `locator.page = page_idx + 1`（MinerU 从 0 起）。
- `locator.bbox = bbox`（归一化到 0–1000）。**现在就存，UI 以后再说**：与 `locator` 同理，
  解析时丢掉，后面补不回来；一格四个数字的成本可以忽略。
- 标题栈用 `structure.pushed` / `path_of` 维护 → `locator.path`。
- 失败一律翻成 `ExternalParseFailed`；**自己守住 `timeout_s`**；**绝不自己重试**。

### 2.2 ⚠ MinerU 只声明 `.pdf` 与图片后缀，不声明 Office

`external_for()` 让**外部那一路排在本地之前**。MinerU 2.x 确实能吃 docx/pptx（走
LibreOffice 转换），但声明了就会把它们从本地那三路手里抢走——而本地那三路解得更准
（真实的标题层级、表格结构、页眉页脚），而且不花 GPU 时间。

```python
suffixes = (".pdf", ".png", ".jpg", ".jpeg")
```

### 2.3 `Block` / `Locator` 的两处扩集合

- `BlockKind` 加 `"figure"`。⚠ 它是**闭合集合**，加一个要把每一个 chunker 过一遍。
  实测只有 `structural.py` 两处 switch on kind（97 行与 126 行），改动面很小。
- `Locator` 加 `page_end: int | None` 与 `bbox`。
  `page` 是起页、`page_end` 是止页，`label()` 出「第 4–6 页」。
  切块时 `_flush` 取**第一块的页当起、最后一块的页当止**——这就修掉了 §0.4。

### 2.4 ⚠ 注册表要从常量改成 builder，而这里埋着一个静默的坑

MinerU 要 `base_url`，所以 `EXTERNAL_BACKENDS`（常量元组）要变成
`external_backends(settings)`（与 `build_indexes(dimensions)` 同形）。

**改的时候必须连着改这三处调用点**，否则会出现「接了 MinerU，界面还是不收 PDF，
传上去还被拒，而两边单看都对」：

| 位置 | 现在 | 问题 |
|---|---|---|
| `capability.py:179` | `accepted_suffixes()` | 不传参 → 吃模块默认的空元组 → **界面 accept 名单里没有 `.pdf`** |
| `document_service.py:106` | `accepted_suffixes()` | 同上 → **上传校验当场拒掉 PDF** |
| `worker.py:114` | `external_parsers=EXTERNAL_BACKENDS` | 常量 → worker 那一侧**根本没有 MinerU** |

加一条契约测试：配了 MinerU 之后，`/capabilities.accepted_suffixes` 里必须有 `.pdf`，
且 `document_service` 的校验必须放行 `.pdf`。**这条测试就是这个坑的闸门。**

### 2.5 配置

```
KNOWLEDGE_MINERU_ENABLED=false
KNOWLEDGE_MINERU_BASE_URL=
KNOWLEDGE_MINERU_BACKEND=pipeline
KNOWLEDGE_MINERU_LANG=ch
KNOWLEDGE_MINERU_FORMULA_ENABLED=true
KNOWLEDGE_MINERU_TABLE_ENABLED=true
# 既有的那一格终于有生效路径了
KNOWLEDGE_EXTERNAL_PARSE_TIMEOUT_S=180.0
```

⚠ 开关开着却没给 `base_url` = **启动即失败**，与 ASR 那一路同一条规矩
（config-and-secrets §1：缺失即退出，不给 WARN continue）。
两份 `.env.example`（根与服务）与 `docker/compose.yml` 一起改——闸门
`check_config_secrets` 守着「样例必须列全」。

### 2.6 部署

MinerU 是**第三方镜像**，与 `minio/mc` 同档：**tag 钉死具体版本，禁 `latest`**。
建议单开一个 compose profile（`--profile mineru`），因为它要 GPU、体量大、
且没有它整套仍然能跑（只是不收 PDF）。

### 验收

真传一份 PDF → `kb_chunks.locator_json.page` 有值 →
`POST …/knowledge-bases/{id}%3Asearch` 回来的 `locator.label` 是「第 N 页」。

---

## P3 · 图片落对象存储，能在对话里看

### 3.1 落点：`knowledge/` 前缀下，**不匿名可读**

```
knowledge/{base_id}/{document_id}/figures/{content_hash[:16]}{.ext}
```

⚠ 桶策略只给 `models/`、`images/`、`icons/` 三个前缀开了匿名读
（`docker/compose.yml` 的 `minio-init`）。知识库原件与插图**一律不进那三个前缀**——
里面可能是涉密图纸，而边缘那条 `/oss/` 是免认证 location。

`sources/keys.py` 加 `figure_key(...)` 与 `document_prefix(base_id, document_id)`；
删文档时 `delete_prefix(document_prefix(...))` + 删原件那一个键。
（原件键是 `knowledge/{base}/{doc}.pdf`，与目录前缀 `knowledge/{base}/{doc}/` 不冲突。）

### 3.2 两张新表（迁移只做扩展步）

```
kb_document_figures
  id uuidv7 pk
  base_id      → kb_bases      on delete cascade
  document_id  → kb_documents  on delete cascade
  ordinal      int                       -- 文档内序号，从 0
  kind         text  CHECK IN ('image','table')   -- ⚠ 禁原生 ENUM
  page         int null
  bbox_json    jsonb  default '{}'
  caption      text   default ''
  object_key   text
  media_type   text
  byte_size    bigint
  content_hash char(64)
  unique (document_id, ordinal)
  unique (document_id, content_hash)     -- 同一份文档里同一张图只留一行
  index  (document_id)

kb_chunk_figures
  chunk_id  → kb_chunks              on delete cascade
  figure_id → kb_document_figures    on delete cascade
  ordinal   int
  primary key (chunk_id, figure_id)
```

⚠ **不按页反查图**。一页上可能有五张图，而这一块只讲其中一张——按页反查会把另外四张
也贴到引用里，那正是「依据里堆一堆没用的东西」。联结表记的是「这一块的正文里真的
出现了这张图」。

### 3.3 取图端点

```
GET /api/v1/knowledge/documents/{document_id}/figures/{figure_id}
```

**推荐直接流字节**，不发预签名 URL：预签名 URL 一旦生成就是一条「谁拿到谁能看」的链接，
而流字节每一次都经边缘的 `auth_request` 判 `knowledge:read`。图一般几十 KB，
过一趟服务的代价可以接受。带 `ETag`（用 `content_hash`）与
`Cache-Control: private, max-age=…`，否则每展开一次引用就重下一遍。

### 3.4 管线里多一段

写图排在**切块之前**（切块要引用 figure id），算在 `parsing` 这一段里——
**不新增状态**：`status` 那条 CHECK 与前端文案都得跟着改，而写图本来就是解析产出的一部分。

幂等：按 `content_hash` 复用已有对象，不重复上传。重新解析时先按 `document_id` 清行
（对象按 hash 留着，下一轮多半还用得上）。

### 3.5 前端

- ⚠ **不让模型往答案 markdown 里写图片链接**——它会编 URL。图只从结构化的引用里出。
- `DtMarkdown` 现在**没有 image 分支**（`blocks.ts` 的 `MdBlock` 是七种，没有 image），
  这一期也不加。
- 引用卡片里一排缩略图，点开放大，复用 `DtModal`（与 `AiToolCard` 的截图放大同一形态）。

---

## P4 · 引用展示重做：只列用到的页

这是你说的「依据展示不好看」那一条的正解。

### 4.1 现在为什么难看

答案下面挂的是**工具卡**（`AiToolCard.vue`），它把 `kb.search` 的整包回执摊成一段文本——
查到几条就列几条，**包括模型看过一眼就丢掉的那些**。而「用到了哪几条」这个信息
今天在数据里根本不存在。

### 4.2 服务端：让「用到了」变成一个事实

1. `kb.search` 每条回执加一格 `ref`：本回合内的短标记（`S1`、`S2`…），
   由 `KnowledgeTools` 实例上的计数器发。
   ⚠ 它天然是回合作用域的——`advance_service` 里 `deps.tools(loaded.scope)`
   **每一轮现造一份**注册表。
2. 提示词改成硬要求：每句结论后面挂 `[[S3]]`，**并且不要再自己在末尾抄一份「参考资料」**——
   今天那份列表是模型手写的，又长又会编。
3. 回合结束时（`advance` 的生成器里、`persist` 之后、收摊之前）：
   - 从答案文本扫出全部 `[[Sn]]`；
   - 用这一轮 `kb.search` 的回执把它们解析成 `chunk_id`；
   - 打库补齐文档标题、`locator`（页起止）、`heading_path`、这一块挂的 figures；
   - 落进那条助手消息的 `content_json.citations`（**回放要用**）；
   - 多吐一个 SSE 事件 `citations`。
   - ⚠ **扫不出标记 = 不出引用块**，而不是退回「把查到的都列出来」。
     后者正是今天这个样子。
   - ⚠ 解析不出的标记**直接丢掉**，不画一个点不动的角标。

### 4.3 收敛规则（「只展示使用到的页码」）

1. 按 `document_id` 分组；
2. 每组把被引块的页区间**合并成不重叠的区间**（4–6 与 6 合成 4–6，4–6 与 9 保持两段）；
3. 一份文档一行：`《现场手册》 第 4–6、9 页`；
4. **展开**才看得到那几块的原文与图。

没有页码的格式（docx / md / xlsx）退回标题路径与工作表行号——`Locator.label()`
已经是这么拼的，前端不再各拼一份。

### 4.4 前端

- 新件 `KnowledgeCitations.vue`，挂在助手回复**下面**，不是工具卡里。
- `DtMarkdown` 的行内规则加一条 `[[Sn]]` → 上标角标，点它滚到对应引用行并高亮。
  ⚠ 这是**共用包**，助手那一侧也会走这条规则；要加一条契约测试证明
  「不带标记的文本一个字都不变」。
- `kb.search` 的工具卡产出压成一行摘要（「查到 6 条，来自 2 份文档」），
  展开才看全文——**过程仍然看得见，但不再占屏**。
- `replayLog.ts` 要从存下来的 `citations` 重建引用块，否则切回旧对话引用就没了。

---

## P5 · 会话自动命名

### 做什么

在 `advance` 里，`persist` 之后、生成器收摊之前：

1. 只在 `title == ''` **且**这是这个会话的第一轮时做（用户手填过的**绝不覆盖**）。
2. 拿这一轮的问句 + 答案前 200 字，调 `container.responder`
   （`ModelChoice(kind="summary")`，**复用摘要那一档，不另开一路模型**），
   要一句 ≤ 16 字的主题。
3. 兜底：模型挂了 / 超时 / 回了空 → 取用户第一句话的前 16 字。**永远不留空。**
4. 落库时推进 `row_version`（前端那把乐观锁靠它），
   多吐一个 SSE 事件 `session_titled`，前端就地改清单那一行，不用重拉。

### 为什么不放后台任务

`create_task` 要存强引用、要处理关停时的丢失，而这件事本来就发生在流还开着的时候——
顺手做完最简单，代价是回合末尾多约 1 秒。

### ⚠ `sessionLabel.ts` 那条「未命名 · 时刻」保留

自动命名**会**失败（模型抖一下），而失败时一排空白仍然分不清哪个是哪个。

---

## P6 · 检索质量（等 P1 落地、重新量过再定）

1. **接上重排（零代码）。** `knowledge.rerank` 这个用途今天没分配（§0.7）。
   在模型管理页配一个就生效，`hybrid` 会自动多召一批再排（`hybrid.py` 已经
   写好了）。**建议 P1 合并后立刻配上，作为效果对照的一部分。**
2. **父块回填（small-to-big）。** 用小块做向量命中，回填时给出它所在那一节的整段。
   要给 `kb_chunks` 加一格 `parent_ordinal` 或一张节表。
   ⚠ **不要现在做**：P1 把窗口对齐之后要重新量一次召回，那时才知道还缺不缺这一层。
3. **查询侧改写。** `agentic` 已经让模型自己改写；`hybrid`（工具直调走的就是它）没有。
   同上——**先量再说**。

---

## 7. 明确不做

| 不做 | 为什么 |
|---|---|
| 让模型在答案 markdown 里写图片链接 | 它会编 URL，而编出来的链接与真链接长得一样 |
| PDF 原文查看器 / bbox 高亮 | bbox 先存下来（P2），UI 是另一件事 |
| 给 MinerU 加自动重试 | 一条链路只有一层负责重试，而那一层是人按「重新解析」那一下 |
| 让 MinerU 接管 Office | 本地那三路解得更准且不花 GPU；外部排在本地之前，声明了就会抢 |
| 把 `md_content` 当解析产出 | 那一步就把 `page_idx` 丢了，后面补不回来 |
| 为写图新增一个摄取状态 | 状态是线上契约（CHECK + 前端文案），而写图本来就属于 `parsing` |

---

## 8. 要你拍板的五件事

1. **MinerU 装在哪、有没有 GPU。** 官方 docker 走 vllm，要 Volta 以上 + 8 GB 显存；
   `pipeline` 后端能跑 CPU，但一页几秒到几十秒。这决定 P0 怎么起。
2. **取图走流字节还是预签名 URL。** 我推荐流字节（每次都过权限），代价是字节过一趟服务。
3. **存量文档要不要全量重解析。** P1 落地后老块仍是旧口径。本部署只有 1 份文档，
   建议直接重跑；将来库大了要按库分批。
4. **角标形态：`[[S3]]` / `[3]` / `③`。** `[[Sn]]` 与正文冲突概率最低，但最丑；
   `③` 好看但模型打字容易漂。
5. **现在就配 `knowledge.rerank` 吗。** 零代码，纯配置，且是 P1 效果对照的一部分。

---

## 9. 一期一个 PR，以及它们的闸门

| PR | 范围 | 只碰 | 逐行评审项 |
|---|---|---|---|
| P0 | 夹具 + compose profile | docker/、tests/fixtures/ | — |
| P1 | 切块层 | `services/chunking/`、`services/embedding/ports.py` | 无 |
| P2 | 解析层 + 注册表 builder | `services/parsing/`、装配三处 | 对外契约（accept 名单） |
| P3 | 迁移 + 对象存储 + 取图端点 | 迁移、`crud/`、`api/documents.py` | **迁移、对外契约** |
| P4 | 引用链路（后端 + 前端） | `apps/chat/`、`web/…/KnowledgeChat/`、`DtMarkdown` | 对外契约 |
| P5 | 自动命名 | `apps/chat/services/` | 无 |

⚠ P3 与 P4 都会超 400 行。按本仓既有先例（新模块落地、UI 统一），
**PR 描述里写清豁免理由，并把铺路的改动先单独开 PR**。

每一期合并前本地跑 `scripts/ci-local.sh --all`；⚠ 分支与 PR 上不触发流水线，
合进 main 之后要盯那一轮。
