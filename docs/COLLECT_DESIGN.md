# 数据采集与归档 — 设计

> 采集运行时在 `collector-server`，配置面在 `platform-server/apps/collect`（[ADR-0001](adr/0001-采集运行时独立成服务而配置面留在平台.md)）。
> 多协议靠驱动适配器，归档在协议无关侧（[ADR-0011](adr/0011-采集按驱动适配器分协议而采集计划保持协议无关.md)）。
> 一期只实现 OPC UA 驱动。

---

## 1. 通用语言

| 词 | 指什么 | 不要叫成 |
|---|---|---|
| **数据源**（source） | 一个可连接的现场端点：协议 + 地址 + 凭据 | ~~服务器~~（`opcua-server` 已经占用了"服务端"这个词，方向相反） |
| **点位**（point） | 数据源下的一个测点 | ~~节点~~（大屏那边的 node 是画布节点） |
| **采集计划**（plan） | 下发给 collector 的全量配置：数据源 + 点位 + 采样参数 | |
| **驱动**（driver） | 一种协议的实现 | ~~适配器~~（前端取数那侧才叫 provider） |
| **快照**（snapshot） | 点位的当前值，在 Redis | |
| **归档**（archive） | 点位的历史值，在 TimescaleDB | |

⚠ `opcua-server` 与 `collector-server` 方向相反：前者本平台是**服务端**，被上位机连；
后者本平台是**客户端**，去连 PLC。两者共用协议名，不共用任何代码、表或运行时。

---

## 2. 点位的身份：`node_key`

```
node_key = "{source_id}:{point_code}"
```

- `source_id` 是数据源的 UUIDv7（无冒号，所以按**第一个冒号**切分）。
- `point_code` 是用户在该数据源下指定的稳定标识（如 `outlet_temp`），`(source_id, point_code)` 唯一。

**`point_code` 不是协议寻址串。** 协议寻址串是点位的 `address` 字段（OPC UA 的 `ns=2;s=Temp1`、
Modbus 的 `holding:40001`），它是**可改的配置**；`point_code` 是**不可改的身份**。

这条区分是整个设计的支点，理由有三：

1. **换协议不断历史。** 同一个物理测点从 OPC UA 改走 Modbus，只改 `address`，
   历史曲线是连续的一条。若按参考实现用原始 NodeId 做键，这条曲线会断成两段而没人察觉。
2. **归档表的压缩靠它。** `compress_segmentby = 'source_id, point_code'` 是存储设计的支点
   （实测 21.56× 压缩，且按点位删除退化成丢弃整段而不解压）。段键必须稳定，
   否则改一次地址就在压缩段里裂出一个新序列。
3. **Agent 能寻址。** AI Agent 说"把这块卡绑到 1 号机出口温度"，它需要的是
   `1号机:outlet_temp` 这样可检索的名字，不是 `ns=2;s=PLC1.DB10.DBD24`。

改名等于换身份，因此**不提供改名接口**（也与 [database-standard](agents/database-standard.md) 的禁改名一致）。
需要改名时新建点位——历史归旧 `point_code`，这是诚实的。

---

## 3. `server/domain/timeseries/`

入场券成立：collector 写、platform 读，两个服务真实消费（[ADR-0004](adr/0004-server分三层且domain承载领域共享包.md)）。

包内只有**四件东西**，零 ORM 模型、零 CRUD、零 IO：

```python
# node_key.py
def compose_node_key(source_id: UUID, point_code: str) -> str
def split_node_key(node_key: str) -> tuple[UUID, str]      # 按第一个冒号切

# value.py —— 归档列的编解码，唯一真源
def split_value(value: object) -> tuple[float | None, str | None]
def read_value(value_num: float | None, value_text: str | None) -> object
# bool → 1.0/0.0（数字量才画得出趋势）；int/float → value_num；
# None → 两列皆 NULL（只留时刻与质量）；其余 → JSON 进 value_text

# quality.py
Quality = Literal["good", "uncertain", "bad"]   # 协议无关三档，驱动负责映射

# schema.py —— 宽表的列契约（给迁移与查询共同引用的常量，不是 DDL 执行器）
HISTORY_TABLE = "point_history"
HISTORY_COLUMNS = ("source_id", "point_code", "ts", "value_num", "value_text", "quality")
CHUNK_INTERVAL = timedelta(hours=6)
SEGMENT_BY = ("source_id", "point_code")
```

