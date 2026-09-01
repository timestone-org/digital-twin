# 上下文地图

本仓分成若干**上下文**，每个上下文有自己的 `CONTEXT.md`（通用语言、边界、不变量）。
跨上下文的契约变更**先改文档、再改代码**。

| 上下文 | 位置 | `CONTEXT.md` | 状态 |
|---|---|---|---|
| 后端基础设施 | `server/lib/` | `server/lib/README.md` | 已建 |
| 领域共享包 | `server/domain/` | 各包 `README.md`（`timeseries` / `collectwire`） | 已建 |
| 认证与授权 | `server/services/auth-server/` | [`server/services/auth-server/CONTEXT.md`](server/services/auth-server/CONTEXT.md) | 已建 |
| 业务平台 | `server/services/platform-server/` | [`server/services/platform-server/CONTEXT.md`](server/services/platform-server/CONTEXT.md) | 已建（`api` 角色：空调台账 / 大屏组态 / 采集配置面 / 分析建模；`publisher` 角色：大屏实时发布） |
| 采集运行时 | `server/services/collector-server/` | [`server/services/collector-server/CONTEXT.md`](server/services/collector-server/CONTEXT.md) | 已建（驱动层 + OPC UA 驱动 + 运行时 + 归档管道） |
| OPC UA 服务端 | `server/services/opcua-server/` | [`server/services/opcua-server/CONTEXT.md`](server/services/opcua-server/CONTEXT.md) | 已建 |
| 实时通道 | `server/services/realtime-hub/` | [`server/services/realtime-hub/CONTEXT.md`](server/services/realtime-hub/CONTEXT.md) | 已建 |
| AI 助手 | `server/services/ai-assistant/` | [`server/services/ai-assistant/CONTEXT.md`](server/services/ai-assistant/CONTEXT.md) | 已建 |
| 前端 | `web/` | [`web/CONTEXT.md`](web/CONTEXT.md) | 已建 |
| 边缘网关 | `docker/nginx/` | 见 `docker/README.md` | 已建 |

## 全局约定

- 服务划分与部署形态：[`docs/ARCHITECTURE_MICROSERVICES.md`](docs/ARCHITECTURE_MICROSERVICES.md)
- 数据采集与归档：[`docs/COLLECT_DESIGN.md`](docs/COLLECT_DESIGN.md)
- 大屏组态与实时：[`docs/DASHBOARD_DESIGN.md`](docs/DASHBOARD_DESIGN.md)
- 跨大屏跳转：[`docs/DASHBOARD_NAV_DESIGN.md`](docs/DASHBOARD_NAV_DESIGN.md)
- 孪生部件交互：[`docs/TWIN_PART_INTERACTION_DESIGN.md`](docs/TWIN_PART_INTERACTION_DESIGN.md)
- AI 助手：[`docs/AI_ASSISTANT_DESIGN.md`](docs/AI_ASSISTANT_DESIGN.md)
- 分析建模：[`docs/MODELING_DESIGN.md`](docs/MODELING_DESIGN.md)
- 预测下发与每日增量：[`docs/AC_PUBLISH_DESIGN.md`](docs/AC_PUBLISH_DESIGN.md)
- 对外接口口径：[`docs/agents/api-contract.md`](docs/agents/api-contract.md)
- 各语言的结构、风格、注释、测试规范：[`docs/agents/`](docs/agents/)
- 架构决策：[`docs/adr/`](docs/adr/)

## 建设进度

按 [ARCHITECTURE §8](docs/ARCHITECTURE_MICROSERVICES.md#8-建设顺序) 的顺序：

1. ✅ `server/` workspace 骨架（`lib` 的配置、日志、异常、响应、DB、缓存、限流、令牌）
2. ✅ `auth-server` + `edge-gateway`（匿名被拒 / 带令牌放行 / 权限不足被拒 三条路径已跑通）
3. ✅ `opcua-server`（对上位系统暴露 opc.tcp 端点，纯人造数据）
4. ✅ `realtime-hub` + `platform-publisher`（开放主题命名空间、订阅授权由推送方登记；
   发布器租约单活、活跃集由 hub 的订阅关系推导、快照批推、主题登记周期对账）
5. ✅ `platform-server` 的 `api` 角色（`apps/hvac`：空调台账、车间房间空间配置，
   以及直读现场 EMS 库的空调数据面——数据集目录、数据源绑定、达标范围、
   原始数据表格与聚合序列；`apps/dashboard`：大屏组态的配置面；
   `apps/collect`：数据源与点位配置、采集计划下发、命令总线发起端、点位历史读侧）
6. 🟡 `collector-server`（骨架、驱动适配器层与 OPC UA 驱动、单活与计划、命令总线、
   归档管道已建；**尚未接过真实 PLC**，一期用 `opcua-server` 当可控假件验证）
7. ⬜ `platform-worker`（按点位保留期的夜间批处理仍未落地，见 `COLLECT_DESIGN.md` §6）
8. 🟡 `ai-assistant`（服务、四个技能、服务端与客户端两侧工具、大屏编辑器与台账页
   两个工作面已建；**尚未在现场跑过真模型**，本地只用假件验过编排）
