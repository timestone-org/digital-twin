# 部署编排

## edge-gateway

唯一的入口。它做**且只做**：TLS 终结、按前缀反向代理、`auth_request` 前置鉴权、
公开面限流、前端静态资源发布。任何需要读库才能回答的问题都不属于边缘。

`nginx/nginx.conf.template` 是 envsubst 模板，由官方镜像在启动时渲染。

> ⚠ 必须设 `NGINX_ENVSUBST_FILTER='^(AUTH_|OSS_)'`，且过滤器只能这么窄：放开的话
> `$uri` / `$host` 这些 nginx 变量会被 envsubst 一起替换成空串，表现为
> 「路由全乱、鉴权全过」。

### 三处不能改的配置

1. **server 级把身份与权限的 `X-Auth-*` 头置空**。客户端伪造这些头就等于伪造身份；
   只在 `auth_request` 成功后由 `auth_request_set` 重新注入。⚠ 自己写了任何一条
   `proxy_set_header`（含 include `proxy-common.conf`）的 location 不再继承 server 级
   那几行，不挂 `auth-inject.conf` 的就必须在块内再置空一遍；
   `server/services/auth-server/tests/contract/test_edge_gateway.py` 逐个 location 数这一条。
2. **免认证 location 只有那几条**。规则表里的空 `permission_codes` 语义是
   「任意已登录用户放行」而**不是**匿名放行——匿名可达性只由这些 location 保证。
   删掉 `/sessions` 那条就会全站无法登录，且管理员自己也进不去。
3. **`/internal/` 一律 deny**。`/verify` 与权限回查都挂在那下面，
   它们只认服务级密钥，对外暴露等于把鉴权端点交给公网。

### 模型调用鉴权

`/api/v1/platform/open-models/` 使用 `auth-inject.conf`，通过 auth-server 校验用户
APIKey 和 `modeling:view` 权限，再由 platform 校验签名身份。模型调用保留独立 IP
限流和 256 KiB 请求体限制。发布此鉴权切换时需先同步 auth 路由种子，再更新
platform 和边缘配置；切换完成前暂停调用，避免混合版本拒绝请求。详见
[ADR-0062](../docs/adr/0062-模型调用统一使用账号API密钥.md)。

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

## 选择 Compose 入口

| 文件 | 部署内容 | 环境模板 |
| --- | --- | --- |
| [compose.storage.yml](compose.storage.yml) | PostgreSQL、TimescaleDB、pgvector、Redis、MinIO，供手动启动的服务或完整栈使用 | [storage.env.example](storage.env.example) |
| [compose.yml](compose.yml) | 完整微服务、网关、AI 助手、知识库 API / worker，可选层级图和 MinerU | [根目录 .env.template](../.env.template)，与 [根目录 .env.example](../.env.example) 同步 |
| [compose.no-ai.yml](compose.no-ai.yml) | 内置 PostgreSQL / TimescaleDB、Redis、MinIO，以及非 AI 服务和网关，可选层级图 | [no-ai.env.example](no-ai.env.example) |

以下命令在仓库根目录执行。首次部署复制对应模板并填写空白必填项，升级时对照模板补齐
现有环境文件并沿用原项目名、连接和凭据。带 `#` 的可选项按需取消注释。
模板也标明 Compose 固定的角色、容器端口、schema 和路径。实际密码与密钥填写在私有
`.env*` 中。含 `$` 或 `#` 的字面值可用单引号包裹。修改环境后用相同的
`--env-file`、`-f` 和 profile 参数重新执行 `up -d`，构建参数改动需加 `--build`。

### 1. 独立基础设施

```bash
cp docker/storage.env.example docker/.env.storage
# 填 PostgreSQL、Redis 和 MinIO 凭据，需要时调整宿主端口。
docker compose --env-file docker/.env.storage -f docker/compose.storage.yml config --quiet
docker compose --env-file docker/.env.storage -f docker/compose.storage.yml up -d --build
docker compose --env-file docker/.env.storage -f docker/compose.storage.yml wait minio-init
docker compose --env-file docker/.env.storage -f docker/compose.storage.yml ps -a
```