⚠ `domain` 不许含 ORM 模型，所以这里只有**列名常量与编解码**；建表的 DDL 在
collector-server 的迁移里，读侧的查询在 platform 里，两边引用同一份常量。
这样"列名改了而另一侧没改"会是 import 错误，不是运行期空结果。

---

## 4. `collector-server`

新代码单元。端口 **8007**，schema **`collect`**，环境变量前缀 **`COLLECT_`**，
无业务 HTTP 面（只有 `/health` 与 `/ready` 探针）。骨架照 `opcua-server` 抄
（`settings.py` / `container.py` / `app.py` / `__main__.py` 四件套）。

### 4.1 驱动接口

```python
# apps/collect/drivers/base.py
class Driver(Protocol):
    """一种协议的实现。协议知识只允许存在于本接口的实现里。"""

    capabilities: DriverCapabilities        # supports_subscribe / supports_browse / supports_write

    async def connect(self) -> None
    async def disconnect(self) -> None
    async def healthcheck(self) -> None                     # 心跳探针，抛异常即判断线
    async def subscribe(self, points, on_value: ValueSink) -> SubscribeResult
    async def unsubscribe(self, point_codes: Sequence[str]) -> int
    async def read_many(self, point_codes) -> list[Sample]
    async def write(self, point_code: str, value: object) -> None
    async def browse(self, parent: str | None) -> list[BrowseItem]
    def fingerprint(self) -> tuple[str, ...]                # 变了就必须重连
    def classify_error(self, error: BaseException) -> ErrorCategory
```

```python
ValueSink = Callable[[str, object, int, Quality], None]     # (point_code, value, ts_ms, quality)
Sample = tuple[object, int, Quality]
```

四条硬约束：

- **`ValueSink` 必须是纯同步、零 `await`。** 它跑在协议库的回调里，两万个点位的回调里
  只要有一个 `await`，事件循环当场被压垮。参考实现在这里踩过，注释写死了这条。
- **`browse` 不支持时抛 `BrowseNotSupported`，不返回空列表。** 空列表与"这台设备确实没有点位"
  分不开，会让配置界面静默摆出一棵空树。
- **`capabilities.supports_subscribe` 为假时，运行时自动降级为轮询**，
  轮询循环由运行时提供，不由每个驱动各写一遍。
- **驱动内部就要把协议特有信息决断掉**：取哪个时间戳、状态码映射到哪一档，
  理由写在驱动里。管道侧只看得到干净的四元组，信息在哪一步丢的必须在驱动里查得到。

### 4.2 目录

```
apps/collect/
├── drivers/
│   ├── base.py          Driver 协议、Sample、BrowseItem、DriverCapabilities、异常
│   ├── registry.py      protocol -> 驱动工厂；新增协议只在这里加一行
│   └── opcua/           一期唯一实现（asyncua 只许出现在这个目录里）
├── runtime/
│   ├── supervisor.py    租约选主 + 计划比对 + 收敛（哪些连接该活着）
│   ├── session.py       单个数据源的一生：连→订阅/轮询→心跳→退避→拆
│   ├── sink.py          buffer/archive_buffer 的原子交换与定期落 Redis
│   └── poller.py        supports_subscribe 为假时的通用轮询循环
├── archive/
│   ├── buffer.py        Redis Stream 生产端
│   └── writer.py        Stream → TimescaleDB，先写库成功再 XDEL
├── plan/
│   ├── client.py        从 platform 拉全量计划（HTTP，5s 超时）
│   └── store.py         本地缓存 + 版本比对
├── bus/consumer.py      命令总线消费端（browse / browse_subtree / read / write）
└── models/, migrations/ collect schema
```

**`asyncua` 只许出现在 `drivers/opcua/` 下**，由结构闸守住——这是"协议知识不外泄"这条
唯一可机器执行的表述。

### 4.3 数据流

