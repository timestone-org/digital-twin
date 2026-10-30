# 建模管理与命令恢复接入

接口版本 v1，文档版本 1.0，日期 2026-10-30。

本文补充 [全流程接入说明](MODELING_THIRD_PARTY_API.md)。路径均相对于 `/api/v1/platform`，使用 `Authorization: Bearer <账号 APIKey>`；成功业务码为 0，HTTP 状态码必须同时检查。需先完成本文末尾的迁移和版本升级步骤，不能据代码存在判断客户环境已经可用。

## 1. 模型列表与关系

以下读取需要 `modeling:view`，成功 HTTP 200。原有 `page=1&size=20` 返回 `{items,page,size,total}`，默认与上限保持兼容。新接入建议使用 `pagination=cursor&limit=100`，返回 `{items,next,has_more}`；下一页将 `next` 原样放到 `after`，保持其他筛选条件不变。

游标模式按不可变的 `(created_at,id)` 倒序，`limit` 为 1–200，不返回总数。页码模式仍沿用原排序。游标避免在页首插入导致的 offset 移位，但不提供跨请求数据库快照；筛选字段在翻页过程中变化、对象被归档或删除时仍可能改变集合。改变筛选条件后必须从首页开始，不能复用旧游标。游标不是身份凭据或授权。

| 集合 | 可用业务筛选 |
|---|---|
| `GET /modeling-instances` | `q` 名称/编码模糊匹配、`code` 精确编码、`template_id`、`latest_run_status`、`has_runs`、`archived` |
| `GET /modeling-runs` | `instance_id`、兼容 `pipeline_id`、`q` 所属流水线名称/编码、`status`、`created_at__gte`、`created_at__lt` |
| `GET /modeling-model-versions` | `instance_id`、兼容 `pipeline_id`、`q` 版本名称、`task`、`is_servable`、`archived`、`created_at__gte`、`created_at__lt` |

`GET /modeling-deployments` 保持 `data` 数组、不分页；新增可选的 `code` 精确编码、`model_version_id`、`instance_id`、`is_enabled` 组合过滤。不传过滤仍返回启用、停用及不可服务的全部部署，不能由前端把停用记录当不存在。`instance_id` 仅匹配真实模板实例，不能将普通设计流水线 UUID 冒充实例。

`archived` 为 `active`（默认）、`archived` 或 `all`。运行不因实例归档消失，历史仍可读取。时间筛选使用带时区的 RFC3339，左闭右开；同时给出起止时必须左端小于右端。`instance_id` 和 `pipeline_id` 同时给出但不同会返回 400；`instance_id` 专指模板实例，通用设计流水线使用 `pipeline_id`。

模型实例输出增加可空 `archived_at`。版本输出增加可空 `instance_id`、`archived_at`、`deployment_count` 和 `deployments_url`；运行输出增加可空 `instance_id`、`published_version_id`。普通设计流水线对应的 `instance_id=null`，不能靠名称推断实例。

`GET /modeling-model-versions/{version_id}/deployments?limit=100` 返回该版本关联的部署游标集合，保留停用部署，空集合正常返回 `items=[]`。使用返回的实际 `deployments_url`，不要将版本 UUID 当服务编码。单版本详情、运行详情与列表采用相同的关系含义。

```http
GET /api/v1/platform/modeling-runs?instance_id=019c0000-0000-7000-8000-000000000002&status=failed&pagination=cursor&limit=50
Authorization: Bearer <账号 APIKey>
```

## 2. 可恢复归档

归档是管理状态，保留编码、版本号、配置、计算本体和历史，不释放唯一身份，也不自动停用或删除部署。

