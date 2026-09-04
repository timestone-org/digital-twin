# 部署编排

## edge-gateway

唯一的入口。它做**且只做**：TLS 终结、按前缀反向代理、`auth_request` 前置鉴权、
公开面限流、前端静态资源发布。任何需要读库才能回答的问题都不属于边缘。

`nginx/nginx.conf.template` 是 envsubst 模板，由官方镜像在启动时渲染。

> ⚠ 必须设 `NGINX_ENVSUBST_FILTER='^(AUTH_|OSS_)'`，且过滤器只能这么窄：放开的话
> `$uri` / `$host` 这些 nginx 变量会被 envsubst 一起替换成空串，表现为
> 「路由全乱、鉴权全过」。

### 三处不能改的配置

1. **server 级把 6 个 `X-Auth-*` 头置空**。客户端伪造这些头就等于伪造身份；
   只在 `auth_request` 成功后由 `auth_request_set` 重新注入。
2. **免认证 location 只有那几条**。规则表里的空 `permission_codes` 语义是
   「任意已登录用户放行」而**不是**匿名放行——匿名可达性只由这些 location 保证。
   删掉 `/sessions` 那条就会全站无法登录，且管理员自己也进不去。
3. **`/internal/` 一律 deny**。`/verify` 与权限回查都挂在那下面，
   它们只认服务级密钥，对外暴露等于把鉴权端点交给公网。

### 缓冲区

`/verify` 的响应头里带 base64 编码的权限集，默认 4k 的 `proxy_buffer_size`
会截断它。配置里显式设了 8k。

### `.mjs` 的 media type

nginx 自带的 `mime.types` 里**没有 `.mjs`**，于是 ES 模块被按 `default_type`
发成 `application/octet-stream`，而浏览器对模块脚本做严格 MIME 检查、当场拒收。
模板的 http 块里补了一条 `types { text/javascript mjs; }`。

⚠ 表现极难对上号：不是 404 也不是 5xx，只是那个模块「没生效」——实测是 pdf.js 的
worker 加载失败、知识库的 PDF 预览一律画不出来，而访问日志里那条请求是干干净净的
200。⚠ 不能挪进 `server` / `location`：`types` 块会**丢掉整份继承**。

## compose

```bash
cd docker
cp ../.env.example .env   # 填数据库、Redis、对象存储、外部 EMS 库与几个密钥
docker compose up -d --build

# 要 MinerU（PDF 与扫描件的解析后端，ADR-0043）才加这个 profile：
# 镜像 2.4 GB、权重另有 2.4 GB，而没有它整套照样跑得起来，只是不收 PDF
docker compose --profile mineru up -d --build
```

共享值（`AUTH_EDGE_SERVICE_KEY` 等）的回退链**必须每个服务都写全**：
少写一处就是非对称失效——发送端有值、接收端没有，一律 403，
而现象与原因隔得极远。

### 必配项

密钥与地址类**都没有默认值，缺失即拒绝启动**——进程会在第一秒把缺的变量名逐个
打到 stderr 并以退出码 2 退出，编排器据此判定启动失败。

| 变量 | 谁读它 | 说明 |
|---|---|---|
| `POSTGRES_*` / `REDIS_*` | 全部七个代码单元 | 一库多 schema、一个 Redis 实例同一个 `db` |
| `AUTH_JWT_SECRET` / `AUTH_EDGE_SIGNING_SECRET` / `AUTH_EDGE_SERVICE_KEY` | auth（后两个 platform ×3 / opcua / realtime / assistant / knowledge ×2 / 边缘也读） | 各 32 字节以上 |
| `OSS_ENDPOINT` `OSS_ACCESS_KEY` `OSS_SECRET_KEY` | `minio-init` / platform ×3 / knowledge ×2 | 对象存储在本编排之外（ADR-0015）。`OSS_UPSTREAM` 另给边缘，**只能是 `host:port`、不带 scheme**——带了 nginx 直接起不来 |
| `COLLECT_CREDENTIAL_SECRET` | platform ×3 | 数据源口令的加密密钥（≥32 字符）。换钥后旧密文解不开，界面上重填即恢复 |
| `LLM_PROVIDER_SECRET` | platform ×3 | 模型供应商目录的加密密钥（ADR-0039）。留空即目录整个缺席 |
| `AUTH_SEED_ADMIN_PASSWORD` | `auth-migrate` | **绝不给默认值**——弱默认的管理员口令等于没有口令 |
| `ACSOURCE_HOST` `ACSOURCE_USER` `ACSOURCE_PASSWORD` `ACSOURCE_DB` | platform | 现场 EMS 的 SQL Server，**只读**；compose 把它们转成 `PLATFORM_SQLSERVER_*` |
| `ACSOURCE_PORT`（默认 1433）`ACSOURCE_TIMEZONE`（默认 `Asia/Shanghai`） | platform | 有默认值，取值差异不是行为差异 |

