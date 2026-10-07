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

### 嵌入页的响应头与日志

受支持业务页可按 [ADR-0051](../docs/adr/0051-任意业务页用API密钥换短期会话后嵌入.md) 以
`?token=<APIKey>&theme=<theme-id>` 进入嵌入模式。有限期与永久 API Key 都可使用，
HTTP/WS 与 HTTPS/WSS 都是受支持的部署形态。

边缘仅做四件可验证的泄漏缩减：

1. 带非空 `token` 或 `embed=1` 的静态入口下发 `Cache-Control: no-store` 与
   `Referrer-Policy: no-referrer`；
2. access log 记从原始请求剥掉 query 的稳定路径，不记 `$request_uri` /
   `$request`；两条公开大屏路径里的票据段进一步固定记成 `<redacted>`；
3. 普通页用 CSP `frame-ancestors 'none'`，带 token 或 `embed=1` 的入口以
   `frame-ancestors *` 允许外域 iframe。原有 `/public/<token>` 大屏也保持可嵌入。
4. 精确的 `POST /api/v1/auth/sessions:from-api-key` 换票路径单列 IP 限流：
   `60r/m`、`burst=20`、超限回 429；该 location 仍 `include auth-inject.conf`，
   绝不是免认证入口。

是否为 `/public/` 要用从原始 `$request_uri` 剥掉 query 得到的
`$original_path` / `$dt_original_path` 判断，不许改成 `$uri`。SPA 的
`try_files` 回落会把 `$uri` 内部改成 `/index.html`，拿它判断会让公开大屏在响应阶段
静默掉回 `frame-ancestors 'none'`。

前端换到短期 access 后会从地址栏移除 `token`、保留 `theme` 并写入
`embed=1`。边缘必须继续认这个标记，否则跨域 iframe 内硬刷新会在前端给出
「凭据已不在内存」的错误页之前，先被 CSP 拦成空白页。

⚠ `frame-ancestors *` **不是父页授权**。本方案没有 origin 白名单，nginx 无法判断
哪个页面可信；拿到 URL 的页面都能嵌入。这些头也清不掉浏览器历史、截图、
上一层反向代理/WAF 或错误日志中的副本。建议为每个嵌入方创建专用最小权限账号并
保留可用的吊销路径。Linux 和 Windows 两份 nginx 配置必须同步改动。

⚠ HTTP 下的嵌入 URL 和 API 密钥会以明文经过网络，被动抓包即可复制。永久密钥
泄漏后不会自动到期，只能人工吊销。HTTPS 仍是推荐部署形态，但不是嵌入的运行时前置。

## compose