| 操作 | 权限 | 请求 | 成功 |
|---|---|---|---|
| `POST /modeling-instances/{instance_id}:archive` | modeling:run | `{ "expected_revision": 3 }`；修订可省略 | 200，实例 |
| `POST /modeling-instances/{instance_id}:restore` | modeling:run | 同上 | 200，实例 |
| `POST /modeling-model-versions/{version_id}:archive` | modeling:publish | 无请求体 | 200，版本详情 |
| `POST /modeling-model-versions/{version_id}:restore` | modeling:publish | 无请求体 | 200，版本详情 |

这些写操作支持持久 `Idempotency-Key`。实例有在途训练，或实例/版本仍有部署、公式绑定引用时拒绝归档；停用引用仍算引用。归档后的实例禁止修改配置、启动训练和继续发布，归档版本不能新建部署、切换上线或绑定公式；其他训练入口也执行同一守卫。历史配置、运行与版本仍可读。恢复后不自动训练、部署或恢复已删除的外部资源。

实例归档/恢复推进实例 `revision`，推荐总是提交读取到的修订号。修订冲突后重新读取、核对并合并；不要自动换修订号覆盖。版本归档不改变计算版本号。物理退役仍是 DELETE，并且不可恢复；被部署、公式或切换历史引用的版本不能物理退役。

## 3. 部署修订、换版与回滚

部署输出增加整数 `revision`，存量部署有效初始值为 1。`PATCH /modeling-deployments/{deployment_id}` 新增可选 `expected_revision`；给出时在同一更新事务中检查，冲突返回 409。新客户端应提交修订号。未给修订号的旧 PATCH 保持兼容，但不能获得防覆盖保证。

受控版本切换使用以下新动作，避免把旧 PATCH 的兼容能力误当成完整换版保证：

```http
POST /api/v1/platform/modeling-deployments/019c0000-0000-7000-8000-000000000005:switch
Authorization: Bearer <账号 APIKey>
Idempotency-Key: 9eb70de7-f8f7-4335-ab2b-b4aee4a5fed8
Content-Type: application/json
```

```json
{
  "expected_revision": 1,
  "model_version_id": "019c0000-0000-7000-8000-000000000006",
  "is_signature_change_confirmed": false
}
```

需要 `modeling:publish`，成功 200 返回完整部署，`code` 保持不变。目标必须属于同一建模对象、任务类型相同、可服务且未归档。比较完整输入输出契约，包括类型、必填、默认值与时间要求；规则输出仍为通用 object 时，其冻结规则配置变化也要求确认，避免漏掉结果结构改变。签名改变时返回 409，调用方核对兼容性后才可显式提交 `is_signature_change_confirmed=true`。此确认不代表客户端已经完成适配。

`GET /modeling-deployments/{deployment_id}/switches?limit=100` 需要 `modeling:view`，返回游标集合。条目含 `id`、`deployment_id`、`deployment_code`、`from_model_version_id`、`to_model_version_id`、`revision`、`rollback_of_id`、`is_signature_change_confirmed`、`created_by_name`、`created_at`。版本引用与审计同事务保存。

`POST /modeling-deployments/{deployment_id}:rollback` 需要 `modeling:publish`，提交当前部署修订及该部署的历史 `switch_id`：

```json
{
  "expected_revision": 2,
  "switch_id": "019c0000-0000-7000-8000-000000000007",
  "is_signature_change_confirmed": false
}
```

回滚将部署切向该记录的来源版本，并产生一条新切换记录，不修改旧记录。同样检查归属、任务、可服务、归档和签名；历史版本失效时明确拒绝，不选“最近可用”替代。未提供自动健康探测或自动回滚。

已解析版本的在途推理继续使用原固定版本；部署提交后新解析的请求使用新版本引用。这不是所有在途请求同时切换的全局屏障。部署启停与配额维护继续使用带修订的 PATCH，写操作不自动重试。

## 4. 持久命令与超时核查

同一账号、操作范围与幂等键唯一。同一账号换 APIKey 仍是同一调用主体。键放 `Idempotency-Key` 请求头，要求 1–256 个可打印 ASCII 字符；不放 URL。请求指纹包含方法、路径、规范化 JSON 与外部操作者声明。同键改变参数返回 409，不能将旧键用于新的逻辑操作。