PostgreSQL、Redis、MinIO 健康且 `minio-init` 退出码为 0 后，可启动应用。PostgreSQL
镜像提供 TimescaleDB、pgvector（向量存储）及 pg_trgm，应用迁移负责按属主安装所需扩展。
建桶作业仅设置 `models/`、`images/`、`icons/` 的匿名下载策略。素材和知识库的其他
前缀使用私有访问。

宿主默认从 `127.0.0.1` 连接 PostgreSQL `5432`、Redis `6379`、MinIO API `9000`
与控制台 `9001`，端口可在模板中调整。容器通过 `digitaltwin-storage` 网络上的
`postgres:5432`、`redis:6379`、`minio:9000` 连接，使用容器端口。

### 2. 完整微服务与 AI

```bash
cp .env.template docker/.env
# 填数据库、Redis、对象存储、外部 EMS 与必填密钥。
docker compose --env-file docker/.env -f docker/compose.yml config --quiet
docker compose --env-file docker/.env -f docker/compose.yml up -d --build
docker compose --env-file docker/.env -f docker/compose.yml ps -a
```

同机使用上面的独立基础设施时，`docker/.env` 中设置
`APP_NETWORK_NAME=digitaltwin-storage`、`APP_NETWORK_EXTERNAL=true`、
`POSTGRES_HOST=postgres`、`REDIS_HOST=redis`、
`OSS_ENDPOINT=http://minio:9000`、`OSS_UPSTREAM=minio:9000`，数据库名、账号、口令、
对象存储凭据及桶名与 `.env.storage` 一致。自定义网络名使用 `STORAGE_NETWORK_NAME`
的实际值。使用现有外部存储时，填写应用容器可访问的地址并保留默认应用网络。
`OSS_UPSTREAM` 填 `host:port`，`OSS_ENDPOINT` 含 `http://` 或 `https://`。
应用栈的 `minio-init` 会再次确认桶和公开前缀配置，成功后才执行数据库迁移。
如由存储管理员预建桶与策略，可设置 `OSS_INIT_BUCKET=false` 跳过建桶和策略配置。

如需 MinerU 解析 PDF 和扫描件，在 `docker/.env` 中设置
`KNOWLEDGE_MINERU_ENABLED=true`，使用内置 MinerU 时保留容器地址
`http://mineru:8000`，再给启动命令加 `--profile mineru`。使用外部解析服务时填写其
地址即可。MinerU 权重会向 `MINERU_MODEL_SOURCE` 指定的来源下载并缓存到独立卷。

模型可在系统管理的模型目录配置，启用前填写共享的 `LLM_PROVIDER_SECRET`。也可按
模板启用助手/知识库的环境变量模型档。知识库摄取需要可用的嵌入模型，
`KNOWLEDGE_EMBEDDING_DIMENSIONS` 须与模型输出及数据库列维数一致。外部模型和语音
服务的参数分组见下文。

### 3. 内置基础设施的无 AI 栈

```bash
cp docker/no-ai.env.example docker/.env.no-ai
# 填所有空白必填项；IMAGE_TAG 使用版本号与提交 SHA。
docker compose --env-file docker/.env.no-ai -f docker/compose.no-ai.yml config --quiet
docker compose --env-file docker/.env.no-ai -f docker/compose.no-ai.yml up -d --build
docker compose --env-file docker/.env.no-ai -f docker/compose.no-ai.yml ps -a
```

无 AI 编排关闭前端 AI 入口和 Docker 网关的助手、知识库与模型供应商目录 API，
并从统一迁移作业排除助手和知识库。分析建模、达标预测、采集、报告和大屏照常提供。
它使用独立项目名及数据卷。PostgreSQL 和 Redis 仅在容器网络内可达，MinIO 控制台默认
使用 `127.0.0.1:9001`。同机并行部署时为网关、MinIO 控制台和 OPC UA 配置不同端口。
层级图在两套应用栈均可通过 `--profile hierarchy` 启动。

### 应用配置与运维

- 页面入口为 `http://localhost:8080/ai/`，端口由 `EDGE_HTTP_PORT` 控制。前端由同一份
  [web/Dockerfile](../web/Dockerfile) 构建，发布时用版本号与提交 SHA 作为 `IMAGE_TAG`。
  仅更新前端时用对应编排的 `up -d --build --no-deps edge-gateway`。
