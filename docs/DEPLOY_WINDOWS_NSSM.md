# Windows 单机部署手册（nssm）

把整套平台装在**一台 Windows 机器**上：十一个部署单元（含边缘网关 nginx）各做成
一个 Windows 服务，由 [nssm](https://nssm.cc) 托管；PostgreSQL / Redis / 对象存储
是同机的外部依赖，各自按自己的方式装。

> 权威编排仍然是 [`docker/compose.yml`](../docker/compose.yml)：**服务清单、环境变量
> 的取值与共享关系以它为准**，本手册是它在 Windows 上的手工渲染件。那边改了这边
> 就要跟着改，两边分叉的表现是「容器里好好的，现场这台不对」。

## 0. 适用与不适用

| 场景 | 用不用 |
|---|---|
| 现场只有一台 Windows 机、要开机自启、要能被运维在服务面板里看见 | ✅ 本手册 |
| 机器能装 Docker Desktop / 有 Linux 机器 | ❌ 用 [`docker/README.md`](../docker/README.md)，省掉本手册全部的手工同步 |
| 要水平扩、要滚动发布、要多机 | ❌ 走 K8s，见 [ARCHITECTURE §2.2](ARCHITECTURE_MICROSERVICES.md) |

**原生部署与容器部署的三条硬差别，先认下来：**

1. **七个代码单元共用一个 Python 环境**（`server\.venv`）。升级是全量的——没法只换
   一个服务的依赖。
2. **没有 `depends_on` 与健康探针编排**。Windows 服务的依赖只保证「被依赖的服务
   已启动」，不保证「已经能应答」。所以每个服务都要能在依赖没就绪时**退出并被
   重启**，这靠 nssm 的 `AppExit Restart` 兜（§7.1）。
3. **迁移与种子不会自己跑**。容器里那七个一次性作业在这里是**人跑的命令**（§6），
   漏跑的现象与原因隔得极远（新端点全 403、历史一条也落不进去）。

---

## 1. 目标拓扑

### 1.1 服务与端口

| # | 部署单元 | Windows 服务名 | 进程 | 监听 | 对外 |
|---|---|---|---|---|---|
| 1 | edge-gateway | `dt-edge` | `nginx.exe` | `0.0.0.0:82` | **是**（唯一入口）|
| 2 | auth-server | `dt-auth` | `python -m auth_server` | `127.0.0.1:8004` | 否 |
| 3 | platform-api | `dt-platform` | `python -m platform_server`（`ROLE=api`）| `127.0.0.1:8005` | 否 |
| 4 | platform-worker | `dt-platform-worker` | 同上（`ROLE=worker`）| 不监听 | 否 |
| 5 | platform-publisher | `dt-platform-publisher` | 同上（`ROLE=publisher`）| 不监听 | 否 |
| 6 | realtime-hub | `dt-realtime` | `python -m realtime_hub` | `127.0.0.1:8000` | 否 |
| 7 | opcua-server | `dt-opcua` | `python -m opcua_server` | `127.0.0.1:8008` + `0.0.0.0:4840-4859` | **opc.tcp 对外** |
| 8 | collector | `dt-collector` | `python -m collector_server` | `127.0.0.1:8007` | 否 |
| 9 | ai-assistant | `dt-assistant` | `python -m ai_assistant` | `127.0.0.1:8006` | 否（可缺席）|
| 10 | knowledge-api | `dt-knowledge` | `python -m knowledge_server`（`ROLE=api`）| `127.0.0.1:8009` | 否（可缺席）|
| 11 | knowledge-worker | `dt-knowledge-worker` | 同上（`ROLE=worker`）| 不监听 | 否（可缺席）|

⚠ **knowledge 那两个是一对，不许只装 api。** 解析、切块、嵌入、来源同步全在
worker 角色里（[ADR-0032](adr/0032-知识库独立成代码单元且LLM客户端下沉domain.md)）。
只起 api 的表现是**检索面好好的、传上去的文档永远停在「处理中」**——队列里投得
进去，没有人消费。反过来，两个角色**共用一份 Settings**：对象存储那四项每个角色
都要给全，哪怕 worker 一个字节都不读（与 platform 三角色同一条规矩，§5.2）。

外部依赖（不属于十一个部署单元，但都装在同一台机器上）：

| 组件 | Windows 服务名（默认） | 监听 | 说明 |
|---|---|---|---|
| PostgreSQL + TimescaleDB + **pgvector** | `postgresql-x64-17` | `127.0.0.1:5432` | 一库多 schema，七份迁移各管各的。⚠ 起知识库要多两个扩展，见 §2.3 |
| Redis | `Memurai` 或自建 | `127.0.0.1:6379` | **必须 ≥ 6.2**，理由见 §2.4 |
| 对象存储（MinIO）| `dt-minio`（§4.4 也用 nssm 装）| `127.0.0.1:9000` | 素材字节面 + 知识库原件与插图 |

知识库那一路还牵三件**可缺席**的外部件（都不在这台机器上也照样跑，只是少那一块
能力，见 §2.9）：

| 外部件 | 谁调它 | 不给会怎样 |
|---|---|---|
| 嵌入 / 重排端点（OpenAI 兼容）| knowledge api + worker | 摄取照常、检索如实回「这个库还没建索引」；**不是**返回空表 |
| MinerU（[ADR-0043](adr/0043-解析后端可插拔且外部解析服务留口.md)）| knowledge worker | 上传面不收 PDF，给的是一句点得出名字的错。Office 与纯文本仍由 worker 本进程解 |
| FunASR（[ADR-0038](adr/0038-语音输入走自建FunASR经知识库服务中继.md)）| knowledge api | 对话页没有麦克风键 |

⚠ **除边缘那个端口（本部署 82）与 4840-4859 外，一律绑 `127.0.0.1`。** 后端服务默认绑 `0.0.0.0`，
而 platform / opcua / realtime / assistant / knowledge 完全依赖边缘注入的签名身份头
来认人——把 8005 或 8009 暴露在厂区网上，等于给了一条绕过闸 1 的路。绑定由每个服务的
`<前缀>_APP_HTTP_HOST=127.0.0.1` 决定（§5.4），不要指望防火墙兜底。

### 1.2 与 compose 的对照

| compose 服务 | 这里 |
|---|---|
| `edge-gateway` | `dt-edge`，nginx 配置手工渲染（§8）|
| `auth-migrate` … `knowledge-migrate`（7 个一次性作业）| §6 的七条命令，**人跑** |
| `minio-init` | §4.4 的建桶与匿名前缀，**人跑** |
| `mineru` / `mineru-models`（`--profile mineru` 才起）| 本仓只给了容器构建，Windows 上没有对应物，见 §2.9 |
| 其余 11 个服务 | 同名的 11 个 Windows 服务 |
| Docker 内嵌 DNS（服务名互相解析）| 全部换成 `127.0.0.1:<端口>`（§5.3）|
| `opcua-pki` 卷 | `C:\DigitalTwin\data\opcua-pki`（§5.4）|

### 1.3 目录规划

```
C:\DigitalTwin\
  app\                      ← 代码检出（server\ web\ docker\ docs\ …）
    server\.venv\           ← 唯一的 Python 环境
    web\app\dist\           ← 前端构建产物，nginx 的 root
  tools\
    nssm\nssm.exe
    nginx\                  ← nginx for Windows 解压后的整棵树
    minio\minio.exe mc.exe
  data\
    opcua-pki\              ← OPC UA 实例私钥，⚠ 不随数据库备份走
    minio\                  ← 对象存储数据目录
  logs\                     ← nssm 抓下来的 stdout/stderr
  backup\
```

⚠ **这只是示例根目录。** 换成别的（例如检出直接落在 `D:\AI\DigitalTwin`、
没有 `app\` 那一层）完全可以，但**下面这几处必须跟着一起改**，它们是全篇仅有的
写死路径：`OPCUA_PKI_DIR`、`PLATFORM_ASSETCOMPRESS_SCRIPT`（§5.4）、nginx 的
`root`（§8.2）、nssm 的 `AppDirectory` 与日志路径（§7）。

⚠ **先把目录建出来再装服务。** nssm **不会**替你创建 `AppStdout` / `AppStderr`
的父目录：目录不存在时服务装得上、状态却起不来，而事件日志里只有一句语焉不详的
启动失败。同理 `OPCUA_PKI_DIR` 的父目录也要先在。

```powershell
mkdir C:\DigitalTwin\logs, C:\DigitalTwin\data\opcua-pki, C:\DigitalTwin\data\minio, C:\DigitalTwin\backup -Force
```

⚠ **路径里不许有空格与中文。** nssm、nginx、alembic 的相对路径与命令行拼接都要
在这条前提下才不用逐处加引号；`C:\Program Files\…` 下面部署会在某一处引号漏掉时
以一个毫不相干的错误失败。

---

## 2. 前置软件

全部装完再往下走。每一项都给了验证命令，**验证不过就不要继续**——后面的失败会
指向别的地方。

### 2.1 操作系统

Windows Server 2019/2022/2025 或 Windows 10/11 **x64**。以管理员身份操作。

三件与业务直接相关的系统设置：

```powershell
# 1) 不许休眠：休眠 = 采集断、归档停、租约丢
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

# 2) 时钟必须准：库里一律存 UTC，机器时钟偏几分钟就是历史曲线整体平移
w32tm /query /status

# 3) Windows Update 的自动重启会在无人值守时把整站停掉，配好活动时间或改成通知
```

### 2.2 Python 3.12

与容器里的运行时同版本。两条路二选一：

```powershell
# A) 用 uv 装（推荐，不污染系统 Python）
winget install --id astral-sh.uv -e
uv python install 3.12

# B) 官网安装包，勾 "Add python.exe to PATH"
python --version   # 期望 3.12.x
```

⚠ **不要用 3.13/3.14。** `requires-python = ">=3.12"` 允许，但镜像与 CI 跑的是
3.12，锁文件里的轮子也按 3.12 验过；换小版本出的问题只会在现场出现。

### 2.3 PostgreSQL + TimescaleDB

> 📌 **现场实测（140.80.0.10，2026-09-01）：PostgreSQL 18.4 + timescaledb 2.29.2，
> 跑得好好的。** 下面那条"只到 17"的挑版建议是**新装找不到安装包时**的退路，
> 不是对现役这套的否定——已经跑起来了就别动它。

新装时**版本要挑准**：TimescaleDB 的 Windows 安装包过去只覆盖 PostgreSQL 15/16/17，
找不到 PG 18 的包就退回 17.x，并避开 PG 17.1（那个小版本有过一次二进制接口变更，
17.2 起已回退）——也就是 **17.2 及以上的 17.x**。

1. 装 PostgreSQL 17.x（[postgresql.org](https://www.postgresql.org/download/windows/)），
   组件里**勾上 Command Line Tools**，装完确认 `pg_config` 在 PATH 里。
2. 装 [Visual C++ 2015 Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) 与 **OpenSSL 3.x**（TimescaleDB 的运行期依赖）。
3. 从 [TimescaleDB Releases](https://github.com/timescale/timescaledb/releases) 下与
   PG 大版本匹配的 Windows 安装包，解压后**以管理员身份运行 `setup.exe`**，
   向导会自己改 `shared_preload_libraries` 并跑 timescaledb-tune。
4. 重启服务并验证：

```powershell
Restart-Service postgresql-x64-17
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "SHOW shared_preload_libraries;"
# 期望输出里含 timescaledb
```

⚠ **超表不是可选项。** `collect.point_history` 与台账的 records 表都是超表，
建表时 `CREATE EXTENSION timescaledb`。装不上会**响亮失败**，不会退化成普通大表
（那种退化要等到表涨到几亿行才被发现）。

**要起知识库就还得有 pgvector（[ADR-0045](adr/0045-向量与关键词索引改为硬依赖.md)）。**
向量走 `vector`、中文关键词走 `pg_trgm`，两个扩展与三个索引都由
`knowledge-migrate` 那条迁移建——**装不上 = 迁移失败 = 知识库整个起不来**。
**这是有意的**：如果留一条「装不上就不建索引也照跑」的回退档，它在界面上与真检索
长得一模一样，坏了没人看得出来。

- `pg_trgm` 是 PostgreSQL 自带的 contrib，Windows 安装包里就有，不用另装。
- `pgvector` 要另装。官方没有出 Windows 安装包，两条路：从
  [pgvector releases](https://github.com/pgvector/pgvector) 取源码，按它 README
  的 Windows 一节用 MSVC 的 `nmake /F Makefile.win` 编一次；或者用
  [StackBuilder](https://www.postgresql.org/download/windows/) / 现成的社区二进制
  （`vector.dll` + `vector.control` + `sql\vector--*.sql` 分别落进 PG 的
  `lib\` 与 `share\extension\`）。
- ⚠ **编译要按同一个大版本的 PG 头文件**：拿 PG 16 的产物塞进 PG 17，
  `CREATE EXTENSION` 时报的是加载 DLL 失败，与版本这件事看着毫无关系。

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS vector;" -c "DROP EXTENSION vector;"
# 期望两条都成功。这只是试装：真正建在哪个 schema 由迁移决定（§4.1）
```

⚠ **不起知识库就不用装 pgvector。** 别的六个代码单元一行都不碰它。

### 2.4 Redis（≥ 6.2）

⚠ **版本下限是硬的**：platform-worker 的消费组用 `XAUTOCLAIM` 认领超时条目，
那条命令 6.2 才有。老的 MSOpenTech 3.0 与 tporadowski 5.0 两个 Windows 移植**都不够用**，
表现是 worker 起来就报未知命令、抽取任务永远不动。

三条路，按现场条件选：

| 方案 | 取舍 |
|---|---|
| **Memurai Enterprise**（推荐生产）| Redis 官方合作的 Windows 原生移植，兼容到 Redis 7.4，自带 Windows 服务安装。**收费** |
| 现场实测走的是**社区 Windows 构建的 Redis 8.8**（140.80.0.10，2026-09-01）| 远在 6.2 这条下限之上，`XAUTOCLAIM` 没问题 |
| Memurai **Developer** | 免费，但**单次运行最长 10 天**，到点自己关掉。⚠ 现场用它 = 每 10 天全站实时面停摆一次，只能用来试装 |
| 社区 Windows 构建（如 [redis-windows/redis-windows](https://github.com/redis-windows/redis-windows)）| 免费、有 7.x，但非官方；自行评估。用 nssm 托管 `redis-server.exe` 即可 |

装完验证：

```powershell
redis-cli -h 127.0.0.1 ping           # 期望 PONG（Memurai 是 memurai-cli）
redis-cli -h 127.0.0.1 info server | findstr redis_version
```

### 2.5 Node.js 22 + pnpm

两个用途：**前端构建**、**platform-worker 的 glTF 压缩子进程**（[ADR-0022](adr/0022-模型压缩分档由worker产出且档位由消费方选.md)）。
前端可以在别的机器上构建后只拷 `dist`，但**压缩工具链必须装在这台机器上**——
没有它，素材库里传上去的模型永远停在「压缩中」。

```powershell
winget install --id OpenJS.NodeJS.LTS -e   # v22.x
corepack enable
node --version    # v22.x
```

### 2.6 nginx for Windows

从 [nginx.org/en/download.html](https://nginx.org/en/download.html) 取 **stable** 的
`nginx-<版本>.zip`，解压到 `C:\DigitalTwin\tools\nginx`（解压后目录里有
`nginx.exe`、`conf\`、`logs\`、`temp\`）。

```powershell
cd C:\DigitalTwin\tools\nginx
.\nginx.exe -V 2>&1 | Select-String auth_request
# 期望能匹配到 --with-http_auth_request_module
```

⚠ **匹配不到就换一个构建。** 全站的闸 1（`auth_request /_auth`）就挂在这个模块上，
它不在的话 nginx 起不来，报 `unknown directive "auth_request"`。

nginx/Windows 的三条限制，配置里已经据此调过（§8）：

- 启多个 worker 也**只有一个真干活**；
- 只有 `select()`/`poll()`，`worker_connections` 受 `FD_SETSIZE`(1024) 限制——
  **这台机器的并发连接上限就在 1000 左右**，而每块大屏、每个采集配置页都是一条
  长连接。要撑更多同时在线，只能换 Linux；
- 官方定位是 beta，不追求高并发。

### 2.7 nssm

从 [nssm.cc/download](https://nssm.cc/download) 取 2.24（或 2.24-101 预发布），
把 **`win64\nssm.exe`** 放到 `C:\DigitalTwin\tools\nssm\`。

```powershell
C:\DigitalTwin\tools\nssm\nssm.exe version
```

### 2.8 对象存储（MinIO）

素材字节面（模型、图片、图标）走 S3 协议。任何 S3 兼容实现都行，本手册用 MinIO。

```powershell
# minio.exe 与 mc.exe 放进 C:\DigitalTwin\tools\minio\
mkdir C:\DigitalTwin\data\minio
```

⚠ MinIO 的开源仓库已归档，社区版停在最后一版；取二进制时留意来源，并在 §10.3 的
备份清单里把 `data\minio` 与数据库同级对待——**素材没了，存量大屏里每一个
`asset:` 引用都会变成「取不到」**。

### 2.9 知识库的可选外部件

**整套知识库是可缺席的**：不装 `dt-knowledge` / `dt-knowledge-worker`，前端探测
不到就干净地不出现入口，别的功能一件不少。装了它，下面这几件（模型端点、MinerU、
FunASR 三类）**各自还可以再缺席**，缺哪件就少哪一块能力——不会悄悄退化成一个
看着像在工作的假件。

| 外部件 | 装在哪 | 缺席时 |
|---|---|---|
| 嵌入端点（OpenAI 兼容的 `/embeddings`）| 现场任意一台能跑推理的机器，或云上端点 | 文档照常摄取，检索**如实**回「这个库还没建索引」 |
| 重排端点（[ADR-0042](adr/0042-重排是第三种模型种类且方言可插拔.md)）| 同上 | 检索照常，只是不重排。能力面分得清「没接」与「接了但排不成」 |
| 对话档模型 | 同上 | agentic 检索策略如实不可用，**不悄悄退回 naive** |
| MinerU（[ADR-0043](adr/0043-解析后端可插拔且外部解析服务留口.md)）| 见下 | 不收 PDF 与扫描件；Office 与纯文本仍由 worker 本进程解 |
| FunASR（[ADR-0038](adr/0038-语音输入走自建FunASR经知识库服务中继.md)）| 现场任意一台机器 | 对话页没有麦克风键 |

⚠ **前三样真正走哪一路由「系统管理 → 模型管理」说了算**
（[ADR-0039](adr/0039-模型供应商目录由平台持有两端按用途取用.md)）：`.env` 里那几组
`KNOWLEDGE_EMBEDDING_*` / `_MODEL_*` 只是**目录里没给这个用途分配时**的永久默认值。
配好目录之后两侧十秒内生效，不用重启。

⚠ **嵌入模型的维数是部署期常量。** `KNOWLEDGE_EMBEDDING_DIMENSIONS` 同时是库上
向量列的 `vector(N)`，迁移建表时定死。它与目录里分配的那个嵌入模型对不上时，
**一份文档都摄不进来**，撞的是一条「expected N dimensions」，而那条错不会提到你
配的是哪个模型。换模型换维数 = 一次新迁移 + 已有文档全部重新解析，**所以先定好
再灌数据**。

⚠ **`KNOWLEDGE_EMBEDDING_MAX_INPUT_TOKENS` 要照实填。** 切块上限由它折算而来，
而端点对超窗的那一截**静默截断、不报错**——配大了只表现为「这一段明明有，就是
搜不到」。本仓实测 `bge-large-zh-v1.5` 的窗口约合 520 个汉字。

**MinerU 在 Windows 上怎么办。** 本仓只给了容器构建（[`docker/mineru/Dockerfile`](../docker/mineru/Dockerfile)：
CPU 那一档 `mineru[pipeline]==3.4.5`，镜像 2.4 GB、权重另有 2.4 GB），**没有在
Windows 上原生装过**。三条路，按现场条件选：

1. **不接**（默认）。`KNOWLEDGE_MINERU_ENABLED=false`，知识库照常跑，只是不收 PDF。
2. **放在另一台 Linux/容器里**跑那份 Dockerfile，把
   `KNOWLEDGE_MINERU_BASE_URL` 指过去。⚠ 那条链路上没有鉴权，只能走内网。
3. 按 MinerU 官方文档在这台机器上原生装（`pip install "mineru[pipeline]"` 之后
   `mineru-api`）。**本手册没验证过这条**，尤其是 Windows 上 `torch` 的 CPU 轮子与
   `opencv` 的运行期依赖；真要走，先手工跑通 `curl http://127.0.0.1:8000/health`
   再改 `.env`。

⚠ **`KNOWLEDGE_MINERU_ENABLED=true` 却连不上 = 每一份 PDF 都解析失败**，
而能力面上写的是「接了 mineru」、上传面照收 PDF。接不通就把开关留在 `false`。

**FunASR 与麦克风。** 浏览器的音频经 knowledge-server 中继到现场自建的 FunASR
（离线识别，不出内网），`KNOWLEDGE_ASR_URL` 填 `ws://` 或 `wss://`。
⚠ **浏览器开麦要 HTTPS 或 localhost**——这是浏览器的安全上下文要求，与本仓无关：
`http://` 的页面上 `getUserMedia` 根本不存在。本部署的边缘是明文 `listen 82`
（§12），**所以语音输入在现场机器上用不了**，除非先给边缘配 TLS。

---

## 3. 取代码与构建

### 3.1 检出

```powershell
mkdir C:\DigitalTwin\app
git clone <仓库地址> C:\DigitalTwin\app
cd C:\DigitalTwin\app
git checkout main
```

### 3.2 Python 环境（一次装齐七个代码单元）

```powershell
cd C:\DigitalTwin\app\server
uv sync --all-packages --frozen --no-dev
```

- **`--all-packages` 不是 `--package X`**：一个 uv workspace 只有一个 `.venv`。
  按服务逐个 sync 会把上一个服务的依赖卸掉，最后只剩最后那个能起来。
- `--frozen` 严格照 `uv.lock` 装，不重新解析；`--no-dev` 不装测试与闸门工具。
- 全部依赖在 Windows 上都有预编译轮子（`asyncpg` / `pymssql` / `argon2-cffi` /
  `cryptography` / `numpy` / `scikit-learn` / `greenlet`），**不需要 MSVC 编译器**。

验证：

```powershell
C:\DigitalTwin\app\server\.venv\Scripts\python.exe -c "import auth_server, platform_server, collector_server, opcua_server, realtime_hub, ai_assistant, knowledge_server; print('ok')"
```

⚠ **这个 venv 不可搬家。** workspace 成员是**可编辑安装**，`.pth` 里写的是
`C:\DigitalTwin\app\server\services\…\src` 这种绝对路径。换目录、换盘符之后
`import` 会指向一个不存在的位置，而错误信息只是「找不到模块」。搬了就重跑一次
`uv sync`。

⚠ **离线机器**：`uv sync` 要下载轮子。没有外网时，用一台同架构 Windows、**把仓库
放在同一个绝对路径** `C:\DigitalTwin\app` 上装好，再整棵目录拷过去——路径一致，
可编辑安装的 `.pth` 与 `Scripts\*.exe` 里的绝对路径才仍然成立。

### 3.3 glTF 压缩工具链（platform-worker 用）

```powershell
cd C:\DigitalTwin\app\server\services\platform-server\nodetools
npm ci --omit=dev --no-audit --no-fund
node .\compress-model.mjs   # 不带参数应当打印用法/报参数错，能跑起来就说明依赖齐了
```

⚠ `npm ci` 不是 `npm install`：后者会在锁文件与清单不一致时**默默改锁文件**，
于是现场装的和仓里锁的不是同一批。

### 3.4 前端

```powershell
cd C:\DigitalTwin\app\web
pnpm install --frozen-lockfile
pnpm build          # 产物落在 web\app\dist
```

前端**不含任何绝对地址**（`/api/v1/*` 与 `/oss/` 都是同域相对路径），所以构建产物
与部署地址无关，可以在开发机上构建后只把 `web\app\dist` 拷过来。

⚠ 拷贝时**整目录替换**，别把新旧产物混在一起：`index.html` 引用的是带哈希的
文件名，混着放会出现「刷新之后白屏，回滚也不好使」——那是浏览器缓存到了旧的
`index.html` 而它引用的分片已经没了。

⚠ **产物里有 `.mjs`**（pdf.js 的 worker）。nginx 自带的 `mime.types` 里没有这个
后缀，边缘那份配置要补一条 media type，否则**知识库的 PDF 预览一律画不出来**，
而访问日志里那条请求是干干净净的 200——见 §8.1 第 7 行。

---

## 4. 外部依赖初始化

### 4.1 建库与账号

七个 schema（`auth` / `platform` / `collect` / `opcua` / `realtime` / `assistant` /
`knowledge`）都在**同一个库**里，由各自的迁移链创建，见
[ADR-0003](adr/0003-一库多schema且写独占读放行.md)。本部署用的是库 `dt_db` +
`postgres` 账号（几份 `.env` 里已经填好，§5.6）：

```sql
-- psql -U postgres
CREATE DATABASE dt_db;
\c dt_db
-- ⚠ 扩展要超级用户才建得起来。迁移里写的是 CREATE EXTENSION IF NOT EXISTS，
-- 这里先建好，迁移跑到那一步就直接跳过。
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

⚠ **知识库那两个扩展不要在这里建。** `vector` 与 `pg_trgm` 由
`knowledge-migrate` 建**进 `knowledge` 这个 schema**，不是 `public`：应用连库时
`search_path` 恰好只有本服务那一个 schema，装在 `public` 的话 `vector` 这个类型
在运行期根本解析不出来，而报出来的是「type vector does not exist」——与「装没装
扩展」这件事看起来毫无关系。这里只需保证 §2.3 那个 `vector.dll` 已经在 PG 的
`lib\` 里，剩下的交给迁移。

验证：

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d dt_db -c "\dx"
# 期望列出 timescaledb（跑完 §6 的迁移之后还会多出 knowledge 里的 vector 与 pg_trgm）
```

⚠ 应用直接用 `postgres` 超级用户是**省事换来的**：它绕过一切库内权限边界，
一条写错的迁移能碰到这个实例上的任何东西。库里只跑这一个项目、且实例只监听
回环时可以接受；哪天这台机器还要放别的库，就改成专用账号：

```sql
CREATE ROLE dtapp LOGIN PASSWORD '<强口令>';
ALTER DATABASE dt_db OWNER TO dtapp;
GRANT ALL ON SCHEMA public TO dtapp;
-- 扩展仍然由 postgres 建（上面那条），dtapp 建不了
```

改账号要同时改**七份** `.env` 的 `*_POSTGRES_USER` / `_PASSWORD`——**改一份忘一份的
表现是那一个服务起不来，而别的六个都好**。

### 4.2 Redis

无口令实例请**只监听 127.0.0.1**；配了口令的把它填进每个服务的
`<前缀>_REDIS_PASSWORD`——本部署配了口令，各份 `.env` 里已经填好且取值一致
（§5.6）。⚠ 口令里带 `@` 之类的字符不用转义也不要加引号：连接串是代码拼的，
用户名与口令都过一遍百分号编码（`lib/config/base.py`）。自己在 `redis-cli`
或 `psql` 里手工验证时才需要按 shell 的规矩引起来。⚠ 全部服务共用同一个实例、同一个 `db`——快照、租约、
消费组（含知识库的摄取队列）、pub/sub 都在里面，不要为了「隔离」给某个服务换 `db`，
那会让 publisher 读不到 collector 写的快照、knowledge-worker 消费不到 api 投的
摄取任务。

### 4.3 现场 EMS 的 SQL Server（只读）

platform-server **必填**这一组（`PLATFORM_SQLSERVER_*`），缺一项就启动即失败。
现场没有这套系统时也要给出可解析的值（比如指向一个不存在的地址）——**连不上
不影响启动也不影响就绪**，只是空调数据面回 503（[ADR-0009](adr/0009-空调原始数据由平台直读外部EMS库.md)）。

⚠ `PLATFORM_SQLSERVER_CHARSET` 现场多半要填 `CP936`：老库的 varchar 列是本地
编码，配成 UTF-8 不报错、只出乱码。
⚠ `PLATFORM_ACSOURCE_TIMEZONE` 是**外库时间列的时区口径**，不是展示时区。填错
的表现是整屏数据平移几个小时而不报任何错。

### 4.4 对象存储：起服务、建桶、放开三个前缀

先用 nssm 把 MinIO 装成服务。⚠ 这里的 root 凭据必须与 `platform-server\.env` 里的
`PLATFORM_OBJECTSTORE_ACCESS_KEY` / `_SECRET_KEY` **逐字相同**（§5.6 里已经生成好了）：
分叉的表现是直传凭证签得出来、浏览器一传就 403，而两边的配置单看都对。

```powershell
$nssm = 'C:\DigitalTwin\tools\nssm\nssm.exe'
& $nssm install dt-minio C:\DigitalTwin\tools\minio\minio.exe
& $nssm set dt-minio AppParameters 'server C:\DigitalTwin\data\minio --address 127.0.0.1:9000'
& $nssm set dt-minio AppDirectory C:\DigitalTwin\tools\minio
& $nssm set dt-minio AppEnvironmentExtra MINIO_ROOT_USER=<OSS_ACCESS_KEY> MINIO_ROOT_PASSWORD=<OSS_SECRET_KEY>
& $nssm set dt-minio AppStdout C:\DigitalTwin\logs\minio.log
& $nssm set dt-minio AppStderr C:\DigitalTwin\logs\minio.err.log
& $nssm set dt-minio AppRotateFiles 1
& $nssm set dt-minio Start SERVICE_AUTO_START
Start-Service dt-minio
```

⚠ 本部署沿用 MinIO 的**出厂凭据**（`minioadmin`，见 `platform-server\.env`）。
那是一对众所周知的默认值：只有在 9000 端口**仅监听回环**时才勉强可接受，
一旦要让别的机器直连对象存储，先换掉它——换的时候记得 MinIO 服务的
`MINIO_ROOT_USER/PASSWORD` 与 platform 的两项要一起改。

再建桶并把三个前缀设成匿名可读（这一步等价于 compose 里的 `minio-init` 作业）：

```powershell
cd C:\DigitalTwin\tools\minio
.\mc.exe alias set dt http://127.0.0.1:9000 <OSS_ACCESS_KEY> <OSS_SECRET_KEY>
.\mc.exe mb --ignore-existing dt/digitaltwin
.\mc.exe anonymous set download dt/digitaltwin/models
.\mc.exe anonymous set download dt/digitaltwin/images
.\mc.exe anonymous set download dt/digitaltwin/icons
```

⚠ **`staging/` 不许设**：未验证的字节不许有一个本站链接。

⚠ **`knowledge/` 也不许设**，理由不同：知识库的原件与插图落在**同一个桶**的
`knowledge/` 前缀下，里面可能有涉密图纸。它们一律经 knowledge-server 的受管端点
取字节（前端拿到的是 object URL，不是桶地址），匿名放开等于把整个知识库摊在
`/oss/` 上。匿名可读的**只有** `models` / `images` / `icons` 这三个给现场大屏机
取素材的前缀。

⚠ 知识库与素材**共用一对凭据、一个桶**（`KNOWLEDGE_OBJECTSTORE_*` 与
`PLATFORM_OBJECTSTORE_*` 填同样的值，§5.2）。不必也不要给它单开一个桶：
桶名分叉之后 `/oss/` 那条 rewrite 只认一个，表现是素材好好的、知识库的图取不到。

⚠ **这一步最容易被跳过，而现象只在几周后出现。** 漏了它，大屏里的 3D 模型、
图片、图标一律 403（浏览器里看是「模型加载不出来」），而 nginx 那条 `/oss/` 反代
与 platform 签的直传凭证都是好的。判据：

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:9000/digitaltwin/models/__probe__
# 期望 404（NoSuchKey）。若是 403，说明匿名策略压根没设上
```

---

## 5. 配置

### 5.1 生成密钥

> 沿用已经生成好的那几份 `.env`（§5.6）时跳过本节——里面的密钥已经生成过，
> 且各份取值一致。本节留给**轮换**，以及在 Windows 上从 `.env.example` 从头配的场合。

```powershell
function New-Hex32 {
  $b = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}
function New-B64 { param($n=18)
  $b = New-Object byte[] $n
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  [Convert]::ToBase64String($b)
}

"AUTH_JWT_SECRET          = $(New-Hex32)"
"AUTH_EDGE_SIGNING_SECRET = $(New-Hex32)"
"AUTH_EDGE_SERVICE_KEY    = $(New-Hex32)"
"COLLECT_CREDENTIAL_SECRET= $(New-Hex32)"
"LLM_PROVIDER_SECRET      = $(New-Hex32)"
"OSS_ACCESS_KEY           = $(New-B64 12)"
"OSS_SECRET_KEY           = $(New-Hex32)"
"AUTH_SEED_ADMIN_PASSWORD = $(New-B64 18)"
```

把这一屏**存进密码库**，不要留在 PowerShell 历史里（`Clear-History` 只清当前会话，
`ConsoleHost_history.txt` 要另外删）。

### 5.2 共享值：哪几个必须逐字相同

这张表是本手册最容易出错的地方。**回退链必须每个服务都写全**：少写一处就是
非对称失效——发送端有值、接收端没有，表现是一律 401/403，而现象与原因隔得极远。

| 值 | 谁要写 | 写错/漏写的现象 |
|---|---|---|
| `AUTH_JWT_SECRET` | auth（`AUTH_JWT_SECRET`）、realtime（`REALTIME_JWT_SECRET`）| WS 握手一律被拒，HTTP 面完全正常 |
| `AUTH_EDGE_SIGNING_SECRET` | auth / platform ×3 / opcua / realtime / assistant / **knowledge ×2** | 登录成功，但业务面一律 401 |
| `AUTH_EDGE_SERVICE_KEY` | auth / platform ×3 / opcua / realtime / assistant / **knowledge ×2** / **collector** / **nginx 的 `X-Service-Key`** | 全站 403（nginx 那份写错）；采集永久空转（collector 那份写错）|
| `COLLECT_CREDENTIAL_SECRET` | platform ×3（`PLATFORM_COLLECT_CREDENTIAL_SECRET`）| 换过之后旧密文解不开：计划按「未配置凭据」下发并响亮记日志，界面上重填口令即恢复 |
| `LLM_PROVIDER_SECRET` | platform ×3（`PLATFORM_LLM_PROVIDER_SECRET`）| 留空即模型管理页整个 503，助手与知识库退回各自 `.env` 那一档；换过之后订阅账号那一行解不开，界面上变回「从来没登录过」 |
| `OSS_ACCESS_KEY` / `OSS_SECRET_KEY` | MinIO 自己的 root 凭据 / `mc` / platform ×3 / **knowledge ×2** | 直传凭证签得出来、浏览器一传就 403 |
| `KNOWLEDGE_INGEST_STREAM` / `_GROUP` | knowledge api 与 worker | 「投得进去、没人消费」，文档永远停在处理中，而两边单看都对 |

⚠ **同一个代码单元的几个角色共用一份 Settings**，所以密钥与对象存储这几项
**每个角色都要给全**，哪怕它一个字节都不读。platform 只给 api 的表现是
**api 健康、worker 与 publisher 无限重启**，日志里只有一行「配置错误：
PLATFORM_OBJECTSTORE_* Field required」；knowledge 少给 worker 的表现更隐蔽——
**检索面好好的，传上去的文档一直不动**。

### 5.3 跨服务地址：把服务名换成 127.0.0.1

代码里的默认值是**容器里的服务名**，在 Windows 上一个都解析不了。这九项必须逐个写：

| 变量 | 代码默认值 | Windows 取值 |
|---|---|---|
| `PLATFORM_OPCUA_BASE_URL` | `http://opcua-server:8008` | `http://127.0.0.1:8008` |
| `PLATFORM_REALTIME_BASE_URL` | `http://realtime-hub:8000` | `http://127.0.0.1:8000` |
| `COLLECT_PLATFORM_BASE_URL` | `http://platform-server:8005` | `http://127.0.0.1:8005` |
| `OPCUA_REALTIME_BASE_URL` | `http://realtime-hub:8000` | `http://127.0.0.1:8000` |
| `ASSISTANT_PLATFORM_BASE_URL` | `http://platform-server:8005` | `http://127.0.0.1:8005` |
| `ASSISTANT_AUTH_BASE_URL` | `http://auth-server:8004` | `http://127.0.0.1:8004` |
| `ASSISTANT_KNOWLEDGE_BASE_URL` | `http://knowledge-server:8009` | `http://127.0.0.1:8009`（不装知识库就留空）|
| `KNOWLEDGE_PLATFORM_BASE_URL` | `http://platform-server:8005` | `http://127.0.0.1:8005` |
| `REALTIME_AUTH_BASE_URL` | `http://auth-server:8001` ⚠ | `http://127.0.0.1:8004` |
| `ASSISTANT_MODEL_BASE_URL` / `KNOWLEDGE_*_BASE_URL` | 供应商端点 | 按供应商填；本机自建的推理端点也要写成 `127.0.0.1`，不是服务名 |

⚠ **`REALTIME_AUTH_BASE_URL` 的代码默认值端口是错的（8001，auth 实际在 8004）**，
compose 里靠显式覆盖遮住了。这里漏写的表现是：主题登记 fail-closed 被拒，
大屏订阅不到任何主题，而 auth 与 realtime 单看都健康。

⚠ **`ASSISTANT_KNOWLEDGE_BASE_URL` 留空是合法的**，语义是「这套部署没接知识库」：
助手那边的「查知识库」工具会如实这么回答，而不是报错。装了知识库却忘了改这一项
（还是容器里的服务名），表现是助手每次查知识库都超时。

### 5.4 Windows 专属的覆盖项

| 变量 | 值 | 为什么 |
|---|---|---|
| `<前缀>_APP_HTTP_HOST` | `127.0.0.1` | 默认 `0.0.0.0`；后端不能暴露在厂区网上（§1.1）。前缀 = `AUTH_` / `PLATFORM_` / `OPCUA_` / `REALTIME_` / `COLLECT_` / `ASSISTANT_` / `KNOWLEDGE_` |
| `OPCUA_PKI_DIR` | `C:\DigitalTwin\data\opcua-pki` | 默认是容器路径 `/var/lib/opcua/pki`，Windows 上建不出来 |
| `PLATFORM_ASSETCOMPRESS_SCRIPT` | `C:\DigitalTwin\app\server\services\platform-server\nodetools\compress-model.mjs` | 默认是镜像里的 `/app/nodetools/…`；不改的表现是每一档压缩都失败，原因写着「找不到文件」 |
| `PLATFORM_ASSETCOMPRESS_NODE` | `C:\Program Files\nodejs\node.exe` | 服务以 LocalSystem 跑，PATH 与你的登录会话不同；写绝对路径最省事 |
| `<前缀>_APP_LOG_FORMAT` | `json` | 与容器一致，便于同一套查询 |

⚠ **`ZoneInfoNotFoundError: 'Asia/Shanghai'`**：Windows 没有系统 tz 库。
platform-server 已经把 `tzdata` 声明成依赖，`uv sync` 会带上；**若你手工用 pip 装过
某个包导致它被卸掉**，表现是服务起来了，第一次读外库时才炸。

### 5.5 每个服务一份 `.env`

配置的来源是**服务目录下的 `.env`**（进程的 CWD 由 nssm 的 `AppDirectory` 指定，
见 §7）。七个服务各自带一份 `.env.example`，列全了那个服务的**全部**变量：

```powershell
$svc = 'C:\DigitalTwin\app\server\services'
foreach ($s in 'auth-server','platform-server','collector-server',
                'opcua-server','realtime-hub','ai-assistant','knowledge-server') {
  Copy-Item "$svc\$s\.env.example" "$svc\$s\.env"
}
```

⚠ **一个代码单元只有一份 `.env`**：platform 的三个角色共用 `platform-server\.env`、
knowledge 的两个角色共用 `knowledge-server\.env`，角色由 nssm 的环境变量顶掉
（§7.2）。所以是**七份文件、十一个进程**。

现成的、已经按 compose 口径填好取值的那几份见 §5.6——那条路省掉逐项对照。

⚠ **`.env` 必须是无 BOM 的 UTF-8。** 记事本另存为「UTF-8」会带 BOM，于是**第一个
变量名前面多一个不可见字符**——那一项静默变成「没配」，而文件看起来完全正常。
⚠ **PowerShell 5.1 的 `>` 与 `Set-Content -Encoding UTF8` 都会写出错的编码**
（前者 UTF-16LE，后者带 BOM）。要用脚本生成就用：

```powershell
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
```

⚠ **`.env` 里不要给值加引号**，也不要在值后面写行尾注释——它们会被逐字读进去。
Windows 路径尤其**不能**用双引号包起来：双引号里的 `\` 会被当成转义序列处理，
`C:\DigitalTwin\...` 于是变成一个谁也认不出来的字符串。不加引号直接写就是对的。

⚠ `.env` 里有明文密钥。收紧 ACL：

```powershell
icacls C:\DigitalTwin\app\server\services\*\.env /inheritance:r /grant "SYSTEM:(R)" /grant "Administrators:(F)"
```

### 5.6 七份完整 `.env`

每个代码单元一份，取值口径就是 `docker/compose.yml`，Windows 该改的地方
（回环地址、Windows 路径、角色）都要改过。**变量数以仓库里的 `.env.example`
为准**（它列全了那个服务的全部变量）：

| 文件 | 变量数 | 还要你填 |
|---|---|---|
| `services\auth-server\.env` | 44 | `AUTH_SEED_ADMIN_PASSWORD`（首次建管理员）|
| `services\platform-server\.env` | 119 | 现场 EMS 四项（`PLATFORM_SQLSERVER_*`）|
| `services\collector-server\.env` | 40 | —— |
| `services\opcua-server\.env` | 35 | —— |
| `services\realtime-hub\.env` | 39 | —— |
| `services\ai-assistant\.env` | 62 | ——（接模型另见 §5.7）|
| `services\knowledge-server\.env` | 81 | ——（接模型与解析另见 §5.8）|

没填的值都写成 `<说明>` 的样子，**逐个搜 `<` 就能找全**——留着不改的话服务会在
第一秒响亮失败，而不是带着一个错值跑起来。

⚠ **`.env` 不在版本库里**（`.gitignore` 挡着，这是对的）。所以 Windows 机器上
`git clone` 出来的检出**不会有这七份文件**：要么从生成它们的机器上拷过去，
要么在 Windows 上照 §5.5 从 `.env.example` 复制、再照 §5.1 生成密钥自己填。
拷过去之后确认编码没被改成带 BOM 的 UTF-8 或 UTF-16。

⚠ **从旧机器拷过来的那几份会缺项。** 加载器是 `extra="ignore"`，所以**多出来的
过期变量无害**，缺项才要命——缺的那些走代码默认值，而代码默认值是**容器口径**。
2026-09-01 那一版之后新加的，逐项补：

| 服务 | 新加的 | 缺了会怎样 |
|---|---|---|
| platform | `PLATFORM_LLM_PROVIDER_SECRET`、`PLATFORM_LLM_PROBE_TIMEOUT_S` | 模型管理页整个 503，助手与知识库退回各自 `.env` 那一档（[ADR-0039](adr/0039-模型供应商目录由平台持有两端按用途取用.md)）|
| platform | `PLATFORM_MODELING_*` 九项（`STREAM` / `GROUP` / `BLOCK_MS` / `PREFETCH` / `CLAIM_IDLE_MS` / `NODE_TIMEOUT_S` / `STALE_MINUTES` / `RUN_RETENTION_DAYS` / `RUN_KEEP_PER_PIPELINE`）| 有默认值，取默认即可；只有要调建模流水线的节流与留存才动 |
| assistant | **`ASSISTANT_AUTH_BASE_URL`** | ⚠ 默认值是容器服务名。表现是「**回合前半段好好的，后半段每个工具都报 platform 回了 401**」——委托身份几十秒就到期，续签走的正是这一格 |
| assistant | `ASSISTANT_KNOWLEDGE_BASE_URL`、`_LLM_CATALOG_*`、`_LLM_LOGIN_TIMEOUT_S` | 助手查不到知识库；模型目录拉不动就一直沿用上一份 |
| knowledge | 整份 | 这个服务是新的，`.env` 得从 `.env.example` 起一份 |

对一遍最省事的办法是拿 `.env.example` 的键与现有 `.env` 的键做差集：

```powershell
$svc = 'C:\DigitalTwin\app\server\services'
function Get-EnvKeys($path) {
  if (-not (Test-Path $path)) { return @() }
  Get-Content $path | ForEach-Object {
    if ($_ -match '^([A-Z][A-Z0-9_]*)=') { $Matches[1] }
  }
}
foreach ($d in Get-ChildItem $svc -Directory) {
  $have = Get-EnvKeys "$($d.FullName)\.env"
  $miss = @(Get-EnvKeys "$($d.FullName)\.env.example" | Where-Object { $_ -notin $have })
  if ($miss) { "$($d.Name) 缺 $($miss.Count) 项：$($miss -join '、')" }
}
```

⚠ 反过来的差集（`.env` 里有、`.env.example` 里没有）**不用管**：那是已经删掉的
配置项，加载器会忽略。删它只是为了看着干净。

已经替你定好、**不用再动**的取值：

| 项 | 取值 | 依据 |
|---|---|---|
| 七处 `*_POSTGRES_HOST/PORT/USER/DB` | `127.0.0.1:5432`、`postgres`、`dt_db` | §4.1 |
| 七处 `*_POSTGRES_PASSWORD`、`*_REDIS_PASSWORD` | 现场口令，**七份一致** | §4.1 / §4.2 |
| 七处 `*_REDIS_HOST/PORT` | `127.0.0.1:6379`（同实例同 `db`）| §4.2 |
| 七处 `*_APP_HTTP_HOST` | `127.0.0.1` | §1.1 |
| 九处跨服务地址（`*_BASE_URL`）| `http://127.0.0.1:<端口>` | §5.3 |
| 三个共享密钥（JWT / 边缘签名 / 服务级）| 随机 32 字节，**各份取值一致** | §5.2 |
| `PLATFORM_OBJECTSTORE_ENDPOINT`、`KNOWLEDGE_OBJECTSTORE_ENDPOINT` | `http://127.0.0.1:9000` | §4.4 |
| `PLATFORM_OBJECTSTORE_ACCESS_KEY` / `_SECRET_KEY`（`KNOWLEDGE_` 那对同值）| MinIO 出厂凭据 —— ⚠ 装 MinIO 时的 root 凭据要用**同一对**（§4.4）| §5.2 |
| `PLATFORM_COLLECT_CREDENTIAL_SECRET`、`PLATFORM_LLM_PROVIDER_SECRET` | 随机 32 字节 | §5.2 |
| `PLATFORM_ASSETCOMPRESS_NODE` / `_SCRIPT`、`OPCUA_PKI_DIR` | Windows 路径 | §5.4 |
| `PLATFORM_SQLSERVER_CHARSET` | `CP936` | §4.3 |

⚠ **库与 Redis 那几项七份必须一模一样**（同一个库、同一个账号、同一个 Redis
实例与 `db`，七个 schema）。改一份忘一份的表现是那一个服务起不来，而别的六个都好；
Redis 换了 `db` 更隐蔽——服务全都健康，只是 publisher 读不到 collector 写的快照、
knowledge-worker 消费不到摄取任务。

⚠ **platform 的三个角色共用 `platform-server\.env`、knowledge 的两个角色共用
`knowledge-server\.env`**，两份里写的都是 `…APP_ROLE=api`；其余角色由 nssm 的
环境变量覆盖（环境变量压过 `.env`，§7.2）。

### 5.7 助手接模型（可缺席）

不接模型也能起：能力面回「没接模型」，前端探测不到就干净地不出现入口。要接的话
按走哪一路填 `ai-assistant\.env` 里那一段；两路**并存**，由每个会话自己选。

| 走哪一路 | 至少要填 |
|---|---|
| 按量计费的 OpenAI 兼容端点 | `ASSISTANT_MODEL_ENABLED=true` + `ASSISTANT_MODEL_API_KEY` + `_BASE_URL` / `_CHAT` / `_VISION` |
| ChatGPT / Codex 订阅（ADR-0026 / ADR-0041）| 不配环境变量：`PLATFORM_LLM_PROVIDER_SECRET`（已生成）之外，去 系统管理 → 模型管理 建一路「Codex 订阅」形态的供应商，在那一行上走一次设备码登录 |

⚠ **开关为真却不给密钥/模型代号 = 启动即失败**，这是刻意的：「起来之后每次
对话才报错」比起不来难查得多。
⚠ `ASSISTANT_MODEL_TIMEOUT_S` 要小于边缘那条事件流 location 的
`proxy_read_timeout`（300s），否则边缘先掐断，服务端的超时分档一次都轮不到。

### 5.8 知识库接模型与解析（可缺席）

`knowledge-server\.env` 里有三组开关，**每组都是「开关为真却不给地址/密钥 =
启动即失败」**——刻意的，理由与助手那一路相同。全部留在 `false` 也起得来，
只是各少一块能力（§2.9）。

| 开关 | 开了之后至少要填 | 关着时 |
|---|---|---|
| `KNOWLEDGE_EMBEDDING_ENABLED` | `_BASE_URL` / `_API_KEY` / `_MODEL` / `_DIMENSIONS` / `_MAX_INPUT_TOKENS` | 检索如实回「这个库还没建索引」 |
| `KNOWLEDGE_MODEL_ENABLED` | `_BASE_URL` / `_API_KEY` / `_CHAT` / `_CONTEXT_TOKENS` | agentic 检索策略如实不可用 |
| `KNOWLEDGE_MINERU_ENABLED` | `_BASE_URL` | 不收 PDF |
| `KNOWLEDGE_ASR_ENABLED` | `_URL` | 没有麦克风键 |

⚠ **`KNOWLEDGE_EMBEDDING_DIMENSIONS` 要在跑迁移之前定好**：它同时是库上向量列的
`vector(N)`（§6）。

⚠ **`KNOWLEDGE_MODEL_CONTEXT_TOKENS` 不要凭印象填。** `0` 的语义是「不知道，
一格都不收紧」；给了之后一次检索回执、历史、这一轮加起来的字数都按它折算
（[KNOWLEDGE_CHAT_DESIGN §3.2](KNOWLEDGE_CHAT_DESIGN.md)）。本地 llama.cpp 看
`/props` 的 `n_ctx`——它是**启动参数**，多半远小于模型本身的训练长度。填大了等于
没填，表现是窗口小的模型**每次都在同一步失败**，而端点回的 400 与长度毫无关系。

⚠ 与助手同理，`KNOWLEDGE_MODEL_TIMEOUT_S` 要小于边缘那条对话事件流 location 的
`proxy_read_timeout`。

---

## 6. 迁移与种子（服务起之前）

容器里这是七个一次性作业，这里是**人跑的七条命令**。顺序无所谓，但**必须在起
服务之前跑完**：代码可回滚、数据库不回滚，所以永远是「新结构先就位，再放新代码
进来」。

每条命令都要**先 `cd` 到服务目录**——`alembic.ini` 与 `scripts\` 都按 CWD 找，
`.env` 也是。

```powershell
$py  = 'C:\DigitalTwin\app\server\.venv\Scripts\python.exe'
$al  = 'C:\DigitalTwin\app\server\.venv\Scripts\alembic.exe'
$svc = 'C:\DigitalTwin\app\server\services'

cd $svc\auth-server;      & $al upgrade head; & $py -m scripts.seed
cd $svc\platform-server;  & $al upgrade head; & $py -m scripts.seed
cd $svc\opcua-server;     & $al upgrade head
cd $svc\collector-server; & $al upgrade head
cd $svc\realtime-hub;     & $al upgrade head
cd $svc\ai-assistant;     & $al upgrade head
cd $svc\knowledge-server; & $al upgrade head
```

- **`collector-server` 那条别漏。** 它建 `collect` schema 与点位历史超表，建表时
  `CREATE EXTENSION timescaledb`。漏跑的表现是采集服务健康、日志也不报错，
  **但一条历史都落不进去**。
- **auth 与 platform 的迁移会加载整份 Settings**（不只是数据库那几项），所以那两个
  目录的 `.env` 要先填全，否则会以「Field required」失败，而报出来的字段与建表
  这件事完全对不上号。
- **`knowledge-server` 那条要先有 pgvector**（§2.3）。它装 `vector` 与 `pg_trgm`
  两个扩展、建向量表与三个索引（[ADR-0045](adr/0045-向量与关键词索引改为硬依赖.md)）。
  装不上就**响亮失败**，没有「退化成不带索引也能跑」那一档——那种退化在界面上
  与真检索长得一模一样，坏了没人看得出来。不起知识库就别跑这条，也不用装 pgvector。
- ⚠ **`KNOWLEDGE_EMBEDDING_DIMENSIONS` 在这一步定死。** 迁移建的是
  `vector(N)`，N 取自这一格，而服务两侧读的是同一格——所以**跑迁移前先把它改成
  真值**。忘了改的话建出来的是默认的 1536 维，两边单看都对，现象是每一次写向量
  都撞一条「expected 1536 dimensions」。改维数 = 一次新迁移 + 已有文档全部重解析。
- 验证到位：

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d dt_db -c "\dn"
# 期望列出 auth / platform / collect / opcua / realtime / assistant / knowledge
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d dt_db -c "\dx"
# 起了知识库的话还要有 vector 与 pg_trgm，且 Schema 那一列是 knowledge（不是 public）
```

⚠ **每次上新功能都要重跑 auth 的种子。** 权限码目录与路由规则是**代码里的真源**，
靠 `python -m scripts.seed` 写进库；加了新端点却没重跑，那一片接口在边缘**全部
403**，而直连服务端口却是好的，于是现象看着像「前端坏了」。种子可重复执行，
人工新建的规则不受影响；`ensure_admin` 对已存在的账号**一个字段都不动**——
所以想改 admin 口令，重跑种子没用。

---

## 7. 用 nssm 装十一个服务

### 7.1 一个服务的标准参数

以 `dt-auth` 为例，逐项说明为什么这么设：

```powershell
$nssm = 'C:\DigitalTwin\tools\nssm\nssm.exe'
$py   = 'C:\DigitalTwin\app\server\.venv\Scripts\python.exe'

& $nssm install dt-auth $py
& $nssm set dt-auth AppParameters '-m auth_server'
& $nssm set dt-auth AppDirectory  'C:\DigitalTwin\app\server\services\auth-server'
& $nssm set dt-auth AppEnvironmentExtra PYTHONUNBUFFERED=1
& $nssm set dt-auth AppStdout 'C:\DigitalTwin\logs\dt-auth.log'
& $nssm set dt-auth AppStderr 'C:\DigitalTwin\logs\dt-auth.err.log'
& $nssm set dt-auth AppRotateFiles 1
& $nssm set dt-auth AppRotateOnline 1
& $nssm set dt-auth AppRotateBytes 20971520
& $nssm set dt-auth AppExit Default Restart
& $nssm set dt-auth AppRestartDelay 5000
& $nssm set dt-auth AppThrottle 10000
& $nssm set dt-auth AppStopMethodConsole 25000
& $nssm set dt-auth Start SERVICE_DELAYED_AUTO_START
& $nssm set dt-auth DependOnService postgresql-x64-17 Memurai
& $nssm set dt-auth DisplayName 'DigitalTwin auth-server'
& $nssm set dt-auth Description '认证、RBAC 权限判定、路由规则与边缘鉴权端点'
```

| 参数 | 为什么 |
|---|---|
| `Application` = venv 里的 `python.exe`，`AppParameters` = `-m <包名>` | 与 `auth-server.exe` 那个 console script 等价，但 **`-m` 形式的 `__main__` 是一个带 `if __name__ == "__main__"` 护栏的正常模块**。platform-worker 要起进程池（模型训练），而 Windows 只有 `spawn`——子进程会重新导入主模块。统一用 `-m` 就不必去区分哪个服务有进程池 |
| `AppDirectory` = 服务目录 | 进程的 CWD。`.env` 从这里读，`alembic`、`python -m scripts.*` 也按它找自己那份。**设错了不会报错，只是配置全部变成「没配」** |
| `PYTHONUNBUFFERED=1` | 不设的话 stdout 有缓冲，日志要攒够一块才落盘——**进程崩溃时最后那几行（也就是最有用的几行）永远看不到** |
| `AppExit Default Restart` + `AppRestartDelay` + `AppThrottle` | Windows 服务依赖只保证「被依赖的服务已启动」，不保证「能应答」。库还没起来时进程会退出，靠这三项自愈；`AppThrottle` 让反复失败的服务退避，不至于把日志刷爆 |
| `AppStopMethodConsole 25000` | nssm 停服务时先往应用的控制台发 Ctrl+C。**代码在 Windows 上正是靠它优雅关停**（`lib/lifespan.py` 里 `loop.add_signal_handler` 抛 `NotImplementedError` 后退回 `signal.signal`）。25s 要大于 `APP_DRAIN_TIMEOUT_S`（默认 20s）|
| **不要设 `AppNoConsole`** | 设了就没有控制台，Ctrl+C 发不出去，nssm 只能一路降级到 `TerminateProcess`——**采集租约不让、在途请求直接断**，重启后要等一个 TTL 才恢复 |
| `Start SERVICE_DELAYED_AUTO_START` | 延迟自动启动，把开机时的抢跑（Docker 之外最常见的启动失败原因）压下去 |

### 7.2 一次装齐

```powershell
$nssm = 'C:\DigitalTwin\tools\nssm\nssm.exe'
$py   = 'C:\DigitalTwin\app\server\.venv\Scripts\python.exe'
$svc  = 'C:\DigitalTwin\app\server\services'
$log  = 'C:\DigitalTwin\logs'
# 依赖服务名。⚠ 必须是**本机真实存在**的名字：写错了 nssm 直接拒绝
# （`Error setting parameter "DependOnService"`），而服务本身照样装好。这里自动找
$deps = @(
  (Get-Service | Where-Object Name -like 'postgresql*' | Select-Object -First 1).Name
  (Get-Service | Where-Object { $_.Name -like 'Memurai*' -or $_.Name -like '*redis*' } |
     Select-Object -First 1).Name
) | Where-Object { $_ }
"依赖服务：$($deps -join '、')"

$units = @(
  @{ n='dt-auth';                d="$svc\auth-server";      m='auth_server';      e=@();                              t='auth-server' }
  @{ n='dt-realtime';            d="$svc\realtime-hub";     m='realtime_hub';     e=@();                              t='realtime-hub' }
  @{ n='dt-platform';            d="$svc\platform-server";  m='platform_server';  e=@('PLATFORM_APP_ROLE=api');       t='platform-server (api)' }
  @{ n='dt-platform-worker';     d="$svc\platform-server";  m='platform_server';  e=@('PLATFORM_APP_ROLE=worker');    t='platform-server (worker)' }
  @{ n='dt-platform-publisher';  d="$svc\platform-server";  m='platform_server';  e=@('PLATFORM_APP_ROLE=publisher'); t='platform-server (publisher)' }
  @{ n='dt-opcua';               d="$svc\opcua-server";     m='opcua_server';     e=@();                              t='opcua-server' }
  @{ n='dt-collector';           d="$svc\collector-server"; m='collector_server'; e=@();                              t='collector-server' }
  @{ n='dt-assistant';           d="$svc\ai-assistant";     m='ai_assistant';     e=@();                              t='ai-assistant' }
  @{ n='dt-knowledge';           d="$svc\knowledge-server"; m='knowledge_server'; e=@('KNOWLEDGE_APP_ROLE=api');      t='knowledge-server (api)' }
  @{ n='dt-knowledge-worker';    d="$svc\knowledge-server"; m='knowledge_server'; e=@('KNOWLEDGE_APP_ROLE=worker');   t='knowledge-server (worker)' }
)

foreach ($u in $units) {
  & $nssm install $u.n $py
  & $nssm set $u.n AppParameters "-m $($u.m)"
  & $nssm set $u.n AppDirectory  $u.d
  & $nssm set $u.n AppEnvironmentExtra (@('PYTHONUNBUFFERED=1') + $u.e)
  & $nssm set $u.n AppStdout "$log\$($u.n).log"
  & $nssm set $u.n AppStderr "$log\$($u.n).err.log"
  & $nssm set $u.n AppRotateFiles 1
  & $nssm set $u.n AppRotateOnline 1
  & $nssm set $u.n AppRotateBytes 20971520
  & $nssm set $u.n AppExit Default Restart
  & $nssm set $u.n AppRestartDelay 5000
  & $nssm set $u.n AppThrottle 10000
  & $nssm set $u.n AppStopMethodConsole 25000
  & $nssm set $u.n Start SERVICE_DELAYED_AUTO_START
  if ($deps) { & $nssm set $u.n DependOnService $deps }
  & $nssm set $u.n DisplayName "DigitalTwin $($u.t)"
}
```

跑完这一段，输出里有两条**看着像错、其实不是**的：

- `Reset parameter "AppExit" for service "dt-xxx" to its default.` —— nssm 的默认
  退出动作本来就是 Restart，把它设成 Restart 于是被当作「恢复默认」。核实一下就
  安心了：`& $nssm get dt-auth AppExit` 应当回 `Restart`。
- `Error setting parameter "DependOnService"` + `<名字>: 服务不存在` —— 只说明那个
  依赖名在本机不存在（PostgreSQL 装的是别的大版本、Redis 不叫 Memurai、或者它们
  压根不是以服务方式跑的）。**服务本身已经装好了**，这一项只影响开机时的启动
  顺序；不设的话早起的服务连不上库会退出，再由 `AppExit Restart` 拉起来，只是
  开机后多几秒才齐。要补上就先查真名：`Get-Service | Where-Object Name -like '*postgre*'`。

⚠ **`AppEnvironmentExtra` 是整体覆盖的**：再 `set` 一次会把上一次的全部替换掉，
所以要一次给全。角色只能从这里给——三个 platform 服务共用一份 `.env`、两个
knowledge 服务共用另一份，**环境变量压过 `.env`**，这正是我们要的：那两份 `.env`
里写着 `PLATFORM_APP_ROLE=api` 与 `KNOWLEDGE_APP_ROLE=api`，其余角色靠这里的
环境变量把它顶掉。漏给角色的表现是**两个进程都以 api 起来**——端口撞车，
后起的那个反复重启，而它本该是不监听的那个。

⚠ `dt-assistant` 不部署助手就别装，或者装了之后 `Set-Service dt-assistant -StartupType Disabled`。
它缺席时前端探测不到，助手入口**干净地不出现**，别的功能一件不少。
`dt-knowledge` / `dt-knowledge-worker` 同理——但那两个要**一起装或一起不装**：
只装 api 的表现是检索面好好的、传上去的文档永远停在处理中（§1.1）。

### 7.3 启动与自检

**起之前先自检四项。** 服务装好却起不来，九成是这四条里的一条，而 Windows 只给
你一句「服务未能启动」：

```powershell
# 新开的窗口里先把这四个变量重新定义一遍（§7.2 那一段里的同名变量不跨会话）
$nssm = 'C:\DigitalTwin\tools\nssm\nssm.exe'
$py   = 'C:\DigitalTwin\app\server\.venv\Scripts\python.exe'
$svc  = 'C:\DigitalTwin\app\server\services'
$log  = 'C:\DigitalTwin\logs'

Test-Path $py                                       # ① 解释器在不在
Test-Path $log                                      # ② 日志目录在不在（nssm 不会替你建）
Get-ChildItem $svc\*\.env | Select-Object FullName  # ③ 七份 .env 在不在
& $nssm get dt-auth AppDirectory                    # ④ 参数写对没有
& $nssm get dt-auth AppParameters
```

⚠ **`.venv` 不能从别的机器拷过来。** macOS / Linux 上装出来的 venv 里根本没有
`Scripts\python.exe`（那边叫 `bin/python`），而可编辑安装的 `.pth` 里写的还是那台
机器的绝对路径。表现正是「服务装好、一启动就停」。在**这台**机器上跑一次
`uv sync --all-packages --frozen --no-dev`（§3.2）。

**最快的定位办法是把它前台跑一遍**——服务方式下看不见的报错，这里直接打在屏幕上：

```powershell
cd $svc\auth-server
& $py -m auth_server
```

| 前台跑出来的 | 说明 |
|---|---|
| `配置错误：<变量名>: Field required` | `.env` 没被读到（CWD / `AppDirectory` 不对），或那一项确实没填 |
| `ZoneInfoNotFoundError` | §5.4 |
| 立刻退回提示符、一个字都没打 | 解释器不在那个路径，或这个 venv 里没装这个包——回 ① 与 §3.2 |
| 停住不动、不再输出 | **正常**（uvicorn 起来了）。Ctrl+C 停掉，再 `Start-Service dt-auth` |

按依赖顺序起，每起一个看一眼探针：

```powershell
Start-Service dt-auth, dt-realtime, dt-opcua
Start-Service dt-platform, dt-platform-worker, dt-platform-publisher
Start-Service dt-collector, dt-assistant
Start-Service dt-knowledge, dt-knowledge-worker

Get-Service dt-* | Format-Table Name, Status, StartType

$probes = @(
  @{ p=8004; u='auth'      }, @{ p=8005; u='platform'  }, @{ p=8000; u='realtime' },
  @{ p=8008; u='opcua'     }, @{ p=8007; u='collector' }, @{ p=8006; u='assistant' },
  @{ p=8009; u='knowledge' }
)
foreach ($x in $probes) {
  '{0,-10} {1}' -f $x.u, (curl.exe -s -o NUL -w '%{http_code}' "http://127.0.0.1:$($x.p)/api/v1/$($x.u)/health")
}
# 七行都应当是 200（没装助手/知识库时那几行连不上，属正常）
```

⚠ **`dt-platform-worker` / `dt-platform-publisher` / `dt-knowledge-worker` 没有探针**，
它们不监听 HTTP。判据只有日志：起来之后 `dt-*.log` 里不再反复出现启动那几行。
知识库的 worker 还有一条更直接的——传一份文档进去，它应当从「处理中」走到
「就绪」；一直不动就是 worker 没起来或队列名两侧分叉（§5.2）。

⚠ **`Status: Running` 不等于起来了。** nssm 会在进程秒退时不停重启，服务面板里
看着是「正在运行」。判据只有两个：探针 200，以及 `dt-*.log` 里没有反复出现的启动日志。
配置错误一律打在 **`.err.log`** 里，第一行就是「配置错误：<变量名>: Field required」。

### 7.4 常用运维命令

```powershell
Restart-Service dt-platform            # 改了 .env 之后必须重启才生效
Get-Content C:\DigitalTwin\logs\dt-platform.log -Tail 50 -Wait
& $nssm edit dt-platform               # 图形界面看/改参数
& $nssm remove dt-platform confirm     # 卸载
```

### 7.5 防火墙

只放两处，其余一律不放：

```powershell
New-NetFirewallRule -DisplayName 'DigitalTwin edge (HTTP)' -Direction Inbound `
  -Protocol TCP -LocalPort 82 -Action Allow
# ⚠ 端口段必须与 OPCUA_PORT_POOL 逐字一致。放窄了的表现是实例「显示运行中但
# 上位机连不上」——这是最难排查的一类故障
New-NetFirewallRule -DisplayName 'DigitalTwin OPC UA' -Direction Inbound `
  -Protocol TCP -LocalPort 4840-4859 -Action Allow
```

⚠ **采集机的网络前置条件**：collector 是唯一持有现场连接的进程，这台机器必须
接得到工控网段（多网卡或静态路由）。这是节点级配置，不是应用配置——配不对的
表现是「服务健康但一个点位都采不到」。

---

## 8. edge-gateway：Windows 版 nginx

### 8.1 与仓库模板的差异

权威模板是 [`docker/nginx/nginx.conf.template`](../docker/nginx/nginx.conf.template)。
Windows 版只改这七处，**其余一行都不要动**：

| # | 模板 | Windows | 为什么 |
|---|---|---|---|
| 1 | `resolver 127.0.0.11` + 服务名上游 | 删掉 resolver，上游写成 `127.0.0.1:<端口>` | 没有 Docker 内嵌 DNS。取值是 IP 字面量，`proxy_pass` 走变量也不需要解析器 |
| 2 | `${OSS_UPSTREAM}` `${OSS_BUCKET}` `${AUTH_EDGE_SERVICE_KEY}` 由 envsubst 渲染 | **手工填成实际值** | Windows 版 nginx 没有 envsubst 那一步 |
| 3 | `access_log /dev/stdout` | `logs/access.log` | 没有 stdout 可收 |
| 4 | `worker_processes auto` / `worker_connections 2048` | `1` / `1024` | nginx/Windows 只有一个 worker 真干活；`select()` 的上限是 1024 |
| 5 | `include /etc/nginx/conf.d/xxx.conf`（绝对路径）、`root /usr/share/nginx/html` | `include xxx.conf`（**裸文件名**）、`root` 指向真实 dist | ⚠ `include` 的相对路径按**主配置文件所在目录**解析：Windows 的主配置在 `conf\` 里，写成 `conf/xxx.conf` 会被拼成 `conf\conf\xxx.conf`，nginx 直接起不来。容器那份能带前缀是因为主配置在 `/etc/nginx/` 根上 |
| 6 | 无 | `daemon off;` | nssm 靠「进程活着」判断服务状态；nginx 自我 daemon 化会让 nssm 看见进程立刻退出，于是无限重启 |
| 7 | `types { text/javascript mjs; }` 在 http 块里 | **形态 A 已带**（`nginx.windows.conf`）；**形态 B 要自己补进对方的 http 块** | 自带的 `mime.types` 里没有 `.mjs`，ES 模块被发成 `application/octet-stream`、浏览器当场拒收。⚠ 不能写进 server/location：`types` 块**丢掉整份继承**，别的静态文件会跟着一起变成 octet-stream |

### 8.2 两份配置文件

仓库里是拆开的两份，**去处不同**：

| 文件 | 是什么 | 什么时候拷 |
|---|---|---|
| [`docker/nginx/dt-edge.windows.conf`](../docker/nginx/dt-edge.windows.conf) | 站点本体：限流区、`map`、整个 `server`（含前端与全部反代）| **总是拷** |
| [`docker/nginx/nginx.windows.conf`](../docker/nginx/nginx.windows.conf) | 独立部署时的外壳：进程与 `http` 的公共设置，末尾 `include dt-edge.windows.conf;` | 只有「这台 nginx 专门给 DigitalTwin 用」时才拷 |

两种形态都用真 nginx `-t` 验过。

**形态 A：专用 nginx**

```powershell
$src = 'D:\AI\DigitalTwin'; $nginx = 'D:\nginx'
Copy-Item "$src\docker\nginx\nginx.windows.conf" "$nginx\conf\nginx.conf"
Copy-Item "$src\docker\nginx\dt-edge.windows.conf", `
          "$src\docker\nginx\proxy-common.conf", `
          "$src\docker\nginx\auth-inject.conf" "$nginx\conf\"
```

**形态 B：与别的站点共用一台 nginx**（`conf\sites-enabled\` 那种布局）

只拷站点本体，整段 include 进对方的 `http { }`：

```powershell
$src = 'D:\AI\DigitalTwin'; $nginx = 'D:\nginx'
Copy-Item "$src\docker\nginx\dt-edge.windows.conf" "$nginx\conf\sites-enabled\platform-82.conf"
# ⚠ 这两份要落在 conf\ **根目录**，不是 sites-enabled\ 里，理由见 §8.3
Copy-Item "$src\docker\nginx\proxy-common.conf", "$src\docker\nginx\auth-inject.conf" "$nginx\conf\"
```

对方的 `nginx.conf` 的 `http { }` 里要有一行把它包进来（多半本来就有）：

```nginx
http {
    ...
    include sites-enabled/*.conf;
}
```

⚠ **必须在 `http { }` 里面。** `map` 与 `limit_req_zone` 只在 http 级合法，位置
不对的报错是 `"map" directive is not allowed here`。

⚠ **形态 B 还要往对方的 `http { }` 里补一条 `.mjs` 的 media type**（§8.1 第 7 行）——
站点文件替不了这件事。漏了的表现极难对上号：**知识库的 PDF 预览一律画不出来**，
而那条请求在访问日志里是干干净净的 200。

```nginx
http {
    include mime.types;
    types { text/javascript mjs; }   # ← 补这一行
    ...
}
```

⚠ 改完验证要**先关浏览器缓存**：不关的话浏览器还在用上一次那份 octet-stream 的
缓存，看着像「改了没生效」。判据：

```powershell
# 文件名带构建哈希，先从 dist 里找出真名
$mjs = (Get-ChildItem D:\AI\DigitalTwin\web\app\dist\assets -Filter *.mjs | Select-Object -First 1).Name
curl.exe -s -I "http://127.0.0.1:82/assets/$mjs" | findstr /i content-type
# 期望 text/javascript，不是 application/octet-stream
```

⚠ **站点文件里的变量与限流区一律带 `dt_` 前缀**（`$dt_connection_upgrade`、
`zone=dt_login` …）。共用一台 nginx 时，`$connection_upgrade` 这种通名跟别的站点
撞上就是 `duplicate ...`，而后果是**整个 nginx 起不来**——别的站点跟着一起没。
别为了「看着眼熟」把前缀去掉。

**两种形态都要填的三处**

| 指令 | 本部署的值 | 说明 |
|---|---|---|
| `listen` | `82` | 对外端口。换端口只改这一行——前端地址一律相对路径，不受影响 |
| `root` | `D:/AI/DigitalTwin/web/app/dist` | 前端构建产物。⚠ **正斜杠**：反斜杠在 nginx 配置里是转义符 |
| `X-Service-Key`（`location = /_auth`）| auth 的 `AUTH_EDGE_SERVICE_KEY` | 仓库里是占位符。与 auth-server 分叉 = 受管接口**全站 403** |

密钥别手抄，从 `.env` 里取：

```powershell
$f    = "$nginx\conf\sites-enabled\platform-82.conf"   # 形态 A 是 $nginx\conf\dt-edge.windows.conf
$key  = ((Get-Content "$src\server\services\auth-server\.env") -match '^AUTH_EDGE_SERVICE_KEY=')[0].Split('=', 2)[1].Trim()
$conf = (Get-Content $f -Raw).Replace('<AUTH_EDGE_SERVICE_KEY>', $key)
# ⚠ 必须写成**无 BOM 的 UTF-8**：nginx 把 BOM 当成指令，报 `unknown directive`
[System.IO.File]::WriteAllText($f, $conf, (New-Object System.Text.UTF8Encoding($false)))

# ⚠ **回读确认一遍**：应当打印 64 位十六进制，而不是 `<AUTH_EDGE_SERVICE_KEY>`。
# 占位符没被替换掉时 `nginx -t` 照样通过（它只是一个合法的头值），而现象是
# 登录正常、**其余接口一律 401**——那是 auth 的 40105「服务级密钥不符」
[regex]::Match((Get-Content $f -Raw), 'X-Service-Key\s+"([^"]*)"').Groups[1].Value

& "$nginx\nginx.exe" -t -p ($nginx -replace '\\','/')    # 必须 test is successful
& "$nginx\nginx.exe" -s reload                            # ⚠ -t 通过不等于生效
```

⚠ **`root` 指的那个目录得先有东西。** 前端产物是 `pnpm build` 出来的（§3.4）；
没构建过的表现是**首页 404 而 `/api/v1/auth/health` 正常**，看着像 nginx 配错了。

```powershell
Test-Path D:\AI\DigitalTwin\web\app\dist\index.html
```

### 8.3 两份 include 放哪

`proxy-common.conf` 与 `auth-inject.conf` **原样**从仓库拷过来，一个字都不要改，
且必须落在 **`nginx.conf` 所在的那个目录**（即 `conf\`）。

⚠ **不是跟站点文件放一起。** nginx 的 `include` 相对路径按 **conf_prefix** 解析
——也就是**主配置文件所在的目录**——哪怕这条 `include` 写在被包含的子文件里也
一样。放进 `sites-enabled\` 的报错长这样：

```
nginx: [emerg] CreateFile() "D:\nginx/conf/proxy-common.conf" failed (2: 系统找不到指定的文件)
       in D:\nginx/conf/sites-enabled/platform-82.conf:86
```

——它已经告诉你它在 `conf\` 根上找了。真想跟站点文件放一起，就把站点文件里那
两条改成 `include sites-enabled/proxy-common.conf;`。

⚠ `auth-inject.conf` 里抄漏任何一行都是静默失效：漏一个 `auth_request_set`，
上游收到空值，表现为「登录了但一直 401」。

### 8.4 装成服务

⚠ **形态 B（与别的站点共用）跳过这一节**：那台 nginx 早就在跑了，改完配置
`nginx.exe -s reload` 就行，别再装第二个 nginx 服务去抢端口。

```powershell
$nginx = 'D:\nginx'
& "$nginx\nginx.exe" -t -p ($nginx -replace '\\','/')   # 先验配置，必须 test is successful

& $nssm install dt-edge "$nginx\nginx.exe"
& $nssm set dt-edge AppParameters "-p $($nginx -replace '\\','/')"
& $nssm set dt-edge AppDirectory  $nginx
& $nssm set dt-edge AppExit Default Restart
& $nssm set dt-edge AppRestartDelay 5000
& $nssm set dt-edge Start SERVICE_DELAYED_AUTO_START
& $nssm set dt-edge DependOnService dt-auth dt-platform
& $nssm set dt-edge DisplayName 'DigitalTwin edge-gateway (nginx)'
Start-Service dt-edge
```

- `-p` 定的是 **prefix**：`logs\`、`temp\`、`root` 的相对路径按它算。
  ⚠ 两份 include 不按它算，按**主配置文件所在的目录**（§8.3）。
- **nginx 自己写 `logs\access.log` 与 `logs\error.log`**，不走 nssm 的重定向。
  轮转要单独做：改名之后 `nginx.exe -s reopen`（直接删文件的话，句柄还开着，
  磁盘不会真的释放）。
- 停服务时 nssm 发 Ctrl+C，nginx 按**快速关停**处理。要优雅关停（等在途请求跑完）
  就先手工 `nginx.exe -s quit`。

---

## 9. 验收清单

十条，逐条跑完再交付。每条都给了期望值，**对不上就停下来查**，不要凑合往下走。

```powershell
$edge = 'http://127.0.0.1:82'   # 边缘的端口，见 §8.2
```

**① 边缘到六个服务都通**

```powershell
foreach ($u in 'auth','platform','opcua','realtime','assistant','knowledge') {
  "{0,-10} {1}" -f $u, (curl.exe -s -o NUL -w "%{http_code}" "$edge/api/v1/$u/health")
}
# auth / platform / opcua / realtime 必须 200；
# assistant 与 knowledge 没部署时 502 是正常的——前端把 502 读成「这套部署没有它」，
# 入口于是干净地不出现
```

**② 前端发得出来**

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" $edge/                 # 200
curl.exe -s -o NUL -w "%{http_code}`n" $edge/dashboards       # 200（SPA 深链，走 try_files）
```

**③ 匿名被拒**

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" $edge/api/v1/platform/dashboard-projects   # 401
curl.exe -s -o NUL -w "%{http_code}`n" $edge/internal/v1/verify           # 403（deny all）
```

**④ 登录拿到令牌**

```powershell
$body = '{"username":"admin","password":"<AUTH_SEED_ADMIN_PASSWORD>"}'
$r = Invoke-RestMethod -Uri "$edge/api/v1/auth/sessions" -Method Post `
       -ContentType 'application/json' -Body $body
$tok = $r.data.token.access_token
$r.data.user.username    # admin
```

**⑤ 带令牌能读业务面**（这一条同时验了边缘的签名头注入与 platform 的验签）

```powershell
Invoke-RestMethod -Uri "$edge/api/v1/platform/dashboard-projects" `
  -Headers @{ Authorization = "Bearer $tok" } | Select-Object -First 1
# 200 且信封是 {code,message,data,trace_id}
```

**⑥ 权限闸真的在判**（用一个 viewer 账号，不是 admin）

```powershell
# viewer 读 200、写 403。两条都对才说明闸 1 与闸 2 都活着；
# 全 200 说明规则表没生效，全 403 说明种子没跑或服务级密钥分叉
```

**⑦ WebSocket 握手到 hub**

```powershell
curl.exe -i -s -N --max-time 5 `
  -H "Connection: Upgrade" -H "Upgrade: websocket" `
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" `
  -H "Sec-WebSocket-Protocol: dt.auth, $tok" `
  "$edge/api/v1/realtime/ws" | Select-Object -First 3
# 期望第一行 HTTP/1.1 101 Switching Protocols
```

⚠ 拿到 400/426 = 边缘没把 Upgrade 转上去（`proxy_set_header Upgrade/Connection` 缺一条）；
拿到 401/403 = `REALTIME_JWT_SECRET` 与 `AUTH_JWT_SECRET` 分叉。

**⑧ 素材字节匿名可取**

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" "$edge/oss/models/__probe__"
# 期望 404（NoSuchKey）。403 = MinIO 匿名策略没设（§4.4）；502 = 上游地址不对
```

**⑨ 端到端一次**：浏览器登录 → 打开一块有实时数据的大屏 → 数值在动。
数值不动但页面正常 = publisher 或 collector 没干活，看 §11。

**⑩ 知识库摄取跑得通**（没装知识库就跳过）

界面上传一份小的 `.md` 或 `.docx`，盯它的状态：

- 走到**就绪** = api 投得进队列、worker 消费得到、对象存储写得进去。三者缺一
  这一步就停在「处理中」。
- 一直停在**处理中** = `dt-knowledge-worker` 没起，或 `KNOWLEDGE_INGEST_STREAM`
  / `_GROUP` 两侧分叉（§5.2），或 worker 那边少给了对象存储四项（§1.1）。
- **摄取失败**且理由是维数 = `KNOWLEDGE_EMBEDDING_DIMENSIONS` 与目录里那个嵌入
  模型对不上（§6）。

再检索一次刚传的内容：搜得到 = 嵌入端点通；如实回「这个库还没建索引」= 嵌入档
没开，这**不是故障**（§2.9）。

传一份 PDF 是第二条判据：`KNOWLEDGE_MINERU_ENABLED=false` 时上传面**拒收**并给一句
点得出名字的错——这是对的；收下了却永远解析不完，才是接了 MinerU 但连不上。

---

## 10. 日常运维

### 10.1 日志

| 来源 | 位置 |
|---|---|
| 十一个服务的 stdout/stderr | `C:\DigitalTwin\logs\dt-*.log` / `dt-*.err.log`（nssm 按 20MB 轮转）|
| nginx | `C:\DigitalTwin\tools\nginx\logs\access.log` / `error.log`（**自己轮转**，改名后 `nginx -s reopen`）|
| PostgreSQL / Redis / MinIO | 各自的安装目录 |

日志是**结构化 JSON**，一行一条，`event` 是稳定字面量。查一件事：

```powershell
Select-String -Path C:\DigitalTwin\logs\dt-collector.log -Pattern '"event":"plan_applied"' -Tail 20
```

⚠ **`grep ERROR` 会骗人**：JSON 里的 `stack` 字段带 `Traceback`，那条可能只是
WARNING。按 `"level":"ERROR"` 筛。

### 10.2 升级

顺序是死的：**迁移先行，且只做扩展步**——代码可回滚、数据库不回滚，所以
「新结构 + 旧代码」必须可用。

```powershell
cd C:\DigitalTwin\app
git pull

# 1) 依赖变了才需要（pyproject/uv.lock 有改动）
cd server; uv sync --all-packages --frozen --no-dev

# 2) 前端变了才需要
cd ..\web; pnpm install --frozen-lockfile; pnpm build

# 3) 迁移（七条，见 §6）——服务还在跑着，扩展步与旧代码兼容

# 4) 只要加过端点/权限码，就重跑 auth 种子（见 §6 的告诫）

# 5) 加过新配置项？逐服务补进 .env（§5.6 那段差集脚本一跑就知道缺哪些）

# 6) 重启。worker/publisher/collector 先，api 与 edge 后
Restart-Service dt-platform-worker, dt-platform-publisher, dt-collector, dt-knowledge-worker
Restart-Service dt-auth, dt-platform, dt-realtime, dt-opcua, dt-assistant, dt-knowledge
# nginx 配置没改就不用动 dt-edge
```

回滚只回代码（`git checkout <上一版>` + 重启），**不回滚数据库**。

### 10.3 备份

| 对象 | 命令 / 说明 | 丢了会怎样 |
|---|---|---|
| 数据库 | `pg_dump -U postgres -d dt_db -Fc -f dt-<日期>.dump` | 一切业务数据 |
| 对象存储 | `mc mirror dt/digitaltwin C:\DigitalTwin\backup\oss` | 存量大屏里每一个 `asset:` 引用变成「取不到」 |
| **`data\opcua-pki`** | 直接拷目录 | **全部 OPC UA 实例的证书作废，每台上位机都要重新信任新证书**。⚠ 它不在数据库里，不随数据库备份走 |
| 七份 `.env` + `nginx\conf` | 加密存放（含明文密钥）| 重建时要重新生成密钥 = 全体登出 + 数据源口令要重填 |

⚠ **`AUTH_JWT_SECRET` 换了 = 全体登出**；轮换时把旧值放进
`AUTH_JWT_PREVIOUS_SECRET`，观察在线用户归零后再清空。
⚠ **`PLATFORM_COLLECT_CREDENTIAL_SECRET` 换了 = 库里的数据源口令密文解不开**，
计划会按「未配置凭据」下发并响亮记日志，界面上重填口令即恢复。
⚠ **`PLATFORM_LLM_PROVIDER_SECRET` 换了 = 模型供应商目录里那些密钥与订阅登录态
解不开**（[ADR-0041](adr/0041-订阅账号凭据归平台持有.md)），界面上会变回「从来
没登录过」，重新填密钥/重新登录即恢复。
⚠ **对象存储那份备份要连 `knowledge/` 前缀一起走**：知识库的原件与插图都在那里，
丢了之后文档行还在、原件预览与引用里的图全变成取不到。

---

## 11. 故障速查

| 现象 | 根因 | 处置 |
|---|---|---|
| 受管接口**全部 403**，直连服务端口却是好的 | ① nginx 的 `X-Service-Key` 与 `AUTH_EDGE_SERVICE_KEY` 分叉；② auth 种子没跑（**无规则一律拒绝**）| 核对两处取值；`cd auth-server; python -m scripts.seed` |
| 登录成功，**受管接口一律 401**，返回的是 nginx 自己那张 HTML 错误页 | `/_auth` 子请求被 auth 拒了。九成是边缘的 `X-Service-Key` 还是占位符或与 `.env` 分叉（`ServiceKeyInvalid`，code 40105，HTTP **401**）| 见下面 §11.1 的判据 |
| 登录成功，业务面 401，但 `/_auth` 是通的 | `EDGE_SIGNING_SECRET` 某个服务没写全，或那条 location 漏了 `auth-inject.conf` | 逐个服务核对（§5.2）|
| `/api` 全 **502** | 后端没起来（多半是秒退重启循环）| 看 `dt-*.err.log` 第一行，通常是「配置错误：… Field required」|
| nginx 起不来：`CreateFile() "…\conf\proxy-common.conf" failed` | 两份 include 没放在**主配置所在目录**（多半放进 `sites-enabled\` 了）| 拷进 `conf\` 根，或把站点文件里那两条改成带 `sites-enabled/` 前缀（§8.3）|
| nginx 起不来：`duplicate ...` / `"map" directive is not allowed here` | 与同一台 nginx 上别的站点撞名，或站点文件没被 include 在 `http { }` 里 | §8.2 的两条 ⚠ |
| nginx 起不来，`unknown directive` 且那个指令看着完全正常 | `nginx.conf` 存成了带 BOM 的 UTF-8 | 用 §8.2 那段脚本重写一遍（`UTF8Encoding($false)`）|
| 首页 404，但 `/api/v1/auth/health` 正常 | `root` 指的 `dist` 目录不存在（前端没构建）| §3.4，`Test-Path …\web\app\dist\index.html` |
| 首页能开，**刷新/直接输地址 404 或 403** | `root` 用了反斜杠，或 `try_files` 被改成试目录 | 见 §8.2 的两条告诫 |
| WS **每 25~30 秒断一次重连** | 那条 location 误 `include proxy-common.conf`（25s 读超时套在长连接上）| 恢复成逐条写全、`proxy_read_timeout 3600s` |
| WS **握手一律失败** | `REALTIME_JWT_SECRET` ≠ `AUTH_JWT_SECRET` | 改成同值并重启 `dt-realtime` |
| 大屏**订不到任何主题**，auth 与 realtime 都健康 | `REALTIME_AUTH_BASE_URL` 用了代码默认值（端口 8001 是错的）| 显式写成 `http://127.0.0.1:8004` |
| 3D 模型 / 图片 / 图标 **403** | MinIO 匿名前缀没设（`minio-init` 那步从没在这台跑过）| §4.4，`__probe__` 回 404 才算对 |
| 素材**上传 404** | `/oss/` 的桶名 rewrite、`PLATFORM_OBJECTSTORE_PUBLIC_BASE`、前端 `ASSET_BASE_URL` 三处分叉 | 三处必须同为 `/oss/` + 同一个桶 |
| 模型永远停在**「压缩中」** | `PLATFORM_ASSETCOMPRESS_NODE/SCRIPT` 还是容器路径，或 `nodetools` 没 `npm ci` | §3.3、§5.4 |
| **api 健康，worker 与 publisher 无限重启** | 对象存储那四项只给了 api（三个角色共用一份 Settings）| 补全后重启 |
| `ZoneInfoNotFoundError: 'Asia/Shanghai'` | Windows 没有系统 tz 库，`tzdata` 被卸掉了 | 重跑 `uv sync --all-packages --frozen --no-dev` |
| 采集服务**健康、日志不报错，但一条历史都没有** | `collector-server` 那条迁移没跑（超表不存在）| §6 |
| 采集**永久空转**，拉不到计划 | `COLLECT_EDGE_SERVICE_KEY` 与 auth 分叉 | 改成同值 |
| OPC UA 实例**显示运行中但上位机连不上** | 防火墙放行的端口段与 `OPCUA_PORT_POOL` 不一致 | 两处逐字对齐（§7.5）|
| 上位机**证书不受信任**且以前是好的 | `data\opcua-pki` 丢了或被换过 | 从备份恢复；否则每台上位机重新信任 |
| 改了 `.env` **不生效** | ① 没重启服务；② 文件带 BOM（第一项静默失效）；③ `AppDirectory` 指错 | §5.5、§7.1 |
| 服务**装好了但一启动就停**（Windows 只说「服务未能启动」）| ① `AppStdout` 的目录不存在——nssm 不会替你建；② `.venv` 是从别的机器拷来的；③ `AppDirectory` 指错，`.env` 根本没被读到 | 按 §7.3 的四项自检，然后把它前台跑一遍 |
| nssm 报 `Error setting parameter "DependOnService"` | 依赖服务名在本机不存在（PostgreSQL 大版本不同、Redis 不叫 Memurai）| **不致命**，服务已装好；查真名后补设，或干脆不设（§7.2）|
| nssm 说 `Reset parameter "AppExit" … to its default` | Restart 本来就是 nssm 的默认退出动作 | 不是错，`nssm get <svc> AppExit` 核实即可 |
| 服务面板显示 **Running，但探针不通** | 秒退重启循环 | 看 `.err.log`；nssm 的 `AppThrottle` 会让它退避，别被「Running」骗了 |
| 停服务很慢，之后**采集要等一个 TTL 才恢复** | 设了 `AppNoConsole`，Ctrl+C 发不出去，只能强杀（租约没让）| 去掉该设置，确认 `AppStopMethodConsole` ≥ 25000 |
| 一切正常，**每 10 天前后全站实时面同时坏** | Memurai **Developer** 版单次运行上限 10 天 | 换 Enterprise 或别的 Redis 实现（§2.4）|
| 助手入口**不出现** | `dt-assistant` 没起 | 这是**设计行为**，不是故障；要它就起服务并配模型 |
| 助手**回合前半段好好的、后半段每个工具都报 401**，而 platform 本身健康 | `ASSISTANT_AUTH_BASE_URL` 还是容器默认值。边缘签的委托身份只有几十秒，续签走的正是这一格 | 显式写成 `http://127.0.0.1:8004`（§5.3）|
| 知识库入口**不出现** | `dt-knowledge` 没起 | **设计行为**。前端把 502 读成「这套部署没有知识库」|
| 传上去的文档**永远停在「处理中」** | ① `dt-knowledge-worker` 没起；② `KNOWLEDGE_INGEST_STREAM`/`_GROUP` 两侧分叉；③ worker 那份少给了对象存储四项 | 检索面同时是好的正是这一类的特征（§1.1、§5.2）|
| 摄取失败，理由是 **expected N dimensions** | `KNOWLEDGE_EMBEDDING_DIMENSIONS` 与目录里那个嵌入模型的维数对不上 | 两边对齐；已经建过表的要重跑一次迁移并把已有文档重新解析（§6）|
| `knowledge-migrate` 失败：**type "vector" does not exist** / 加载 DLL 失败 | pgvector 没装，或编译用的 PG 头文件不是这个大版本 | §2.3 |
| 检索永远回「**这个库还没建索引**」 | `KNOWLEDGE_EMBEDDING_ENABLED=false` | **设计行为**，不是空表。要真检索就接嵌入端点（§2.9）|
| 上传面**不收 PDF** | `KNOWLEDGE_MINERU_ENABLED=false` | **设计行为**。接了 MinerU 之后 accept 名单自动多出 `.pdf`（§2.9）|
| PDF 收下了但**每一份都解析超时** | 开关开着却连不上 MinerU，或 `KNOWLEDGE_EXTERNAL_PARSE_TIMEOUT_S` 配小了（纯 CPU 上几十页按分钟算）| 先手工 `curl http://<mineru>/health`；连不通就把开关关回去 |
| 知识库的 **PDF 预览一片空白**，那条请求却是 200 | nginx 少了 `.mjs` 的 media type，pdf.js 的 worker 被浏览器拒收 | §8.1 第 7 行；改完先清浏览器缓存再看 |
| 对话页**没有麦克风键**，或按下去报「只在 HTTPS 或 localhost 页面上开放麦克风」 | 前者是 `KNOWLEDGE_ASR_ENABLED=false`；后者是浏览器的安全上下文要求 | 后者与本仓无关，要给边缘配 TLS（§12）|
| 模型管理页整个 **503** | `PLATFORM_LLM_PROVIDER_SECRET` 没配 | 配上即恢复；留空的语义是「目录整个缺席」，两侧各用各的 `.env`（§5.2）|

### 11.1 401 到底是谁拒的

⚠ **`auth_request` 失败时，nginx 用自己那张 HTML 错误页盖掉上游的响应体**——
`{"code":40105,...}` 那句话根本到不了浏览器。所以「全站 401」这件事在浏览器里
看不出原因，只能从这三处之一读：

> 💡 **访问日志里的响应体大小就能分辨是谁拒的**：nginx 那张 401 页固定 ~580 字节，
> 而服务自己返回的错误是 JSON 信封（一百多字节）。同一份日志里
> `401 581` 与 `405 103` 并排出现，说明前者根本没到上游。


| 状态 | 谁抛的 | 含义 |
|---|---|---|
| 401 / code **40105** | `require_service_key` | **服务级密钥不符或缺失**——边缘那格与 auth 的 `.env` 分叉。与用户登没登录无关，每个受管请求都会中 |
| 401 / code **40102** | `TokenInvalid` | 令牌没带、无效、过期，或账号不存在 |
| 403 / code **40106** | `PermissionRequired` | **认证过了**，是规则表没匹配上或权限不足——种子没重跑就是这一类 |

**一条命令定位**（在服务器上跑，绕开 nginx 直接问 auth）：

```powershell
$svc = 'D:\AI\DigitalTwin\server\services'
$key = ((Get-Content "$svc\auth-server\.env") -match '^AUTH_EDGE_SERVICE_KEY=')[0].Split('=', 2)[1]
$tok = (Invoke-RestMethod -Uri 'http://127.0.0.1:8004/api/v1/auth/sessions' -Method Post `
        -ContentType 'application/json' -Body '{"username":"admin","password":"<口令>"}').data.token.access_token

curl.exe -s -i http://127.0.0.1:8004/internal/v1/verify `
  -H "X-Service-Key: $key" -H "Authorization: Bearer $tok" `
  -H "X-Original-URI: /api/v1/platform/dashboard-projects" -H "X-Original-Method: GET"
```

| 直连 `/verify` 的结果 | 结论 |
|---|---|
| `200` | 密钥与令牌都对 → 问题在**边缘传过去的东西**上：多半 `X-Service-Key` 那一行还是占位符，或者改完没 `nginx -s reload` |
| `401` + `40105` | 边缘那格与 `.env` 分叉，把 `.env` 里的值填进配置再 reload（§8.2）|
| `401` + `40102` | 令牌的问题，与边缘无关 |
| `403` + `40106` | 认证是通的，缺的是**路由规则或权限码**——重跑 auth 种子（§6）|

还有一条最容易被当成故障的：**浏览器地址栏直接敲 `/api/v1/...` 本来就是 401**
（没带 `Authorization`）。判据是打开页面按 F12 看 Network 里那条失败请求的
Request Headers 有没有 `Authorization: Bearer …`——没有的话问题在前端登录态，
不在边缘。

---

## 12. 已知限制

1. **并发上限在 nginx。** nginx/Windows 只有一个 worker 真干活，且用 `select()`，
   连接数上限在 1000 量级。每块大屏、每个采集配置页都是一条长连接——现场屏多了
   要么把边缘换成 Linux，要么在前面另加一层。
2. **升级是全量的。** 七个代码单元共用一个 `.venv`，没有容器那种「只换一个服务」。
3. **collector 单活无热备。** 单机只有一份，进程死了就没有采集；快照会按 TTL 过期，
   大屏拿不到值——这是刻意的，好过拿着一份永不更新的旧值当实时值看。
4. **`platform-publisher` 全局单活。** 别为了「双保险」多装一个，两个进程只会抢
   同一把租约。
5. **没有 TLS，于是语音输入用不了。** 本部署的边缘是 `listen 82`。要 HTTPS 就在
   `server` 块里加 `listen 443 ssl;` 与证书路径，其余不变（Windows 版 nginx 带
   `http_ssl_module`）。⚠ 在此之前**知识库的麦克风键按不动**：`http://` 的页面上
   `getUserMedia` 根本不存在，这是浏览器的安全上下文要求，与本仓无关（§2.9）。
6. **手工同步的两处**：`nginx.conf` 与 `.env`。仓库里的模板改了，这台机器不会
   自己跟着变——每次升级都要对一遍 §8.1 的差异表，并跑一遍 §5.6 那段差集脚本。
7. **MinerU 没在 Windows 上验过。** 本仓只给了它的容器构建。不接就不收 PDF，
   要接的话推荐放在另一台 Linux 上（§2.9）。
8. **knowledge-worker 单副本。** 容器那边它可以多开（消费组自动分活），这里只有
   一份：摄取是串行的，一份大文档解析时后面的排队。急的话可以照 §7.2 再装一个
   `dt-knowledge-worker2`（同目录、同 `.env`、同角色变量），它们会自动分活——
   这一点与 publisher 那种单活租约**不是一回事**。

---

## 附录 A：新功能上线后的最小重跑清单

```
□ git pull
□ 依赖变了？ uv sync --all-packages --frozen --no-dev
□ 前端变了？ pnpm install --frozen-lockfile && pnpm build
□ 有新迁移？ 七个服务目录逐个 alembic upgrade head
□ 加过端点或权限码？ auth-server 目录下 python -m scripts.seed   ← 漏了就是那一片全 403
□ 加过新配置项？ 跑 §5.6 那段差集脚本，缺什么补什么                ← 漏了就是启动即失败
□ 新增了服务？ 按 §7.2 装、§5.3 把服务名换成 127.0.0.1、§5.2 把共享密钥抄全
□ nginx.conf.template 改过？ 按 §8.1 同步 conf\nginx.conf（含第 7 行的 .mjs）
□ 重启服务，跑一遍 §9 的十条
```

## 附录 B：服务速查

| Windows 服务 | 目录（`AppDirectory`）| 命令 | 角色变量 |
|---|---|---|---|
| `dt-auth` | `server\services\auth-server` | `python -m auth_server` | —— |
| `dt-platform` | `server\services\platform-server` | `python -m platform_server` | `PLATFORM_APP_ROLE=api` |
| `dt-platform-worker` | 同上 | 同上 | `PLATFORM_APP_ROLE=worker` |
| `dt-platform-publisher` | 同上 | 同上 | `PLATFORM_APP_ROLE=publisher` |
| `dt-realtime` | `server\services\realtime-hub` | `python -m realtime_hub` | —— |
| `dt-opcua` | `server\services\opcua-server` | `python -m opcua_server` | —— |
| `dt-collector` | `server\services\collector-server` | `python -m collector_server` | —— |
| `dt-assistant` | `server\services\ai-assistant` | `python -m ai_assistant` | —— |
| `dt-knowledge` | `server\services\knowledge-server` | `python -m knowledge_server` | `KNOWLEDGE_APP_ROLE=api` |
| `dt-knowledge-worker` | 同上 | 同上 | `KNOWLEDGE_APP_ROLE=worker` |
| `dt-edge` | `tools\nginx` | `nginx.exe -p C:/DigitalTwin/tools/nginx` | —— |
| `dt-minio` | `tools\minio` | `minio.exe server …` | —— |