| operation | 对应请求 | resource_id |
|---|---|---|
| create_instance | POST /modeling-instances | 不传 |
| configure_instance | PUT /modeling-instances/{id}/configuration | 实例 UUID |
| train_instance | POST /modeling-instances/{id}:train | 实例 UUID |
| cancel_run | POST /modeling-runs/{id}:cancel | 运行 UUID |
| publish_version | POST /modeling-model-versions | 不传 |
| update_version | PATCH /modeling-model-versions/{id} | 版本 UUID |
| retire_version | DELETE /modeling-model-versions/{id} | 版本 UUID |
| deploy_instance | POST /modeling-instances/{id}:deploy | 实例 UUID |
| create_deployment | POST /modeling-deployments | 不传 |
| update_deployment | PATCH /modeling-deployments/{id} | 部署 UUID |
| delete_deployment | DELETE /modeling-deployments/{id} | 部署 UUID |
| archive_instance / restore_instance | 实例归档 / 恢复 | 实例 UUID |
| archive_version / restore_version | 版本归档 / 恢复 | 版本 UUID |
| switch_deployment / rollback_deployment | 受控换版 / 回滚 | 部署 UUID |

带键提交后保存响应头 `Modeling-Command-Id`。未带键仍执行正常写入，但不提供跨请求命令恢复保证。删除命令保留小型 `{id}` 回执用于核查，HTTP 成功及同键重放仍为 204、无响应体。取消命令提交成功不表示运行已进入终态。模板设计、通用流水线创建和公式绑定维护保留原有机制，不在此持久操作清单内。

按键找回：`GET /modeling-commands?operation=train_instance&resource_id={instance_id}`，并携带原 `Idempotency-Key`。按 ID 找回：`GET /modeling-commands/{command_id}`。两者需要 `modeling:view` 和该操作对应的 run/publish 权限，仅允许当前认证账号自己的记录；其他账号返回 404，模型资源共享不意味着命令结果共享。

返回的 `data` 包括 `id/operation/resource_id/state/http_status/result/error/created_at/completed_at/trace_id/is_verification_required`。`result` 是原操作的 data，不含外层响应信封；`trace_id` 是原命令的排障标识，当前查询请求另有外层 trace。状态含义：

成功回执保留当时的资源快照；资源后续可能已修改、归档或删除。需要当前状态或新修订号时再读取资源详情，不把旧命令结果当作实时状态。

| state | 含义与处理 |
|---|---|
| pending | 命令已预留但尚无已提交结果；继续查询或核查资源，不重新执行 |
| unknown | pending 超过 5 分钟的展示状态；不代表失败，不自动接管或重做 |
| succeeded | 业务写入和结果已同事务提交；可按同键回放，不依赖 Redis 的 24 小时结果缓存 |
| failed | 已知 4xx 拒绝且动作保存点已回滚，error 含原错误；重放仍返回该失败 |

`succeeded` 表示管理写操作完成。对 `train_instance`，结果仍可能只是 HTTP 202 的 pending 运行，必须继续按 run_id 查询训练终态。通过编码人工核查实例时使用 `code=...&archived=all`，避免把已归档实例误当成从未创建。

处理中重放返回 409、错误码 41443，并带 `Retry-After: 1` 和命令 ID；这个等待头只指导查询/核查节奏，不授权自动重新执行未知写操作。查询 404 只证明当前账号及给定范围下没有命令记录，不能据此断定旧版本操作未生效。

升级前旧 Redis 成功结果没有参数指纹，不能无损转为强幂等命令。新提交若命中旧成功键，返回 409/41444，要求按旧资源核查，不重新执行。旧缓存不可查询时保守返回 503。旧缓存已过期的历史键无法被新系统追溯，升级前须核清在途/超时请求；不能用过期旧键触发新的写操作。新持久命令不因 24 小时过去自动删除或失去防重；清理策略须保留身份及指纹的防重凭据，未提供自动接管 pending 的接口。