```
现场设备
  │ ① 协议回调（驱动内）
  ▼
ValueSink(point_code, value, ts_ms, quality)      ← 缝在这里，以下全部协议无关
  ├─→ ② buffer[point_code] = ...                  dict，同窗口内后值覆盖前值（快照是采样，不是事件流）
  └─→ ③ 归档准入：archive_enabled ∧ (首值 ∨ 心跳到期 ∨ 超死区 ∨ 值变了)
          archive_buffer.append(...)               list
  │
  ▼ ④ 每 COLLECT_FLUSH_INTERVAL_MS（默认 300ms）原子交换
  ├─→ ⑤ HSET collect:snapshot:{source_id}
  └─→ ⑥ XADD collect:archive:{source_id} MAXLEN ~ N
  │
  ▼ ⑦ 每 COLLECT_ARCHIVE_FLUSH_MS（默认 5000ms）
      XRANGE → INSERT ... ON CONFLICT DO NOTHING → XDEL
  ▼
TimescaleDB collect.point_history
```

**⑦ 的顺序不可交换**：必须先写库成功、再 `XDEL`。反过来会在库写失败时丢数据。
写库用 `ON CONFLICT (source_id, point_code, ts) DO NOTHING`，
把 Stream 的 at-least-once 提升成实际的 exactly-once。

**归档失败绝不许阻塞或抛进采集热路径**——每一处 Redis/DB 调用都是
`try/except → 记日志 → 返回`。采集断了是事故，归档断了是降级。

⚠ `archive_buffer` 是无界 list。参考实现在这里没有上限，flush 卡住就会无限涨。
本仓给它**显式上限**（`COLLECT_ARCHIVE_BUFFER_MAX`，默认 200 000 条），
超限丢最旧并**计数上报**——静默丢弃是参考实现里最难查的那类问题。

### 4.4 单活与计划

- 单活靠 Redis 租约（`collect:leader`，TTL 15s，renew-or-die）。
  **Redis 不可达一律判非 leader**（[runtime-resilience](agents/runtime-resilience.md) §6）。
- 计划由 platform 下发：collector 定期拉全量 + 订阅变更通知，**按版本号判断是否重拉**。
  不用增量消息——丢一条就永久错位。
- 数据源退出计划（停用或删除）时，**同一拍就删掉它的快照键**，不等 TTL 到期：
  留着的那一分钟里，大屏与配置页上它看起来还在实时刷新，而现场早已断开。
  清理由 sink 每拍按计划对账（不看会话拆没拆完），故删失败或错过一拍都会自愈；
  重新启用后的值由新建立的会话现产，点位清单则随计划从库里重新下发。
- **拿不到计划时空转并响亮告警，不许用过期缓存猜**（ADR-0001）。
  用错的计划采数据比不采更糟：它会写出看似正常的错误历史。
- 启动时做一次工控网可达性自检，**连不通就响亮失败**（ARCHITECTURE §7）。

### 4.5 关停顺序

不是启动的逆序。心跳 → 轮询/订阅 → sink（尾帧要 flush）→ 归档 writer（最后停，它要把 sink 的尾帧排干）。

---

## 5. `platform-server/apps/collect`（配置面）

错误码领域号 **11**（点位与采集）。权限码 `collect:view` / `collect:operate` / `collect:manage`。

### 5.1 表（schema `platform`）

`collect_sources`：`id`、`name`、`code`（唯一）、`description`、`protocol`、`endpoint`、
`username`、`credential_enc`、`options_json`（协议特有连接参数）、`read_mode`、
`poll_interval_ms`、`is_enabled`、时间戳。

**凭据真实生效**：`credential_enc` 是 Fernet 密文（密钥由
`PLATFORM_COLLECT_CREDENTIAL_SECRET` 派生，缺失即拒绝启动）。计划构建时在
`/internal/` 端点**就地解密**，`username` / `password` 随计划走服务级密钥的内部
HTTP 下发——不经 Redis、不进日志、不进任何对外出参。解不开（换过密钥或一期的
"configured" 占位行）按未配置下发并响亮记日志：采集器匿名连接，连不上以 auth 类
错误暴露，重填一次口令即恢复。安全模式/安全策略存在 `options_json` 的
`security_mode` / `security_policy` 两个键里，驱动按自身能力消费，暂不支持的
取值只存不生效。