⚠ `ACSOURCE_TIMEZONE` 是**外库时间列的时区口径**，不是展示时区。外库存的是没有
时区信息的当地时，对外一律 UTC，填错的表现是整屏数据平移几个小时而不报任何错。

⚠ EMS 不可达**不影响启动，也不影响就绪**：空调数据面返回 503，台账页与空间配置页
照常工作（[ADR-0009](../docs/adr/0009-空调原始数据由平台直读外部EMS库.md)）。

### 迁移与种子

容器起来**不会**自己建表。每个服务各有一条迁移链，各自只碰自己的 schema：

```bash
docker compose run --rm auth-server      alembic upgrade head
docker compose run --rm auth-server      python -m scripts.seed
docker compose run --rm platform-server  alembic upgrade head
docker compose run --rm platform-server  python -m scripts.seed
docker compose run --rm opcua-server     alembic upgrade head
docker compose run --rm realtime-hub     alembic upgrade head
docker compose run --rm collector-server alembic upgrade head
docker compose run --rm ai-assistant     alembic upgrade head
docker compose run --rm knowledge-server alembic upgrade head
```

⚠ **`collector-server` 那条别漏。** 它建的是独立的 `collect` schema 与点位历史超表，
建表时会 `CREATE EXTENSION timescaledb`；漏跑的表现是采集容器健康、日志也不报错，
但一条历史都落不进去。

⚠ **`knowledge-server` 那条要库上装得了 pgvector。** 它建 `vector` 与 `pg_trgm`
两个扩展（**装进 `knowledge` 这个 schema，不是 `public`**）、建向量表与三个索引
（[ADR-0045](../docs/adr/0045-向量与关键词索引改为硬依赖.md)）。装不上就**响亮
失败**——没有「退化成不带索引也能跑」那一档，因为那种退化在界面上与真检索长得
一模一样。

⚠ **`KNOWLEDGE_EMBEDDING_DIMENSIONS` 在跑迁移那一刻定死**：建的是 `vector(N)`，
N 取自这一格，所以迁移作业的 `environment` 里也列了它。它必须等于模型管理页上
分配给「知识库嵌入」的那个模型的维数，否则一份文档都摄不进来，撞的是一条
「expected N dimensions」——而那条错不会提到你配的是哪个模型。改维数要重跑一次
迁移、并把已有文档全部重新解析，**所以先定好再灌数据**。

⚠ **每次上新功能都要重跑种子。** 权限码与路由规则表（闸 1）存在**数据库里**，
由 auth-server 的种子脚本全量覆盖（可重复执行；人工新建的规则不受影响）。
新服务、新端点上线后不跑，边缘查不到规则，而 auth-server 的口径是**无规则一律
拒绝**——表现是那一片接口**全部 403**，而直连服务端口却是好的，于是现象看起来
像「前端坏了」。

### realtime-hub 的两处部署前置

**`/api/v1/realtime/ws` 是一条免认证 location，这不是漏了 `auth_request`。**
WS 的 token 走 `Sec-WebSocket-Protocol` 子协议，而 `auth_request` 的子请求带不上它——
挂上去的结果是所有握手一律 401。认证在 hub 内部完成：它自己验签名、验过期、
按每个主题声明的权限码判订阅。

**WS 那条 location 的读写超时是 3600s，不是共用的 25s。** `proxy-common.conf` 里那个
值是给请求-响应用的；套在长连接上，**每条空闲 25 秒的连接都会被切断**，表现是
「前端每隔半分钟重连一次」，查起来会一路怀疑到应用层。客户端的心跳周期必须小于它。

### opcua-server 的两处部署前置

**端口段必须与 `OPCUA_PORT_POOL` 逐字一致。** compose 里的 `ports` 映射决定了哪些端口
真的能从外面连进来；配置里的池只是服务自己的账本。两者不一致时，服务会把池外的端口
分配出去、状态显示「运行中」，而上位机连不上——这是最难排查的一类故障。

**`opcua-pki` 卷装着全部实例的服务器私钥。** 它不进镜像层、不进数据库，也因此
**不随数据库备份一起走**。卷丢了等于全部实例的证书作废，每台上位机都要重新信任新证书。
备份策略要单独覆盖它。