## 5. 外部操作人和调用审计

平台账号始终是认证主体。需要区分能管操作人时，由部署方将专用网关账号 UUID 配入 `PLATFORM_MODELING_TRUSTED_OPERATOR_ACCOUNTS`（JSON 数组，默认空），该账号才可传 `X-Modeling-Operator-Id`。值必须是 1–128 个无空白可打印 ASCII 字符，建议使用能管内部不可变 ID；重复请求头、非法标识或未授权账号均拒绝。

外部标识是受信任网关的声明，不是平台用户，不授予额外权限，也不替换 `X-Auth-*`。上述 17 种管理命令的审计保留平台账号、外部操作人、操作、目标、命令关联、来源 IP 和 trace；审计与业务写入同事务保存，成功回放不产生第二次业务审计。模板/流水线设计、公式绑定等未列操作不因此自动获得此委托审计。模型调用日志独立记录认证账号、可选外部操作人和 trace，不记录完整特征输入或密钥；签名读取、鉴权和配额阶段的拒绝仍不属于已记录推理调用。

当前仍为共享权限域，不按客户或创建者隔离模型。独立账号只分权限和配额，不能自动形成模型资源隔离。

模型部署配额的 429 返回原统一错误信封和 `Retry-After: 60`；这是保守等待一个完整窗口。边缘 IP 限流是另一层机制，可能返回不同格式，不能假定边缘 429 也有此头。

## 6. 新错误与发布顺序

| code | HTTP | 含义 |
|---|---|---|
| 41431 | 409 | 实例或版本已归档 |
| 41432 | 409 | 在途运行或资源引用阻止归档 |
| 41433 | 409 | 部署修订冲突 |
| 41434 | 409 | 换版对象或任务不匹配 |
| 41435 | 409 | 签名改变，需要明确确认 |
| 41436 | 404 | 切换记录不存在或不属于当前部署 |
| 41441 | 404 | 当前账号的命令记录不存在 |
| 41442 | 409 | 同一幂等键的参数指纹改变 |
| 41443 | 409 | 已受理命令结果尚未确认 |
| 41444 | 409 | 存在旧版成功结果，拒绝再次执行 |

先暂停建模写入口并停止、drain 全部旧 API/worker，再按服务迁移链执行纯扩展迁移，升级全部 API/worker，核对版本和配置后恢复入口。新增迁移按以下顺序执行：

1. `modeling_management_20261030`：归档字段、部署修订和切换记录的原子结构扩展。
2. `modeling_management_idx_20261030`：管理查询与切换引用的独立并发索引。
3. `modeling_commands_20261030`：命令、操作者审计和调用账号的原子结构扩展。
4. `modeling_commands_idx_20261030`：命令审计的独立并发索引；当前链头。

结构阶段不进入 autocommit；其后的索引阶段先提交已完成的结构及对应迁移版本，再并发建索引。索引失败时部署停止，修复故障后显式重新执行 `upgrade head`，会从索引阶段续跑，先并发删除同名残留或无效索引再重建，不会重复增加表列。迁移不会自动重试。迁移不回填，不删除既有表列，存量 nullable revision 按 1 解释。

扩展结构允许旧代码继续读取旧数据，但旧代码不能执行归档和新修订语义；归档功能启用后回滚必须使用理解新管理状态的兼容版本。旧代码也不支持服务格式 2.1，产生新格式模型后不得回退到不认识该格式的服务。数据库不随应用回滚，不能删除命令、归档或切换记录来“恢复”旧行为。

相关边界见 [平台 ADR-0008](../server/services/platform-server/docs/adr/0008-建模归档保留身份并显式切换部署版本.md) 与 [平台 ADR-0009](../server/services/platform-server/docs/adr/0009-建模写命令持久预留且未知结果不自动重做.md)。
