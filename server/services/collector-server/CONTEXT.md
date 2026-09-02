# collector-server 上下文

采集运行时：唯一持有现场连接的进程。按采集计划建会话、订阅采样、写实时快照与历史归档，并执行来自 platform 的浏览与读写命令。数据在 `collect` schema，写独占（[ADR-0003](../../../docs/adr/0003-一库多schema且写独占读放行.md)）。切线见 [ADR-0001](../../../docs/adr/0001-采集运行时独立成服务而配置面留在平台.md)，驱动分层见 [ADR-0011](../../../docs/adr/0011-采集按驱动适配器分协议而采集计划保持协议无关.md)。

⚠ 与 platform 之间的四条线形口径（计划、命令信封、快照键、运行态列名）**不在本服务里声明**，两侧 import `domain/collectwire` 的同一份（[ADR-0017](../../../docs/adr/0017-采集控制面的跨进程线形收进domain共享包.md)）。本服务只留传输实现与驱动适配。

---

## 1. 通用语言

| 词 | 指什么 | 不要叫成 |
|---|---|---|
| **数据源**（source） | 一个可连接的现场端点：协议 + 地址 + 凭据 | ~~服务器~~（`opcua-server` 占了「服务端」，方向相反） |
| **点位**（point） | 数据源下的一个测点，身份是 `point_code` | ~~节点~~（大屏那边的 node 是画布节点） |
| **采集计划**（plan） | platform 下发的全量配置，collector 的唯一输入 | |
| **驱动**（driver） | 一种协议的实现 | ~~适配器~~（前端取数那侧才叫 provider） |
| **会话**（session） | 一个数据源的一生：连 → 订阅/轮询 → 心跳 → 退避 → 拆 | |
| **快照**（snapshot） | 点位的当前值，在 Redis 哈希里 | |
| **归档**（archive） | 点位的历史值，在 TimescaleDB 超表里 | |
| **准入**（admission） | 一条读数够不够格进历史：首值 / 心跳 / 超死区 / 质量翻转 | |
| **心跳补发**（heartbeat） | 在线订阅着却很久没变的点位，由归档缓冲每秒扫一遍主动补一行；时间戳落在「锚 + 整数个心跳」的网格上 | ~~结转~~（那是台账层被否掉的 LOCF，DATASET_DESIGN D3） |

⚠ `opcua-server` 与本服务方向相反：那边本平台是**服务端**，被上位机连；这边本平台是**客户端**，去连 PLC。两者共用协议名，不共用任何代码、表或运行时。

## 2. 不变式

1. **协议知识只在 `apps/collect/drivers/<协议>/` 里。** 缝在 `ValueSink` 上：值一旦离开驱动就是协议无关的四元组 `(point_code, value, ts_ms, quality)`。
2. **`asyncua` 只允许出现在 `drivers/opcua/` 下。** 这是「协议知识不外泄」唯一可机器执行的表述，由 `tests/contract/test_driver_isolation.py` 守住。
3. **`ValueSink` 是纯同步、零 `await` 的回调。** 它跑在协议库的回调里，两万个点位的回调里有一个 `await` 就会压垮事件循环。也正因为零 await，缓冲的原子交换不需要锁。
4. **`browse` 不支持时抛 `BrowseNotSupported`，绝不返回空列表**——空列表与「这台设备确实没有点位」分不开。
5. **拿不到计划就空转并响亮告警，不许用过期缓存猜。** 计划只在进程内存里，不落盘。
6. **Redis 不可达一律判非 leader。** 宁可没人干活，也不要两个进程对同一台设备建会话。
7. **就绪与是不是 leader 无关。** 热备副本没有任何会话，但它随时准备接管。
8. **归档只认四元组。** `apps/collect/archive/` 不认识任何驱动类型，值的两列编解码只用 `timeseries.split_value` / `read_value` 这一份。
9. **先写库成功再 `XDEL`，顺序不可交换。** 反过来会在库写失败时丢数据；正过来最坏是重投，而重投由归档表的自然主键去重挡掉。
10. **归档失败绝不阻塞采集。** 每一处 Redis/DB 调用都是 `try/except → 记日志 → 返回`：采集断了是事故，归档断了是降级。
11. **两个缓冲都有显式上限。** 归档缓冲满了丢最旧并计数（`COLLECT_ARCHIVE_BUFFER_MAX`），Stream 顶到 `MAXLEN` 会响亮告警——静默丢弃是参考实现里最难查的那类问题。
12. **心跳是主动补的，不是等出来的。** 订阅只在值变了才回调，准入里「心跳到期」那条对稳定的点位永远等不到；归档缓冲每秒扫一遍在线订阅着的数据源主动补行（COLLECT_DESIGN §4.3 ③'）。掉线与丢主之后不补——补出来的行与实测的分不开。

