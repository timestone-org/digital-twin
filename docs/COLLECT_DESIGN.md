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
├── bus/consumer.py      命令总线消费端（browse / read / write）
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
- **拿不到计划时空转并响亮告警，不许用过期缓存猜**（ADR-0001）。
  用错的计划采数据比不采更糟：它会写出看似正常的错误历史。
- 启动时做一次工控网可达性自检，**连不通就响亮失败**（ARCHITECTURE §7）。

### 4.5 关停顺序

不是启动的逆序。心跳 → 轮询/订阅 → sink（尾帧要 flush）→ 归档 writer（最后停，它要把 sink 的尾帧排干）。

---

## 5. `platform-server/apps/collect`（配置面）

错误码领域号 **11**（点位与采集）。权限码 `collect:view` / `collect:operate` / `collect:manage`。

### 5.1 表（schema `platform`）

`collect_sources`：`id`、`name`、`code`（唯一）、`protocol`、`endpoint`、`credential_enc`、
`options_json`（协议特有连接参数）、`read_mode`、`poll_interval_ms`、`is_enabled`、时间戳。

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
DELETE /api/v1/platform/collect-sources/{id}
POST   /api/v1/platform/collect-sources/{id}:test        连通性测试（走命令总线）
POST   /api/v1/platform/collect-sources/{id}:browse      地址空间浏览（10s 超时）

GET    /api/v1/platform/collect-points?source_id=&q=      分页 + 搜索（Agent 按名字找点用）
POST   /api/v1/platform/collect-points                   支持批量
PATCH  /api/v1/platform/collect-points/{id}
DELETE /api/v1/platform/collect-points/{id}
POST   /api/v1/platform/collect-points/{id}:write        下发写值，必须带 Idempotency-Key

GET    /api/v1/platform/point-history?node_keys=&from=&to=&limit=      游标分页
GET    /api/v1/platform/point-history:aggregate?node_keys=&interval=&agg=

GET    /internal/v1/platform/collect-plan                collector 拉计划，服务级密钥
```

三条口径：

- **时序集合一律游标分页。** 页码分页在持续写入的表上会静默重复与漏行。
- **删除点位前检查大屏绑定**，被绑着就 `409` 并列出绑定它的大屏——
  这正是配置面必须留在 platform 的理由（ADR-0001）。
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

---

## 8. 一期不做

- OPC UA 之外的驱动（接口留好，第二个驱动进来时按实测差异调整接口，
  那时有两个实现可以互相校验——现在预留字段是在猜）。
- 归档的 continuous aggregate（先让原始表跑起来，聚合查询直接扫原始表）。
- 采集侧的 consumer group（单活租约已经保证单消费者）。
