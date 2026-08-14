# collector-server

采集运行时：连现场数据源、订阅采样、写实时快照，并执行 platform 发来的浏览与读写命令。端口 **8007**，schema **`collect`**，环境变量前缀 **`COLLECT_`**。

**没有业务 HTTP 面**——只有 `/api/v1/collector/health` 与 `/api/v1/collector/ready` 两个探针。点位与数据源的配置面在 `platform-server`（[ADR-0001](../../../docs/adr/0001-采集运行时独立成服务而配置面留在平台.md)）。

边界与不变式见 [`CONTEXT.md`](CONTEXT.md)，设计见 [`docs/COLLECT_DESIGN.md`](../../../docs/COLLECT_DESIGN.md) §4。

## 结构

```
src/collector_server/
├── __main__.py      进程入口（可执行名 collector-server）
├── app.py           装配 FastAPI（只有探针）+ 启停钩子与顺序常量
├── container.py     组合根：配置 → 各协作对象
├── settings.py      继承 lib 的配置基类，只加本服务字段
├── clock.py         可注入的时钟（UTC 毫秒）
├── lease.py         Redis 租约（SET NX PX / CAS 续 / CAS 让），零业务名词
├── snapshot.py      Redis 快照哈希的窄面
├── stream.py        Redis 归档流的窄面（XADD / XRANGE / XDEL）
├── commands.py      命令总线的传输面（Redis list RPC）
└── apps/collect/
    ├── errors.py    领域异常，`reason` 是发给 platform 的稳定字面量
    ├── drivers/     base.py（Driver 协议）/ registry.py / opcua/
    ├── runtime/     supervisor / session / poller / sink / reachability
    ├── archive/     buffer（准入 + 有界缓冲 + 落 Stream）/ writer（Stream → 库）
    ├── plan/        client（拉全量）/ store（版本比对）
    ├── bus/         命令总线消费端
    ├── models/ crud/ services/   采集运行态表与点位历史宽表
    └── schemas/     采集计划的形状
migrations/          本服务独占的迁移链，绑定 collect schema
tests/{unit,integration,contract,e2e}
```

## 数据流

```
现场设备 ─①协议回调（驱动内）→ ValueSink(point_code, value, ts_ms, quality)   ← 缝在这里，以下协议无关
            ├→ ② buffer[point_code]（后值覆盖前值）
            │     └→ ④ 每 COLLECT_FLUSH_INTERVAL_MS 原子交换 → HSET collect:snapshot:{source_id}
            └→ ③ 归档准入（首值 ∨ 心跳到期 ∨ 超死区 ∨ 质量翻转）→ 有界缓冲
                  └→ ⑥ 同一拍原子交换 → XADD collect:archive:{source_id} MAXLEN ~ N
                        └→ ⑦ 每 COLLECT_ARCHIVE_FLUSH_MS：XRANGE → INSERT … ON CONFLICT DO NOTHING → XDEL
                              └→ TimescaleDB collect.point_history
```

⚠ ⑦ 的顺序不可交换：必须**先写库成功再 `XDEL`**，反过来会在库写失败时丢数据。
⚠ 归档失败绝不阻塞采集：每一处 Redis/DB 调用都是 `try/except → 记日志 → 返回`。

## 依赖

`asyncua` **钉死在 1.1.8**：workspace 共用一个锁文件，`opcua-server` 也钉在这个版本，两处写不同范围只会让升级时其中一个静默变版本。本服务只用它文档化的 `Client` 面，且**只允许在 `drivers/opcua/` 下 import**。

## 配置

| 变量 | 说明 |
|---|---|
| `COLLECT_EDGE_SERVICE_KEY` | 拉计划时打 platform `/internal/` 的服务级密钥，与 auth-server 同值。**无默认值** |
| `COLLECT_PLATFORM_BASE_URL` | 计划来源，默认 `http://platform-server:8005` |
| `COLLECT_PLAN_REFRESH_INTERVAL_S` | 全量重拉并按版本号比对的周期 |
| `COLLECT_FLUSH_INTERVAL_MS` | 快照落 Redis 的窗口，默认 300 |
| `COLLECT_SNAPSHOT_TTL_S` | 快照哈希的存活期，每次 flush 续 |
| `COLLECT_ARCHIVE_FLUSH_MS` | Stream 落 TimescaleDB 的周期，默认 5000 |
| `COLLECT_ARCHIVE_BUFFER_MAX` | 归档缓冲的行数上限，默认 200000。超限丢最旧并计数上报 |
| `COLLECT_ARCHIVE_BATCH_ROWS` | 一条 Stream 条目与一条 INSERT 的行数，默认 1000（上限由 asyncpg 的 32767 个绑定参数收敛） |
| `COLLECT_ARCHIVE_STREAM_MAXLEN` | Stream 的条目上限，落库长期落后时的最后一道背压 |
| `COLLECT_HEARTBEAT_INTERVAL_S` | 会话心跳周期，探不到即判断线 |
| `COLLECT_RECONNECT_MAX_BACKOFF_S` | 断线重连的退避上限 |

完整清单见 [`.env.example`](.env.example)。

## 部署前置条件

collector 必须调度到**有工控网卡的节点**，容器网络要能路由到工控网段（host network / macvlan / 宿主机静态路由），见 [ARCHITECTURE §7](../../../docs/ARCHITECTURE_MICROSERVICES.md)。这是节点级配置，不是应用配置；启动自检会按首份计划逐个探数据源端点，连不通就在日志里响亮报 `plant_unreachable`。

副本策略是**单活 + 热备**（`replicas: 2`，租约竞选）。

## 本地命令

```bash
# 建 schema（⚠ 库里要能装 timescaledb 扩展，归档表是超表）
cd server/services/collector-server && uv run alembic upgrade head

# 全层测试与覆盖率（⚠ --cov 必须用点号模块名）
uv run pytest -q --cov=collector_server --cov-branch --cov-report=term-missing
```