## 3. 驱动接口

签名逐条照 [`COLLECT_DESIGN.md` §4.1](../../../docs/COLLECT_DESIGN.md)。两处与设计文档的字面差异，都是被闸门逼出来的、语义不变：

| 设计文档 | 本仓实现 | 为什么 |
|---|---|---|
| `capabilities.supports_subscribe` | `capabilities.is_subscribe_supported` | 命名闸要求布尔带 `is_/has_/should_` 前缀（`browse` / `write` 同理） |
| （未列） | `load_points(points)` | 轮询模式不订阅，而 `read_many` / `write` 只认已登记的 `point_code`。这不是给未来协议预留的字段，是 OPC UA 今天就需要的能力 |

计划到驱动那一步的换手在 `apps/collect/plan/adapt.py`：`to_connection` / `specs_of` / `without_points`。**共享的计划形状上不许挂驱动方法**——那会让协议知识出现在协议无关的那一侧。

**不为未来协议预留字段。** 接口只覆盖 OPC UA 已经需要的能力；第二个驱动进来时按实测差异改接口——那时有两个实现可以互相校验，改漏了会编译失败。

## 4. 关停顺序

**不是启动的逆序**（[runtime-resilience §8](../../../docs/agents/runtime-resilience.md)），顺序由 `app.py` 的常量显式声明、`tests/contract/test_shutdown_order.py` 锁死：

```
命令总线（停收新活） → supervisor（心跳停 → 拆会话 → 让租约） → sink（冲尾帧）
  → 归档缓冲（冲尾帧进 Stream） → 归档 writer（把 Stream 排干进库） → 数据库 → Redis
```

⚠ **让租约排在拆会话之后**，与通例的「先让位」相反：先让位会让热备在我们还握着现场会话时连上去，而**重复会话击穿设备的会话上限**正是本服务的头号故障（ARCHITECTURE §1）。多等的那一小会儿远比双份会话便宜。

⚠ 两个缓冲必须比会话晚停——它们要接住拆会话时补交的尾帧；归档 writer 又比缓冲晚停，它要把那一帧排进库。

## 5. Redis 上的四条面

| 面 | 键 | 谁读 |
|---|---|---|
| 选主租约 | `collect:leader`（TTL 15s，CAS 续/让） | 只有本服务 |
| 快照 | `collect:snapshot:{source_id}` 哈希，字段 = `point_code` | `platform-publisher` 读，见 DASHBOARD_DESIGN §6 |
| 归档流 | `collect:archive:{source_id}` Stream，一条条目 = 一批行 | 只有本服务（writer 读完即 `XDEL`） |
| 命令总线 | 请求 `collect:cmd:req`，应答 `collect:cmd:reply:{request_id}` | platform 发、本服务应 |

快照字段的载荷是 `{"value":…, "ts_ms":…, "quality":…}`。**键名与字段名取自 `collectwire`，读侧用的是同一份**，故不再有两侧比对的用例，编码这一步由 `tests/contract/test_snapshot_payload.py` 守；归档条目的信封（`rows` + `traceparent`）与流键只有本服务读写，由 `tests/contract/test_archive_envelope.py` 锁死。