### ai-assistant 接几路模型

助手整套是**可缺席**的：不起这个服务，前端探测不到就干净地不出现入口，别的功能
一件不少。起了它，**接几路模型在界面上配**：系统管理 → 模型管理 里新建供应商，
先选类型（OpenAI 兼容端点 / Codex 订阅），再配这一类要的那几项
（[ADR-0040](../docs/adr/0040-供应商按接入形态配置且档位即供应商.md)）。
配出来的每一路都是面板下拉里的一档，会话自己选走哪一路。

下面这两组环境变量是**按类型逐格**的永久默认值：目录里配了同一类型的供应商就以
目录为准，一路都没配时才轮到它们。存量部署一行不改也照常跑。

| 变量 | 说明 |
|---|---|
| `ASSISTANT_MODEL_ENABLED` / `ASSISTANT_MODEL_API_KEY` | 按量计费那一路。开关为真却没配密钥（**空串同档**）= 启动即失败 |
| `ASSISTANT_MODEL_BASE_URL` / `_CHAT` / `_VISION` / `_TIMEOUT_S` | 端点与模型代号。换供应商是改这几行，不是改代码 |
| `ASSISTANT_MODEL_STREAM_ENABLED` / `_EXTRA_BODY` | 逐字流式开关、透传的额外请求体（一段 JSON 对象） |
| 订阅账号那一路 | **不在环境变量里**：去「系统管理 → 模型管理」建一路「Codex 订阅」形态的供应商并登录一次（ADR-0041），加密用的是 `PLATFORM_LLM_PROVIDER_SECRET` |
| `ASSISTANT_CODEX_REASONING_EFFORT` | 那一路没配推理档位时的缺省（`low`/`medium`/`high`/`xhigh` 闭合集合） |
| `LLM_PROVIDER_SECRET` | 模型供应商目录的加密密钥（ADR-0039）。**配上它才配得出供应商**；留空即目录整个缺席，两边各用各的环境变量 |

⚠ **`ASSISTANT_MODEL_*` 与 `KNOWLEDGE_*` 那两组模型变量是目录的永久默认值**：目录里
没给某个用途分配时才用它们，分配了就走目录。存量部署一行不改也照常跑。

⚠ **宿主 `.env` 里配了不等于容器里有。** compose 不给服务挂 `env_file`，每个变量
都要在 `ai-assistant` 的 `environment` 里逐条列出来；漏列的表现是页面上那一路
始终「未启用」，而 `.env` 单看是配好的、两边都不报错。加新配置项时记得同时改
`compose.yml`、根目录的 `.env.example`，还有这张表。

⚠ **订阅那一路配好之后还要登录一次。** 去 系统管理 → 模型管理 页面，在那一路
供应商下面走设备码登录（需要 `llm:manage`）；不登录的话面板上这一路是灰的，
标「未登录」。令牌整包加密存在 `platform.llm_provider_credentials`，**一路供应商
一行**、助手与知识库共用（ADR-0041）——换掉 `PLATFORM_LLM_PROVIDER_SECRET` 等于
那些行解不开，界面上会变回「从来没登录过」。

⚠ **`ASSISTANT_MODEL_TIMEOUT_S` 要小于边缘那条事件流 location 的
`proxy_read_timeout`（300s）**，否则边缘先掐断，服务端这条超时与它的失败分档一次
都轮不到，而现象是「助手转了半分钟然后什么都没发生」。

### knowledge-server 的四处部署前置

**一份镜像两个角色，`KNOWLEDGE_APP_ROLE` 分叉，两个都要起。**
`api` 只做读写与检索；解析、切块、嵌入、来源同步全在 `worker`
（[ADR-0032](../docs/adr/0032-知识库独立成代码单元且LLM客户端下沉domain.md)）。
只起 api 的表现是**检索面好好的、传上去的文档永远停在「处理中」**。
⚠ 两个角色**共用一份 Settings**，所以对象存储那四项每个角色都要给全，
哪怕 worker 一个字节都不读——`compose.yml` 里那两段是逐条抄齐的，改一处要改两处。
⚠ worker **可以多副本**（消费组自动分活），这与 publisher 那种单活租约不是一回事。

**pgvector 是硬依赖。** `knowledge-migrate` 装 `vector` 与 `pg_trgm` 并建三个索引
（[ADR-0045](../docs/adr/0045-向量与关键词索引改为硬依赖.md)）。库上装不了 = 迁移
失败 = 知识库整个起不来。**这是有意的**：如果留一条「装不上就不建索引也照跑」的
回退档，它在界面上与真检索长得一模一样，坏了没人看得出来。⚠ 扩展装进 `knowledge` 这个 schema 而不是 `public`——应用连库时
`search_path` 恰好只有本服务那一个 schema，装错地方报的是「type vector does not
exist」，与「装没装扩展」这件事看着毫无关系。

