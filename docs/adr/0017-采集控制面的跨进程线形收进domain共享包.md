# ADR-0017：采集控制面的跨进程线形收进 `domain` 共享包

- 状态：已采纳
- 日期：2026-08-17
- 影响范围：`server/domain/collectwire/`、`server/services/platform-server/apps/collect/`、`server/services/collector-server/`、`server/lib/logging/`
- 相关：[ADR-0001](0001-采集运行时独立成服务而配置面留在平台.md)、[ADR-0003](0003-一库多schema且写独占读放行.md)、[ADR-0004](0004-server分三层且domain承载领域共享包.md)、[ADR-0011](0011-采集按驱动适配器分协议而采集计划保持协议无关.md)

## 背景

platform 与 collector 之间有四条真实的缝：

| 缝 | 方向 |
|---|---|
| 采集计划 | platform 下发 → collector 解析 |
| 命令总线信封 | platform 发起 → collector 应答 |
| Redis 快照 | collector 写 → platform-publisher 读 |
| 运行态表 | collector 写 → platform 只读 |

服务之间不许互相 import，所以此前每条缝的口径都在两侧**各写一份**，靠注释里的
"逐字一致"维系，再拿契约测试兜底。而那些契约测试的实现方式本身就说明了问题：
`test_collect_plan_wire.py` 用正则把 collector 的 `plan.py` **当纯文本读进来**抠字段名，
再拿一张 `INTENTIONALLY_NOT_SENT` 白名单排除有意不发的项。

这类漂移的共同点是**静默**：

- 计划少发一个字段——消费侧 `extra="ignore"` 且字段带缺省值，既不报错也不 422，
  只让该点位按缺省跑。最贵的是 `archive_max_interval_ms`（缺省 0 = 不发心跳），
  后果是一条常年不变的曲线在库里永远只有一个点，读侧分不出"没变"与"没采到"。
- 命令总线这条缝**根本没有双侧比对测试**，而 `current_traceparent()` 两侧各写一份，
  规整规则已经不一样了。
- 运行态的 `STATES` 元组，注释写着"逐字一致"，实际两侧顺序已经不同。

"复述 + 比对"这条路的问题不是它不管用，是它**每加一条缝就要再写一份比对**，
而比对本身要么写不出来（命令总线），要么只能靠正则读对方源码。

## 决策

**采集控制面的跨进程线形收进一个 `domain` 共享包 `collectwire`，两侧 import 同一份。**

包里只有常量与形状：

| 模块 | 内容 |
|---|---|
| `plan` | `CollectPlan` / `PlanSource` / `PlanPoint`、采样周期下限、两种读模式 |
| `commands` | 请求与应答键、`reply_key`、动作与状态字面量、采集侧回的稳定 `reason` |
| `snapshot` | 快照键前缀、`snapshot_key`、哈希值里的三个字段名 |
| `state` | 运行态表名与列名、三档状态、三档错误分类 |

它满足 [ADR-0004](0004-server分三层且domain承载领域共享包.md) 的四条约束：
零 ORM 模型与依赖注入件、不含服务名、不 import 别的 `domain/*`、
已有两个服务真实消费。

### 一、传输实现留在各自服务里，缝的位置不变

`collectwire` 只给**口径**，不给连接。platform 侧仍是 `RedisCommandTransport`（BLPOP 等应答），
collector 侧仍是它自己那个（BRPOP 取请求），两者方向相反、超时口径不同、重试策略不同。
**这次动的不是缝的位置，是在已有的缝上补一个模块。**

### 二、驱动适配从计划形状里拿出来

计划模型此前挂着 `to_connection()` / `specs()` 这类方法，它们认识 `DriverConnection`
与 `PointSpec`——那是协议知识，按 [ADR-0011](0011-采集按驱动适配器分协议而采集计划保持协议无关.md)
不该出现在协议无关的计划上。它们改成 `collector-server` 的
`apps/collect/plan/adapt.py` 里的模块级函数，共享形状因此可以是纯 DTO。

### 三、计划里的口令用 `str` + `repr=False`，**不用 `SecretStr`**

这一条反直觉，理由是可验证的：下发方按 `model_dump(mode="json")` 算计划的**内容摘要**，
而 `SecretStr` 在 JSON 模式下会被序列化成星号。用了它，**改一个数据源的口令算不出新版本号**，
collector 于是永远不会拿新凭据重连——现象只是"采不到数"。

`repr=False` 保住真正的泄漏路径（异常渲染、调试打印、日志里打整个对象），
`model_dump` 照常给出明文。两条不变式各有一条用例守着。

### 四、`current_traceparent()` 归 `lib`

它此前在五处各写一份（platform 的 realtime / command_transport / ac_startup_queue、
collector 的 commands、opcua-server 的 realtime），规整规则已经分叉。它零项目名词，
是 W3C 的事而不是采集的事，因此归 `lib/logging/trace.py`，不进 `collectwire`。

合并后的口径取两个变体的**并集**：先规整成定长十六进制，缺的那段补**随机值而不是零**——
全零 trace id 按 W3C 无效，收方只会静默丢弃，而那正是"链路断了却没有任何报错"的成因。

### 五、比对测试按缝的性质分两类处置

| 缝 | 处置 |
|---|---|
| 计划 / 命令 / 快照 | 撤掉比对：两侧 import 同一个名字，漂了是 import 错误 |
| 运行态列名 | **保留**，但改写：ORM 的列名从**属性名**推出来，import 共享常量拦不住属性改名。新的用例靠 `__table__` 反射比对，不读对方源码 |

## 理由

### 一、缝的位置不该由"能不能 import"决定

"服务之间不许互相 import"是对的，但它约束的是**服务**，不是口径。
`domain` 这一层的存在意义正是让两个服务共享一份领域口径而不共享运行时——
[ADR-0004](0004-server分三层且domain承载领域共享包.md) 的
`domain/timeseries` 已经在同一类缝（collector 写 / platform 读）上验证过这条路。
这次只是把已经赢过一次的做法用到剩下四条同类缝上。

### 二、把"静默"换成"响亮"，是这次改动的全部收益

改一个字段名，此前的后果是几周后一条缺了心跳的曲线；此后的后果是另一侧 import 失败。
**能编译失败的错误不值得写测试去追。**

### 三、`collectwire` 不 import `timeseries`，扁平约束不用破例

一开始担心快照载荷要用 `timeseries.Quality`。实际不需要：本包只给**字段名**，
质量位的取值与归一化仍归 `timeseries`，两侧各自 import 它。
运行态表名同理——本包只给不带 schema 前缀的表名，schema 名是各服务自己的配置。

## 代价

- **多一个 workspace 成员**：两个服务的 `pyproject.toml`、两个 Dockerfile、
  CI 的用例与覆盖率步骤都要加一条。`check_docker_workspace` 与 `check_service_deps`
  两道闸会在漏配时红灯，这个代价是可机器执行的。
- **共享形状意味着共享校验**：计划模型的 `Field(ge=...)` 现在在**下发方**也生效。
  这是收益不是损失（错误在产生处失败而不是在消费处静默降级），
  但它确实让下发方多了一条以前没有的失败路径——库里的 CHECK 约束已经保证了同样的边界，
  故实际不可达。
- **`domain` 层此前从未被类型检查**：`server/pyproject.toml` 的 pyright `include`
  只写了 `lib/src` 与 `services/**/src`。本次一并补上 `domain/**/src` 与范围自检的
  `SCOPES`，`timeseries` 因此第一次进了 strict 检查（结果是通过）。