```bash
cd docker
cp ../.env.template .env   # 填数据库、Redis、对象存储、外部 EMS 库与几个密钥
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
| `LLM_PROVIDER_SECRET` | platform ×3 | 模型供应商目录与凭据的加密密钥（ADR-0041）。留空即目录整个缺席 |
| `AUTH_SEED_ADMIN_PASSWORD` | `database-migrate` | **绝不给默认值**——弱默认的管理员口令等于没有口令 |
| `ACSOURCE_HOST` `ACSOURCE_USER` `ACSOURCE_PASSWORD` `ACSOURCE_DB` | platform | 现场 EMS 的 SQL Server，**只读**；compose 把它们转成 `PLATFORM_SQLSERVER_*` |
| `ACSOURCE_PORT`（默认 1433）`ACSOURCE_TIMEZONE`（默认 `Asia/Shanghai`） | platform | 有默认值，取值差异不是行为差异 |

⚠ `ACSOURCE_TIMEZONE` 是**外库时间列的时区口径**，不是展示时区。外库存的是没有
时区信息的当地时，对外一律 UTC，填错的表现是整屏数据平移几个小时而不报任何错。

⚠ EMS 不可达**不影响启动，也不影响就绪**：空调数据面返回 503，台账页与空间配置页
照常工作（[ADR-0009](../docs/adr/0009-空调原始数据由平台直读外部EMS库.md)）。

### 迁移与种子

迁移随 `docker compose up` 自动执行，操作方法见下方「迁移与种子（自动）」。
数据库必须支持 TimescaleDB、pgvector 与 pg_trgm；知识库扩展安装在 `knowledge`
schema，`KNOWLEDGE_EMBEDDING_DIMENSIONS` 必须与所用嵌入模型维数一致。
维数变更需要专门迁移及重新解析已有文档，不能仅改环境变量。

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
（[ADR-0041](../docs/adr/0041-订阅账号凭据归平台持有.md)）。
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
| `LLM_PROVIDER_SECRET` | 模型供应商目录与凭据的加密密钥（ADR-0041）。**配上它才配得出供应商**；留空即目录整个缺席，两边各用各的环境变量 |

⚠ 两侧的环境变量都是永久默认值，但让位口径不同：助手的 `ASSISTANT_MODEL_*`
按**接入形态**让位，只要目录里已有启用的 `openai_compat` 供应商就不再装这一档；
知识库的 `KNOWLEDGE_*` 按**用途分配**让位，该用途未分配时才回退。存量部署在目录
为空时一行不改照常跑。

环境变量清单统一维护在根 `.env.template`，`.env.example` 是相同内容的兼容副本。
必填项留空，每项用一行说明；可选项默认注释。Compose 按服务白名单透传，
各角色复用同一份配置；共享数据库、Redis、对象存储和身份密钥使用模板里的公共变量。
可空配置填 `null` 表示未配置，空字符串保留原有语义；容器实例名未设时自动取 hostname。
固定角色、schema、监听地址、端口和卷路径由 Compose 管理，模板中已注明。
前端 `VITE_*` 是构建参数，需要传给前端构建命令，修改后重新构建 `web/app/dist`。

⚠ **订阅那一路配好之后还要登录一次。** 去 系统管理 → 模型管理 页面，在那一路
供应商下面走设备码登录（需要 `llm:manage`）；不登录的话面板上这一路是灰的，
标「未登录」。令牌整包加密存在 `platform.llm_provider_credentials`，**一路供应商
一行**、助手与知识库共用（ADR-0041）——换掉 `PLATFORM_LLM_PROVIDER_SECRET` 等于
那些行解不开，界面上会变回「从来没登录过」。

⚠ **`ASSISTANT_MODEL_TIMEOUT_S` 要小于边缘那条事件流 location 的
`proxy_read_timeout`（300s）**，否则边缘先掐断，服务端这条超时与它的失败分档一次
都轮不到，而现象是「助手转了半分钟然后什么都没发生」。

### knowledge-server 的五处部署前置

**一份镜像两个角色，`KNOWLEDGE_APP_ROLE` 分叉，两个都要起。**
`api` 只做读写与检索；解析、切块、嵌入、来源同步全在 `worker`
（[ADR-0032](../docs/adr/0032-知识库独立成代码单元且LLM客户端下沉domain.md)）。
只起 api 的表现是**检索面好好的、传上去的文档永远停在「处理中」**。
⚠ 两个角色**共用一份 Settings**，所以对象存储那四项每个角色都要给全，
哪怕 worker 一个字节都不读——`compose.yml` 里那两段是逐条抄齐的，改一处要改两处。
⚠ worker **可以多副本**（消费组自动分活），这与 publisher 那种单活租约不是一回事。

**pgvector 是硬依赖。** `database-migrate` 装 `vector` 与 `pg_trgm` 并建三个索引
（[ADR-0045](../docs/adr/0045-向量与关键词索引改为硬依赖.md)）。库上装不了 = 迁移
失败 = 知识库整个起不来。**这是有意的**：如果留一条「装不上就不建索引也照跑」的
回退档，它在界面上与真检索长得一模一样，坏了没人看得出来。⚠ 扩展装进 `knowledge` 这个 schema 而不是 `public`——应用连库时
`search_path` 恰好只有本服务那一个 schema，装错地方报的是「type vector does not
exist」，与「装没装扩展」这件事看着毫无关系。

**桶与素材共用，但 `knowledge/` 前缀不许匿名可读。** 原件与插图落在同一个桶的
`knowledge/` 下，一律经 knowledge-server 的受管端点取字节。匿名可读的**只有**
`models` / `images` / `icons` 那三个给现场大屏机取素材的前缀。

**DOCX 图形预览依赖 LibreOffice。** knowledge 镜像内置无 GUI Writer 与中文字体；
worker 把 DOCX 派生为私有 PDF，浏览器优先画 PDF。关掉生成开关或单份转换失败时，
正文照常摄取，前端退回兼容预览并提示复杂图形可能缺失（ADR-0054）。
升级存量部署时先让 `KNOWLEDGE_INGEST_GENERATION_WRITE_ENABLED=false` 随新代码滚完；
确认所有旧 knowledge worker 消失后再改 `true` 做第二次滚动。fresh install 可直接开。
开闸后若回滚到旧镜像，先暂停知识库写入口并停完新版 worker，再回滚 API/worker；
不能让旧 API 发出的无 generation 消息被仍在运行的新版 worker 消费。

**五组能力开关，每组都是「开着却不给所需配置 = 启动即失败」。**

| 开关 | 关着时 |
|---|---|
| `KNOWLEDGE_EMBEDDING_ENABLED` | 文档照常摄取，检索**如实**回「这个库还没建索引」——不是返回空表，空表与「确实没有相关内容」长得一模一样 |
| `KNOWLEDGE_MODEL_ENABLED` | agentic 检索策略**如实不可用**，不悄悄退化成 naive |
| `KNOWLEDGE_OFFICE_PREVIEW_ENABLED` | 不再生成新的 DOCX PDF；已有派生物仍可读，缺席时退回兼容预览 |
| `KNOWLEDGE_MINERU_ENABLED` | 不收 PDF：上传面给的是一句点得出名字的错，而不是一份状态 ready 却检索不到的空文档 |
| `KNOWLEDGE_ASR_ENABLED` | 对话页没有麦克风键 |

⚠ **真正走哪一路由模型目录说了算**（ADR-0041）：`KNOWLEDGE_EMBEDDING_*` /
`_MODEL_*` 只是目录里没给这个用途分配时的永久默认值。
⚠ **`KNOWLEDGE_MODEL_CONTEXT_TOKENS` 不要凭印象填**：`0` = 不知道、一格都不收紧；
本地 llama.cpp 看 `/props` 的 `n_ctx`，它是启动参数，多半远小于模型的训练长度。
填大了等于没填，表现是窗口小的模型**每次都在同一步失败**，而端点回的 400 与长度
毫无关系。
⚠ **浏览器开麦要 HTTPS 或 localhost**，这是浏览器的安全上下文要求，与本仓无关：
`http://` 的页面上 `getUserMedia` 根本不存在。现场部署要给边缘配 TLS。