`collect_points`：`id`、`source_id`、`code`、`name`、`address`、`data_type`、`unit`、
`sampling_interval_ms`、`deadband`、`archive_enabled`、`archive_max_interval_ms`、
`archive_retention_days`、时间戳。唯一约束 `uq_collect_points_source_id_code`。

**`protocol` 与 `read_mode` 用 CHECK 约束的字符串**，不用原生 ENUM（database-standard）。

### 5.2 接口

```
GET    /api/v1/platform/collect-sources                  分页
POST   /api/v1/platform/collect-sources                  Idempotency-Key
GET    /api/v1/platform/collect-sources/{id}
PATCH  /api/v1/platform/collect-sources/{id}
DELETE /api/v1/platform/collect-sources/{id}?force=     force 连点位一起删（CASCADE）
POST   /api/v1/platform/collect-sources/{id}:test        连通性测试（走命令总线）
POST   /api/v1/platform/collect-sources/{id}:browse      地址空间浏览一层（10s 超时）
POST   /api/v1/platform/collect-sources/{id}:browse-subtree  一次收齐一棵子树（15s 超时）

GET    /api/v1/platform/collect-points?source_id=&q=      分页 + 搜索（Agent 按名字找点用）
POST   /api/v1/platform/collect-points                   支持批量
PATCH  /api/v1/platform/collect-points/{id}
DELETE /api/v1/platform/collect-points/{id}?force=      force 跳过绑定守卫（引用失效）
POST   /api/v1/platform/collect-points:batch-delete      批量删点，整批全删或全不删
POST   /api/v1/platform/collect-points/{id}:write        下发写值，必须带 Idempotency-Key

GET    /api/v1/platform/collect-runtime-params            采集/归档两组运行参数目录与取值
PUT    /api/v1/platform/collect-runtime-params/{section}  写覆盖值（写完通知计划变更）
POST   /api/v1/platform/collect-runtime-params/{section}:reset  整组恢复默认

GET    /api/v1/platform/point-history?node_keys=&from=&to=&limit=      游标分页
GET    /api/v1/platform/point-history:aggregate?node_keys=&interval=&agg=

GET    /internal/v1/platform/collect-plan                collector 拉计划，服务级密钥
```

**勾一个上层节点时，递归在采集侧做**（`:browse-subtree`）。前端逐层拉的代价是
「一层一个请求」：一次 HTTP + 一趟命令总线 + 一趟设备往返，勾一个几百节点的通道
就是几百个串行请求，而现场看到的只是界面卡住。子树接口一趟走完、**平铺**回来，
每一项带 `parent`，由客户端拼回层级。

**不设条数上限。** 勾一个通道要的就是它下面的全部点位，按条数掐断等于替用户
决定他只要前 N 个，而他多半要到建完点位才发现少了。遍历一定会终止——按寻址串
去重 + 地址空间是有限集合，不靠计数刹车兜底。唯一的刹车是发起方给的**绝对
墙钟**（`PLATFORM_COLLECT_SUBTREE_TIMEOUT_S`，采集侧留 500ms 余量编应答）。
到点了把 `is_truncated` 置真——**界面必须说出来**，静默只回一半会让用户以为
这个通道就这么点点位。

⚠ 这一趟会**占住采集副本的命令循环**（消费端一次只处理一条）：走子树期间，
同一副本上的写值与连通性测试要排队。预算因此不能无限放大，且整条链必须逐级
收窄——采集侧墙钟 < platform 预算 < 浏览器请求预算 < 边缘的
`proxy_read_timeout`。

**数据源出参带两件旁路信息**（没有为它们另开端点：界面每次都要，另开一个就是
每列一行多一次往返）：

- `runtime`：采集**运行态**，跨 schema 只读 collector 写的 `collect.collect_source_states`。
  取值 `online` / `connecting` / `offline`，外加平台侧的 `unknown`（采集侧还没写过
  这一行，通常意味着 collector 没起来）。⚠ 它与 `is_enabled` 不是一回事：前者是
  「配置说它该采」，后者是「它此刻真在采吗」，合成一个状态灯是现场最常见的误判。
  ⚠ 读不到时降级为 `unknown` 而不是让整页 503——collector 没起来时配置本身照样
  要能看、能改。