⚠ 运行态表是唯一还需要比对的一条：ORM 的列名从**属性名**推出来，两侧 import 同一份常量**拦不住属性改名**。`tests/contract/test_source_state_columns.py` 靠 `__table__` 反射守住这个缺口。

⚠ 归档条目**必须带 `traceparent`**：落库发生在另一拍、可能在另一个副本上，漏了它链路就在异步处齐断。
⚠ writer 靠 `SCAN collect:archive:*` 找流，不按计划列举：数据源从计划里删掉之后，它留在流里的行仍然必须落库。

**不做 fence 令牌。** 租约带 fence 的前提是外部资源认得它，而 PLC 不认——脑裂窗口靠 renew-or-die 压在一个 TTL 内，再靠归档主键去重兜底。

## 6. 命令总线的两条口径

- **只对计划里的数据源执行。** 浏览一台还没保存的数据源会被拒（`source_offline`）：凭据因此永远不必经过 Redis，配置面必须先保存再浏览。
- **超期请求直接丢弃、不应答。** 请求体里带的是**绝对墙钟** `deadline_ms`；发起方早已超时走人，这时再问现场只是白白占一次设备往返。

## 7. 非目标

| 不做 | 原因 |
|---|---|
| OPC UA 之外的驱动 | 一期只有一个协议。接口留形状不留字段（ADR-0011） |
| 业务 HTTP 面 | 配置面留在 platform，这里只有探针 |
| 归档的 continuous aggregate | 先让原始表跑起来，聚合查询直接扫原始表（COLLECT_DESIGN §8） |
| 按点位的保留期执行 | 全局压缩策略在迁移里，按点位的清理归 `platform-worker` 夜间批处理——迁移里禁止回填与删数据 |
| 采集侧的 consumer group | 单活租约已经保证单消费者 |
| 命令总线的 `validate` 动作 | 线上已有这个动作（platform 会发），本服务一期不实现，回 `unknown_action`；发起方据此记「未校验」而不是「通过」（ADR-0011 代价三）。实现集是 `SUPPORTED_ACTIONS`，它是 `collectwire.ACTIONS` 的真子集 |
| 直接推 WebSocket | 只写 Redis 快照，推送归 `platform-publisher`（ADR-0005） |

## 8. 数据

`collect` schema 两张表，platform 都只读。**无外键指向 `platform.collect_sources`**——禁跨 schema 外键、JOIN 与事务（ADR-0003）。

- `collect_source_states`：一个数据源一行运行态，主键就是 platform 那边的数据源 id。
- `point_history`：点位历史宽表，超表。列契约在 `domain/timeseries`，DDL 的实测理由见 [COLLECT_DESIGN §6](../../../docs/COLLECT_DESIGN.md)。三条不许动的取值：

| 取值 | 为什么 |
|---|---|
| `chunk_time_interval = 6 hours` | 1 天的块实测 4109 MB 堆 + 约 9100 MB 索引，超内存预算 4.59×；6 小时同时给出最好的压缩比（10.28×） |
| `compress_segmentby = 'source_id, point_code'` | 21.56× 压缩，且按点位删除退化成丢弃整段、零解压。**永远不要从段键里拿掉 `point_code`** |
| 主键 `(source_id, point_code, ts)` | Timescale 要求分区列进每个唯一约束；这个键一物三用——幂等去重 / 主查询索引 / 分区约束 |

压缩策略是 `add_compression_policy(…, INTERVAL '7 days')`：热区盖住迟到数据，比它更老的块自动压缩。**保留期不设**——静默删历史是不可逆的，按点位的清理归 `platform-worker`（COLLECT_DESIGN §6）。

⚠ 归档表里**不加 `protocol` 列**：它会破坏段键，而协议是数据源的属性，查得到，不必在每一行里重复。
⚠ 建表要求库里能装 `timescaledb` 扩展（迁移里 `CREATE EXTENSION IF NOT EXISTS`）。装不上就该响亮失败——退化成一张普通大表要等到几亿行才会被发现。