- 两套应用栈均需配置现场只读 EMS 的 `ACSOURCE_HOST/USER/PASSWORD/DB` 或对应的
  `PLATFORM_SQLSERVER_*`。`ACSOURCE_TIMEZONE` 是 EMS 无时区列的解释口径。
  EMS 暂时不可达时，相关查询返回 503，其他业务仍能启动。
  [ADR-0009](../docs/adr/0009-空调原始数据由平台直读外部EMS库.md)
- `AUTH_EDGE_SIGNING_SECRET` 与 `AUTH_EDGE_SERVICE_KEY` 分别用于签名身份头和认证内部
  请求，每项至少 32 字符，由 Compose 传给所有消费方。`AUTH_JWT_SECRET` 由 auth 与
  realtime 共用。`COLLECT_CREDENTIAL_SECRET` 用于加密采集凭据，换钥后需重填旧凭据。
- 停止时用相同 Compose 参数执行 `down`，保留数据卷。独立存储与完整栈共享网络时先停
  应用栈。单独备份 PostgreSQL、Redis、MinIO 数据卷与应用栈的 `opcua-pki` 卷。
- 新基础设施使用 PostgreSQL 18.6 / TimescaleDB 2.31.0 与 Redis 8.10.3 的固定镜像摘要。
  数据库卷挂载 `/var/lib/postgresql`，数据目录是 `/var/lib/postgresql/18/docker`。
  PostgreSQL 16 / 17 的已有卷应先按主版本升级流程迁移。MinIO 固定官方源码提交
  `9e49d5e7`，客户端固定 `7394ce0d`，复用已有数据卷时须确保 UID 10001 可写。
  [PostgreSQL 主版本升级](https://www.postgresql.org/docs/18/upgrading.html)
- 既有阜阳现场继续从其服务器上的部署副本运行，配置恢复方式见
  [阜阳远程存储](FUYANG_STORAGE.md)。

### 手动运行服务

1. 先启动独立存储或准备同等的外部基础设施。进入各服务目录，把 `.env.example`
   复制为 `.env`，填写部署值。以下模板按实际消费方列出变量。

   | 进程 | 环境模板 |
   | --- | --- |
   | 认证 API 与管理员种子 | [auth-server](../server/services/auth-server/.env.example) |
   | 平台 API、worker、publisher | [platform-server](../server/services/platform-server/.env.example) |
   | 采集运行时 | [collector-server](../server/services/collector-server/.env.example) |
   | OPC UA 管理及实例托管 | [opcua-server](../server/services/opcua-server/.env.example) |
   | 实时通道 | [realtime-hub](../server/services/realtime-hub/.env.example) |
   | AI 助手 | [ai-assistant](../server/services/ai-assistant/.env.example) |
   | 知识库 API 与 worker | [knowledge-server](../server/services/knowledge-server/.env.example) |
   | 层级图 | [hierarchy-server](../server/services/hierarchy-server/.env.example) |
   | 统一迁移作业 | [deploy/.env.example](../server/deploy/.env.example) |
   | 前端开发与构建 | [web/app/.env.example](../web/app/.env.example) |

2. 从 `server/` 运行 `uv sync --frozen --all-packages`。复制 `deploy/.env.example` 为
   `deploy/.env` 并填好迁移连接，再运行
   `uv run --frozen --all-packages --env-file deploy/.env python deploy/migrate.py`。仅部署部分服务时传入
   一个或多个 `--service <服务名>`。作业从各服务目录读取其 `.env`，统一覆盖迁移用的
   PostgreSQL 连接。业务进程继续使用自己的数据库账号。
3. 在每个服务目录运行 `uv run <服务名>`，或将工作目录和环境变量交给进程管理器。
   platform 的三个进程共用其配置，分别将 `PLATFORM_APP_ROLE` 设为 `api`、
   `worker`、`publisher`。knowledge 的两个进程分别将 `KNOWLEDGE_APP_ROLE` 设为
   `api`、`worker`。同机角色使用不同的 `*_APP_INSTANCE`。在 Linux 或 macOS 上把
   `OPCUA_PKI_DIR` 改为可写的持久目录。知识库的 DOCX 派生预览启用时，将
   `KNOWLEDGE_OFFICE_PREVIEW_COMMAND` 设为本机 LibreOffice 的可执行文件；暂未安装
   LibreOffice 时可设 `KNOWLEDGE_OFFICE_PREVIEW_ENABLED=false`。
4. 部署 Nginx 边缘来发布前端并统一处理鉴权、API 和素材代理。同机手动部署可用
   [宿主网关配置](nginx/dt-edge.windows.conf) 的回环上游，按部署位置修改监听端口、
   前端 `dist` 路径、MinIO 地址和桶名，以及服务级密钥占位符。无 AI 时构建前端前
   设置 `VITE_AI_ENABLED=false`，并将 [AI 路由限制](nginx/disable-ai.conf) 引入
   站点 `server` 块。前端本地开发可在
   `web/app/.env` 配置 `VITE_DEV_API_TARGET` 指向边缘后运行 `pnpm --dir web dev`。
   宿主的进程、前端构建与 Nginx 完整接线见
   [Windows / NSSM 部署手册](../docs/DEPLOY_WINDOWS_NSSM.md)。

### 能管取数

在实际使用的应用环境文件设置 `PLATFORM_BDM_ENABLED=true`、
`PLATFORM_BDM_BASE_URL`、`PLATFORM_BDM_API_KEY`，按需调整时区与请求预算。
填写 HTTP(S) origin（不含 `/api` 路径、查询参数或账号）。预算须满足
`PLATFORM_BDM_TIMEOUT_S < PLATFORM_BDM_LOAD_TIMEOUT_S < PLATFORM_MODELING_NODE_TIMEOUT_S`。
使用新算子前更新所有 platform worker，再更新 API 和前端。
[能管取数](../docs/MODELING_DESIGN.md#能管取数)

### 认证管理审计来源

Docker 网关转发认证管理请求时携带它观测到的客户端地址，认证服务验证服务证明后
写入审计。先更新认证服务，再更新 Docker 网关。两端继续共用部署的
`AUTH_EDGE_SERVICE_KEY`。混合版本期间按连接地址记录，历史审计记录保留原样。
详见 [ADR-0065](../docs/adr/0065-认证审计采用可信边缘来源地址.md)。

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
| `ASSISTANT_MODEL_CONTEXT_TOKENS` | 上下文总容量，默认 32768；按实际端点容量配置，自动压缩会预留输出空间。前端估算用量明确标注“约” |
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
前端 `VITE_*` 是构建参数，需要由 `web/Dockerfile` 声明并由 Compose 的
`edge-gateway.build.args` 传入；修改后重新构建网关镜像。普通编排固定启用 AI 页面，
no-ai 编排固定传入 `VITE_AI_ENABLED=false`，不会从容器运行时环境改变已打包页面。

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
两个角色使用同一段 Compose 环境配置，包含同一套对象存储与摄取队列参数。
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
| `KNOWLEDGE_EMBEDDING_ENABLED` | 若模型目录也未分配嵌入模型，摄取任务失败并提示缺少模型 |
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

### 素材直传暂存到期

MinIO 保存原始上传七天，按对象最后修改时间计算。适用前缀为
`staging/model/`、`staging/image/`、`staging/icon/` 和 `staging/replacements/`。
签名凭证有效 900 秒。首次确认的 `staging/confirmations/` 副本和
`upload-claims/` 认领是中断恢复的依据，应排除在生命周期规则外。
`models/`、`images/`、`icons/`、模型历史版本和私有知识库前缀也应排除。

三套 Compose 的 `minio-init` 负责建桶及设置匿名读取策略。生命周期由
对象存储管理员在独占配置变更窗口执行，避免 MinIO 的整份配置更新与另一个写者互相覆盖。
在该窗口内用配置好的 `mc` 别名与实际素材桶名替换下面的 `alias/bucket`。
先将导出文件保留为回滚依据。如果服务明确返回 `NoSuchLifecycleConfiguration`，
用 `{"Rules":[]}` 作为输入；认证、网络或其他失败必须先解决。

```sh
mc ilm rule export alias/bucket > lifecycle.before.json
python3 docker/minio/merge_staging_lifecycle.py lifecycle.before.json > lifecycle.proposed.json
```

核对差异应只有缺少的到期规则，已有规则应逐条保留；如出现重叠或 ID 冲突，脚本会
停止，需由管理员先确认既有规则。已有四条规则时 `--check` 返回成功，直接结束本次
变更。需要新增规则时，在仍持有独占变更窗口的情况下导入并重新读取核对：

```sh
mc ilm rule import alias/bucket < lifecycle.proposed.json
mc ilm rule export alias/bucket > lifecycle.after.json
python3 docker/minio/merge_staging_lifecycle.py --check lifecycle.after.json
```

对比导出结果与原配置，确认其他规则仍在。MinIO 后台扫描异步执行到期；
启用后已超过七天的匹配对象也会到期。如果素材桶已启用版本控制，这些规则只管理
当前对象，非当前版本与删除标记的回收由对象存储管理员另行决定。

## 迁移与种子（自动）

完整栈的 `database-migrate` 作业依次调用八个服务的 Alembic 链，无 AI 栈只执行六个非 AI 属主的链。两套均执行 auth/platform
种子；全部成功后才启动后端角色。各 schema 的版本表与迁移归属保持独立，
任一步失败立即退出，已经成功的链不会回滚；排除故障后再运行可继续推进。
以下命令在 `docker/` 中使用完整栈的 `.env`，无 AI 栈按上文追加对应的文件参数。
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
到 `/ai` 下并保留查询参数；API `/api/` 与素材 `/oss/` 不变。Docker 部署更新时重建
并重新创建网关；Windows 部署仍需手动构建前端、替换 `dist` 并重载对应 Nginx 配置。

### 模型素材上传大小

单个三维模型最多 2 GB（2,147,483,648 字节）。大小上限由 platform 素材类型目录
下发，前端提示、新上传与重新上传的签名策略、确认时的对象大小校验共用该上限。
图片仍最多 16 MB，图标仍最多 512 KB。

Linux 与 Windows 网关的 `/oss/` 请求体上限为 `2049m`，在 2 GB 文件之外
预留 1 MB 的 multipart 表单开销；对象存储的签名策略仍严格限制文件大小为 2 GB。
升级时更新 platform API 并重载对应 Nginx 配置，刷新素材页即可取得新的上限。

### 模型素材重新上传

先执行 platform 数据库迁移，再排空并升级旧 `platform-worker`，随后更新
platform API 与 Nginx，最后发布前端。旧 worker 不识别内容版本，不能与新的
重新上传入口并行使用。模型取回经过 `/oss/resolve/models/`，因此不能只更新前端。

已有 `asset:<uuid>` 引用和大屏配置无需迁移；素材名称、ID 与创建信息保持不变。
新压缩档就绪前读取当前版本原件。旧内容版本保留至删除该素材时一并清理。

### 可选层级图

在 `docker/` 中运行
`docker compose --profile hierarchy up -d --build auth-server hierarchy-server edge-gateway`
启用独立 `hierarchy-server` 并构建前端网关，
前端入口为“工具 → 层级图”（`/ai/tools/hierarchy`）。默认编排不启动该服务，
边缘用运行期 DNS 解析，服务缺席不阻断网关。能力探测失败仅隐藏对应入口。

统一迁移作业包含 hierarchy 独立迁移链；默认部署也建立空 schema，不启动绘图
服务。认证种子登记 `hierarchy:view` 与 `hierarchy:manage`，只读角色可以查看
自己的项目，管理权限用于创建、导入、修改与删除。服务镜像仅安装 lib 与自身。
升级先执行迁移与认证种子，再启动可选服务、重建并重新创建前端网关，让入口脚本重新渲染
Nginx 模板；用 `docker compose exec edge-gateway nginx -t` 验证加载配置。停用时停止
`hierarchy-server` 并移除 profile，项目数据保留，刷新页面后入口隐藏；代码回滚不回滚数据库。

项目默认按账号隔离。JSON 与 Excel 可与 Layerflow v1 案例互导；PDF 导出打开
浏览器打印窗口，选择“保存为 PDF”。SVG / PNG 均导出完整图纸。