**桶与素材共用，但 `knowledge/` 前缀不许匿名可读。** 原件与插图落在同一个桶的
`knowledge/` 下，一律经 knowledge-server 的受管端点取字节。匿名可读的**只有**
`models` / `images` / `icons` 那三个给现场大屏机取素材的前缀。

**四组能力开关，每组都是「开着却不给地址/密钥 = 启动即失败」。**

| 开关 | 关着时 |
|---|---|
| `KNOWLEDGE_EMBEDDING_ENABLED` | 文档照常摄取，检索**如实**回「这个库还没建索引」——不是返回空表，空表与「确实没有相关内容」长得一模一样 |
| `KNOWLEDGE_MODEL_ENABLED` | agentic 检索策略**如实不可用**，不悄悄退化成 naive |
| `KNOWLEDGE_MINERU_ENABLED` | 不收 PDF：上传面给的是一句点得出名字的错，而不是一份状态 ready 却检索不到的空文档 |
| `KNOWLEDGE_ASR_ENABLED` | 对话页没有麦克风键 |

⚠ **真正走哪一路由模型目录说了算**（ADR-0039）：`KNOWLEDGE_EMBEDDING_*` /
`_MODEL_*` 只是目录里没给这个用途分配时的永久默认值。
⚠ **`KNOWLEDGE_MODEL_CONTEXT_TOKENS` 不要凭印象填**：`0` = 不知道、一格都不收紧；
本地 llama.cpp 看 `/props` 的 `n_ctx`，它是启动参数，多半远小于模型的训练长度。
填大了等于没填，表现是窗口小的模型**每次都在同一步失败**，而端点回的 400 与长度
毫无关系。
⚠ **浏览器开麦要 HTTPS 或 localhost**，这是浏览器的安全上下文要求，与本仓无关：
`http://` 的页面上 `getUserMedia` 根本不存在。现场部署要给边缘配 TLS。

## 迁移与种子（自动）

`docker compose up` 会先把七个一次性作业跑完，再放真服务进来：

| 作业 | 做什么 |
|---|---|
| `auth-migrate` / `platform-migrate` | `alembic upgrade head` + `python -m scripts.seed` |
| `opcua-migrate` / `collect-migrate` / `realtime-migrate` / `assistant-migrate` / `knowledge-migrate` | 各自 `alembic upgrade head` |

⚠ **一个代码单元一个作业，各用自己的镜像**：七套迁移分属七个 schema，合成一个
作业就要求某一个镜像装得下全部七份代码。

另有两个跑完即退出的作业，与迁移同档：`minio-init`（建桶并把 `models` / `images`
/ `icons` 三个前缀设成匿名可读；⚠ `staging/` 与 `knowledge/` **刻意不在列**）、
`mineru-models`（下 2.4 GB 权重，只在 `--profile mineru` 下起）。

真服务用 `depends_on: {condition: service_completed_successfully}` 等它们，
这正是「迁移先行」那条规矩——代码可回滚、数据库不回滚，故必须先让新结构就位。
**改了表结构直接 `docker compose up -d --build` 即可**，不用再手动跑 alembic。

⚠ **种子必须跟着自动跑**：权限码目录与路由规则是**代码里的真源**，加了新端点却
没重跑种子，那个端点在边缘一律 403，而两边代码单看都对。

⚠ 种子对**已存在的管理员一个字段都不动**（`ensure_admin` 只在缺失时创建），
故重开机不会把密码改回 `AUTH_SEED_ADMIN_PASSWORD`。那个变量仍然必填——弱默认的
管理员口令等于没有口令。

⚠ 作业自己先等库：Postgres 与对象存储都在本编排之外，compose 没法给它们挂
healthcheck。主机重启时 Docker 常比 Postgres 先起来，不等就迁移会让**整栈拒绝启动**。
等待上限 120s（60 次 × 2s），超时即失败退出而不是无限重试。

只想单独跑某一个（不动正在跑的服务）：

```bash
docker compose run --rm --no-deps auth-migrate
```

⚠ 迁移**自动应用**意味着人工闸门只剩评审那一道。破坏性变更必须按扩展—收缩两次
发布（engineering-workflow §4），否则一次 `up` 就把它推上去了。