- `live_point_limit`：实时推送最多覆盖多少个点位（见 §9）。由服务端回而不是前端
  写死一份：两处各写一个数字，调大配置之后界面还在按旧数字提示。

三条口径：

- **时序集合一律游标分页。** 页码分页在持续写入的表上会静默重复与漏行。
- **删除点位前检查大屏绑定**，被绑着就 `409` 并列出绑定它的大屏——
  这正是配置面必须留在 platform 的理由（ADR-0001）。`force=true` 是**显式**跳过
  这道守卫（界面上是二级「强制删除」确认）：点位强删后仍绑着它的大屏槽失效；
  数据源强删连点位一起（外键 CASCADE）。守卫是默认档，强删是给「确实要清场」
  的人留的门，不是常规路径。
- **采集/归档运行参数**复用 `apps/runtime_params` 的目录与覆盖表，但挂在
  `collect-runtime-params` 前缀下：写码是 `collect:manage` 不是 `dashboard:edit`，
  而闸 2 的静态声明挂在路由上，一条路由声明不出两个码。覆盖值（稀疏）随采集
  计划的 `params` 段下发并参与版本摘要；没覆盖的键由 collector 自己的环境变量
  兜底（`tuning.py`）。生效档位：即时档在下一个计划刷新周期内生效（默认 30s），
  重连档等该数据源下次重连（界面上「断开→连接」即可立刻换新值），重启档等
  采集进程下次启动。
- **`:write` 是写操作，超时按不可重试处理。** 写超时不代表没写成功，
  盲目重试可能向 PLC 下发两次。幂等键是唯一的解。

### 5.3 命令总线

Redis list RPC，与参考实现同形：请求 `collect:cmd:req`，应答 `collect:cmd:reply:{req_id}`，
请求体带**绝对墙钟 deadline**，超期的请求 leader 直接丢弃不应答。
platform 侧超时 10s（浏览）/ 5s（计划）。

---

## 6. 归档表

```sql
CREATE TABLE collect.point_history (
    source_id   uuid              NOT NULL,
    point_code  text              NOT NULL,
    ts          timestamptz       NOT NULL,
    value_num   double precision  NULL,
    value_text  text              NULL,
    quality     text              NOT NULL DEFAULT 'good',
    CONSTRAINT pk_point_history PRIMARY KEY (source_id, point_code, ts),
    CONSTRAINT ck_point_history_quality CHECK (quality IN ('good','uncertain','bad'))
);
SELECT create_hypertable('collect.point_history', 'ts',
    chunk_time_interval => interval '6 hours', create_default_indexes => FALSE);
ALTER TABLE collect.point_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'source_id, point_code',
    timescaledb.compress_orderby   = 'ts DESC');
```

四条决策直接继承参考实现的实测结论，不重新推导：

| 决策 | 取值 | 理由（实测） |
|---|---|---|
| `chunk_time_interval` | **6 小时**，不是 1 天 | 1 天块 = 4109 MB 堆 + 索引约 9100 MB，超内存预算 4.59×；6 小时同时给出最好的压缩比（10.28×）。前提是宿主机 **≥16 GB 内存** |
| `compress_segmentby` | `source_id, point_code` | 21.56× 压缩；且按点位删除退化成丢弃整段、零解压（20.5ms）。**永远不要从 segmentby 里拿掉 `point_code`** |
| 主键 | 自然复合键，不是本仓默认的 `id UUID` | Timescale 要求分区列进每个唯一约束。这个 PK 一物三用：幂等去重 / 主查询索引 / 分区约束。没有它，"20 点位取最近 300 点"是 63042ms，有它 0.62ms |
| 无外键指向 `collect_sources` | — | 历史必须能在数据源删除后存活；且 hypertable 上的外键拖慢写入 |

**归档表里不加 `protocol` 列**——它会破坏 `compress_segmentby`，而协议是数据源的属性，
查得到，不必在每一行里重复。

聚合查询的 `time_bucket` **必须带 `timezone =>` 参数**。不带的话按 UNIX 纪元对齐，
东八区的日桶会从当地 08:00 开始，07:00 的数据落进前一天。这条要有测试锁死。