## 迁移与种子（自动）

一个 `database-migrate` 作业依次调用七个服务原有的 Alembic 链，并执行 auth/platform
种子；全部成功后才启动后端角色。各 schema 的版本表与迁移归属保持独立，
任一步失败立即退出，已经成功的链不会回滚；排除故障后再运行可继续推进。
设计取舍见 [ADR-0058](../docs/adr/0058-数据库迁移由单一部署作业调度.md)。

专用迁移镜像不安装 Node、LibreOffice 或业务模型工具，运行账号为非 root。
platform API/worker/publisher 共用一个服务镜像，knowledge API/worker 共用另一个；
Compose 各角色引用同一份构建定义，单独启动 worker 时也能构建所需镜像。`IMAGE_TAG` 建议填版本与 Git SHA。

```bash
# 改动后构建迁移与应用镜像，迁移先行。
docker compose up -d --build

# 单独执行完整迁移，不启动应用。
docker compose run --rm --no-deps database-migrate

# 只执行一个属主迁移与其种子，不改正在运行的应用。
docker compose run --rm --no-deps database-migrate --service auth-server
```

`MIGRATION_POSTGRES_USER` / `MIGRATION_POSTGRES_PASSWORD` 可配置具有 DDL/扩展权限的
独立账号，不配置时沿用 `POSTGRES_USER` / `POSTGRES_PASSWORD`；业务容器只接收
业务账号。启用独立账号前，数据库管理员须为业务账号配置目标 schema 的使用权限、
已有表/序列的读写权限及迁移账号新建对象的默认权限；作业不会自动授权。
迁移开始前等待数据库真正可查询，默认上限 120 秒；每条迁移/种子命令
默认上限 600 秒，两者分别由 `MIGRATION_DATABASE_WAIT_TIMEOUT_S` 与
`MIGRATION_COMMAND_TIMEOUT_S` 调整。

作业持有数据库会话锁：另一个部署正在迁移时立即拒绝；连接丢失时终止正在执行的
命令。超时或写失败不会自动重试。迁移只能包含扩展步，破坏性变更仍需遵循
扩展—收缩两次发布规则；回滚应用镜像不回滚数据库结构。

种子每次执行，用于同步内置权限码、路由规则及平台预设；已有管理员账号不会被
重设密码，`AUTH_SEED_ADMIN_PASSWORD` 仅在管理员缺失时使用。对象存储初始化
仍由 `minio-init` 负责；MinerU 权重初始化仍只在 `mineru` profile 下执行。

### 前端页面路径

前端统一从 `/ai/` 访问；容器与 Windows Nginx 配置将该前缀映射到现有
`dist` 根目录，并回退到 `/ai/index.html` 支持深层页面刷新。旧页面地址重定向
到 `/ai` 下并保留查询参数；API `/api/` 与素材 `/oss/` 不变。更新时需重新
构建前端并重载对应 Nginx 配置。

### 模型素材重新上传

先执行 platform 数据库迁移，再排空并升级旧 `platform-worker`，随后更新
platform API 与 Nginx，最后发布前端。旧 worker 不识别内容版本，不能与新的
重新上传入口并行使用。模型取回经过 `/oss/resolve/models/`，因此不能只更新前端。

已有 `asset:<uuid>` 引用和大屏配置无需迁移；素材名称、ID 与创建信息保持不变。
新压缩档就绪前读取当前版本原件。旧内容版本保留至删除该素材时一并清理。