保留期：全局 Timescale 策略是上限；按点位的 `archive_retention_days` 由
`platform-worker` 的夜间批处理执行——**迁移里禁止回填数据**。
批删除有三条硬约束（实测）：谓词必须是字面量数组不能是子查询（否则触发解压元组上限），
必须带双向有界的 `ts` 范围，且删除后要周期性 `REINDEX`（压缩块上的 DML 会让索引膨胀 29×）。

---

## 7. 与实时通道的接线

collector **不直接推 WebSocket**。它只写 Redis 快照。
大屏的实时推送由 `platform-server` 的 `publisher` 角色读快照后推 `realtime-hub`
（[ADR-0005](adr/0005-实时通道与边缘网关的职责分界.md)），见 [`DASHBOARD_DESIGN.md`](DASHBOARD_DESIGN.md) §6。

配置页的实时读写走**同一个 publisher 角色的第二条链路**，主题
`collect:{source_id}`，见 §9。两条链路合用一个进程与一把租约，是因为它们的单活
理由完全相同；拆成两个角色只会多出一份部署单元与一把互不相干的租约。
⚠ 两条链路**各自兜错**：配置页那条读库失败，不许顺带让全厂大屏这一拍不更新。

---

## 9. 配置面（前端）与它的实时通道

配置页在 `web/app/src/pages/Collect/Opcua/`，左栏「数据采集 → OPC UA」。
权限沿用 §5 的三个码：进页面 `collect:view`，增删改 `collect:manage`，
连通性测试 / 地址空间浏览 / 下发写值 `collect:operate`。

**一个协议一个主从单页**（`/collect/opcua`，不再有 `:sourceId` 详情子路由）：
左栏数据源列表，右栏详情头 + 「在线浏览」与「已导入节点」两块并排。第二个
驱动进来时是同级的另一页，不是把这页改成通配——协议不同，配置字段就不同，
表单里因此也没有协议选择。详情头上的「连接 / 断开」按钮改的是 `is_enabled`
（采集器按计划自动收敛，见 §4.4），状态徽标显示的是真实运行态——两件事在
按钮与徽标上各说各的（§9.2）。顶栏的「采集参数 / 归档参数」两个弹窗读写
`collect-runtime-params`（§5.2），字段清单、上下界与危险方向全部来自后端目录，
前端不手写一份。删除（数据源 / 点位）走「引用守卫」两级弹窗：普通删除 409 时
升级出「强制删除」，后果写在冲突文案里。

### 9.1 实时值：主题 `collect:{source_id}`

```
collector → Redis 快照 → publisher 的 collect 链路 → hub → 配置页
```

- **只推有人在看的数据源**，活跃集合由 hub 的订阅表推导（与大屏同源；hub 那边
  仍然不认识「数据源」这个词）。配置页绝大多数时间没人开着，没人看就零开销。
- **新观看者收一帧全量**，所以页面**不必**再发一次 HTTP 读初值；此后只推变化的。
- **点位清单按 TTL 重读**（`PLATFORM_COLLECT_LIVE_PLAN_TTL_S`，默认 10 秒）。
  采集点位表没有行版本可比，故靠周期重读 + 逐条比对收敛。⚠ 到期重读**不等于**
  清单变了：不比对就会每个 TTL 推一帧全量。这个周期同时是「新建的点位多久之后
  开始有实时值」的上界。
- **一个数据源最多推前 N 个点位**（`PLATFORM_COLLECT_LIVE_MAX_POINTS`，默认 1000，
  按 `code` 升序）。一台设备挂上万个点位时，配置页一屏只看得见几十行，全量推会
  把整条 WS 通道占满。⚠ 截断如实告诉界面（`SourceOut.live_point_limit`），
  静默截断会让超出的那些行看起来像坏了。
- **推送方名字与大屏那条不同**（`platform-collect` vs `platform-publisher`）：
  主题对账靠「向 hub 要我名下的主题，多出来的注销掉」收敛，共用一个名字就会
  互相把对方的主题注销光。

### 9.2 界面上必须分得开的几件事

| 两件容易被合并的事 | 合并之后会怎样 |
|---|---|
| `is_enabled`（配置说它该采）／ `runtime.state`（此刻真在采） | 停用的源与连不上的源长得一样 |
| `unknown`（采集器没接手）／ `offline`（接手了连不上） | 前者该去查 collector，后者该去查现场 |
| 「没收到过」／「取不到」／有值 | 「取不到」被画成一个空值，是最难察觉的一类误判 |
| 值本身 ／ 它的采样时刻 | 只看值就分不出「现场稳着」与「早就不推了」 |
| 配置了多少个点位 ／ 采集侧真挂上多少个 | 差额（没订上的那些）永远不会有人发现 |
| 寻址串校验的 `passed` ／ `unverified` | 一条根本读不到的寻址串看起来完全正常 |

### 9.3 在线浏览导入：编码要人过一眼

浏览树勾中的节点在导入弹窗里**逐行确认点位编码**，因为编码是点位的身份、只能是
ASCII 标识串（`Code` 约束），而现场用中文命名标记是常态。

- **编码从寻址串的最后一段推**（`ns=2;s=A.B.OutletTemp` → `outlet_temp`），
  带中文的**整段转拼音**（`出口温度` → `chu_kou_wen_du`）。⚠ 不能只把中文当分隔符
  扔掉：`温度1` 那样只剩一个 `1`，而一张全是 `1`/`2`/`3` 的点表比留空还难查。
- **拼音字典按需动态加载**（一百多 KB）；加载不动就退回留空让人填，**不是**把节点
  丢掉。⚠ 「推不出编码就跳过、提示去点位表手工添加」是错的：它把整台中文命名的
  设备挡在门外，而点位表里的编码字段是同一套 ASCII 约束，一点没省事。
- **判重同时看本批与库里已有**，撞了自动挂序号；有一行不合法就不许提交——后端一批
  是原子的，一条编码不合规是整批被拒。
- **数据类型跟着现场读到的建**：浏览的引用描述里没有类型，采集侧因此按层多读一趟
  `DataType` 属性（读不到就留空，不猜）。没读到的那些按弹窗里选的那一档建。

### 9.4 批量导入

CSV，浏览器内解析，**不引 xlsx 解析库**：现场的点表十有八九本来就是组态软件导出的
CSV，而带 BOM 的 UTF-8 CSV 在 Excel 里双击就能开、改完另存回 CSV，闭环是通的。
模板与导出走同一套列，导出的文件能原样导回来。

三件必须做对的：

1. **BOM 要剥**。Excel 存的 UTF-8 CSV 开头有一个 U+FEFF，不剥掉第一列表头就成了
   「U+FEFF + code」，整表被判成缺列，而肉眼看表头完全正常。
2. **不能 `split(',')`**。寻址串里带逗号是常事（`ns=2;s=A,B`），一刀切会把一列劈成
   两列，多出来的那列静默顶掉后面所有字段。
3. **三类问题分开讲**：这一行读不了（改文件）、文件内撞码（改文件，跳过开关救不了）、
   库里已存（可以跳过）。混成一句「导入失败」，用户就只能一行行试。

提交按 `MAX_BATCH`（200）**切批，每批一个独立幂等键**——共用一个键会让第二批起被
后端当成同一次请求而静默丢失。后端一批是原子的，故失败要**按批**列出编码，只说
「失败」会让用户以为一条都没进，然后重导一次撞一堆 409。

### 9.5 下发写值

真的往 PLC 写，因此：弹窗里同时摆出点位编码、寻址串与**当前值**（核对是下发前唯一
的人工防线）；幂等键在人点下「下发」的那一刻生成一次；**失败绝不自动重试**——写超时
不代表没写成功，重试可能向设备下发两次（runtime-resilience §2）。
解不出输入值时报错而不是猜一个：把 `abc` 当 0 写下去，PLC 会照单全收。

---

## 10. 一期不做

- OPC UA 之外的驱动（接口留好，第二个驱动进来时按实测差异调整接口，
  那时有两个实现可以互相校验——现在预留字段是在猜）。
- 归档的 continuous aggregate（先让原始表跑起来，聚合查询直接扫原始表）。
- 采集侧的 consumer group（单活租约已经保证单消费者）。
- 配置页上的历史趋势（点位历史接口已经有了，趋势页另算一件事）。
- xlsx 导入（CSV 已经闭环；真要 xlsx 时它是一次独立的依赖引入 + 锁文件 PR）。
