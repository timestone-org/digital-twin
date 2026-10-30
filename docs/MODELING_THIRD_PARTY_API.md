# DigitalTwin 第三方接入页面接口说明

文档版本 1.5　接口版本 v1　更新日期 2026 年 10 月 30 日

本文对应系统“分析建模 → 第三方接入 → 接入指南”页面的 8 步流程：选择模板、获取配置、创建模型、配置参数、训练、发布版本、部署、调用服务。平台方预先设计并发布模板，第三方按模板完成建模和使用模型。已有部署时，也可先获取全部已部署模型列表，选择服务后直接调用。

全部请求统一使用用户 APIKey。模板、模型实例和部署服务分别有自己的 ID 或编码，按每一步返回的结果继续调用。

**适用版本**：目标环境须已更新为统一用户 APIKey 的接入版本。BASE_URL、用户 APIKey 和可用模板由平台方提供；本文示例域名、UUID、列名和数值均为示意，实际输入以所选模板及已部署模型的签名为准。

本文还覆盖实例全集、历史运行、历史版本、部署管理、数据选项与结果下载。下文“当前”指本仓接口实现，不能据此认定客户环境已部署、外部能管已连通或已有可用训练数据。机器可读的字段和类型以 [platform OpenAPI](../server/services/platform-server/openapi.json) 为准。新增筛选、游标、归档、受控换版与持久命令的完整契约及升级步骤见 [管理与命令恢复接入](MODELING_MANAGEMENT_API.md)。

## 接入前准备

API 根地址为 `{BASE_URL}/api/v1/platform`。例如 BASE_URL 为 `https://platform.example.com`。浏览器页面前缀 `/ai` 不加入 API 地址。下文接口均使用相对路径。

```http
Authorization: Bearer <用户 APIKey>
Content-Type: application/json
```

同一把用户 APIKey 用于建模、训练、部署和模型调用，无需再签发部署密钥，也不使用旧的 `X-Api-Key` 部署凭据。密钥不放入 URL 或业务日志。

| 权限 | 本流程中的用途 |
|---|---|
| modeling:view | 读取已部署模型列表、模板、配置、训练结果和模型签名，调用模型 |
| modeling:run | 创建模型实例、保存参数、训练和取消训练 |
| modeling:publish | 发布模型版本和部署模型 |
| dataset:view | 使用平台台账取数时读取真实台账、字段、记录与序列 |
| dataset:record:export | 与 modeling:view 同时具备时，下载已保留的运行端口 CSV |

完成基本建模流程的第三方账号需要 `modeling:view`、`modeling:run`、`modeling:publish`；台账目录与 CSV 下载按表中说明附加权限，无需模板设计权限 `modeling:manage`。APIKey 继承账号权限；账号停用、密钥过期或吊销后，后续请求被拒绝。当前模型资源属于共享权限域，不按创建者做租户隔离。

成功响应格式如下，各接口的结果放在 `data` 中：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

先检查 HTTP 状态，再检查业务 `code`。出现错误时保留 `trace_id`；字段错误可能附带 `details`。网关错误可能返回 HTML 或空体，不能假定所有错误都是 JSON。

`trace_id` 是请求排障标识，不是实例、运行或命令 ID。成功创建使用 HTTP 201，训练提交使用 202，删除成功使用 204 且无响应体，不能把所有成功都按 200 解析。

## 获取全部已部署模型

`GET /modeling-deployments`

权限：`modeling:view`。成功：HTTP 200。使用同一把用户 APIKey，无请求体，无分页参数。可选 `code`、`model_version_id`、`instance_id`、`is_enabled` 做精确组合过滤，不传时查询全部部署。

返回的 `data` 是全部部署服务组成的数组，不是 `data.items`。按创建时间由新到旧返回，没有部署时为 `[]`。同一模型版本部署成多个服务时，会返回多条部署记录。

列表同时包含启用、停用和当前不可服务的部署。第三方应选择 `is_enabled=true` 且 `is_servable=true` 的记录，保存其 `code`，然后进入第八步读取签名并调用。

| 返回字段 | 说明 |
|---|---|
| id | 部署服务 UUID |
| code | 调用地址使用的服务编码，拼入 /open-models/{code} |
| name、description | 部署服务名称和说明 |
| model_version_id | 固定的模型版本 UUID |
| model_name、model_version | 模型名称与版本号 |
| is_enabled | 部署是否启用 |
| is_servable、unservable_reason | 固定版本是否可服务，以及不可服务原因 |
| max_rows_per_call、rate_limit_per_minute | 单次行数与每分钟配额 |
| created_at、updated_at | UTC RFC3339 时间 |
| created_by_name | 创建者展示名，可为 null |
| key_count | 历史部署密钥数量的兼容字段，新接入可忽略，不需要再获取部署密钥 |

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "019c0000-0000-7000-8000-000000000005",
      "code": "chiller-01-energy-api",
      "name": "一号冷机能耗服务",
      "description": null,
      "model_version_id": "019c0000-0000-7000-8000-000000000004",
      "model_name": "一号冷机能耗版本",
      "model_version": 1,
      "is_enabled": true,
      "is_servable": true,
      "unservable_reason": null,
      "max_rows_per_call": 200,
      "rate_limit_per_minute": 60,
      "key_count": 0,
      "created_by_name": null,
      "created_at": "2026-10-28T01:00:00.000Z",
      "updated_at": "2026-10-28T01:00:00.000Z"
    }
  ],
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

调用示例，BASE_URL 和 DT_API_KEY 从环境变量读取：

```bash
curl --silent --show-error \
  "$BASE_URL/api/v1/platform/modeling-deployments" \
  -H "Authorization: Bearer $DT_API_KEY"
```

列表不包含完整输入输出签名。选择记录后调用 `GET /open-models/{code}`，根据 `output.task` 再选择预测、异常检测或规则计算接口。只消费已有模型时，可以直接使用这条查询和调用流程。

## 找回实例、历史运行和历史版本

以下读取均需 `modeling:view`，成功 HTTP 200。实例列表包含未训练、失败、未发布、未部署的实例，部署列表不能替代它。

| 场景 | 方法与路径 | 当前查询参数 | data 形状 |
|---|---|---|---|
| 模型实例全集 | `GET /modeling-instances` | 分页、`q`、`code`、模板/运行状态/归档筛选 | 页码或游标集合 |
| 实例详情 | `GET /modeling-instances/{instance_id}` | 无 | 实例对象 |
| 历史训练运行 | `GET /modeling-runs` | 分页、`instance_id`/`pipeline_id`、状态/时间筛选 | 页码或游标集合 |
| 全部固定模型版本 | `GET /modeling-model-versions` | 分页、`instance_id`/`pipeline_id`、任务/归档等筛选 | 页码或游标集合 |
| 单个模型版本详情 | `GET /modeling-model-versions/{version_id}` | 无 | 版本对象，含 signature、metrics、fingerprint |

这些列表默认 `page=1&size=20`，`size` 范围 1–200，返回 `{items,page,size,total}`；空页 `items=[]`。新接入可用 `pagination=cursor&limit=100`，返回 `{items,next,has_more}`。实例的 `q` 按名称或编码模糊匹配，精确编码查询使用 `code`。**从模板创建的实例，其 `instance.id` 与对应 `pipeline_id` 相同**，查询该实例运行和版本推荐传 `instance_id`，原 `pipeline_id` 继续兼容。通用设计流水线对应的 `instance_id` 为 null；两个筛选同时给出但不同会返回 400。

页码模式的实例按 `(updated_at DESC,id DESC)`，运行按 `(created_at DESC,id DESC)`，版本按 `(version DESC,id DESC)` 排序；页码翻页期间新增或修改资源可能改变页边界。游标模式统一按 `(created_at DESC,id DESC)`，绑定筛选条件，不提供跨请求快照保证。筛选参数、归档可见范围及关联部署查询见 [管理查询契约](MODELING_MANAGEMENT_API.md#1-模型列表与关系)。

### 实例和运行字段

实例列表与详情返回相同形状：

| 字段 | 含义 |
|---|---|
| id、code、name、description | 实例 UUID、唯一编码、名称、可空说明 |
| template_id、template_name、template_version | 创建时固定的模板版本；不会随模板更新 |
| revision | 当前配置修订号，用于完整配置保存 |
| archived_at | 归档 UTC 时间，未归档为 null |
| latest_run | 最近创建的运行摘要；从未训练时为 null |
| created_at、updated_at | 实例的 UTC 时间 |

`latest_run` 和运行列表条目含 `id`、`pipeline_id`、`instance_id`、`published_version_id`、`status`、`trigger`、`started_at`、`finished_at`、`duration_ms`、`row_count`、`is_source_truncated`、`is_keeping_frames`、`error_text`、`created_by_name`、`created_at`。`published_version_id` 对应这次运行发布的版本，未发布时为 null；不是整个实例的最新版本。开始/结束时刻、时长、行数、错误和创建者展示名可能为空。最近运行状态不能代表是否部署或是否存在可用历史版本，应分别读取版本和部署。

实例列表示例（为便于阅读，后续示例中的对象均放在统一信封的 `data` 内）：

```json
{
  "items": [{
    "id": "019c0000-0000-7000-8000-000000000002",
    "code": "chiller-01-energy",
    "name": "一号冷机能耗模型",
    "description": null,
    "template_id": "019c0000-0000-7000-8000-000000000001",
    "template_name": "冷机能耗模板",
    "template_version": 1,
    "revision": 1,
    "archived_at": null,
    "latest_run": null,
    "created_at": "2026-10-30T01:00:00.000Z",
    "updated_at": "2026-10-30T01:00:00.000Z"
  }],
  "page": 1,
  "size": 20,
  "total": 1
}
```

### 版本字段和反查关系

版本列表条目含 `id`、`pipeline_id`、`instance_id`、`run_id`、`version`、`name`、`algo`、`task`、`is_servable`、`serving_channel`、`unservable_reason`、`feature_keys`、`target_key`、`created_by_name`、`created_at`、`archived_at`、`deployment_count`、`deployments_url`。`target_key` 对异常检测和规则为 null；`serving_channel` 为 `json` 或 `binary`。版本详情另含 `description`、`signature`、`metrics`、`fingerprint`，关联部署按返回的 `deployments_url` 游标读取，不内嵌无限数组。

版本详情的完整形状示例：

```json
{
  "id": "019c0000-0000-7000-8000-000000000004",
  "pipeline_id": "019c0000-0000-7000-8000-000000000002",
  "instance_id": "019c0000-0000-7000-8000-000000000002",
  "run_id": "019c0000-0000-7000-8000-000000000003",
  "version": 1,
  "name": "一号冷机能耗版本",
  "algo": "linear_regression",
  "task": "regression",
  "is_servable": true,
  "serving_channel": "json",
  "unservable_reason": null,
  "feature_keys": ["temperature", "load"],
  "target_key": "energy",
  "created_by_name": null,
  "created_at": "2026-10-30T02:00:00.000Z",
  "archived_at": null,
  "deployment_count": 0,
  "deployments_url": "/api/v1/platform/modeling-model-versions/019c0000-0000-7000-8000-000000000004/deployments",
  "description": null,
  "signature": {
    "format_version": "1.0",
    "requires_timestamp": false,
    "inputs": [
      {"key":"temperature","label":"温度","unit":"℃","dtype":"number","is_required":true,"default_on_missing":null,"training_stats":{"min":10.0,"max":40.0}},
      {"key":"load","label":"负荷","unit":"kW","dtype":"number","is_required":true,"default_on_missing":null,"training_stats":{"min":100.0,"max":800.0}}
    ],
    "derived": [],
    "output": {"key":"energy","label":"能耗","unit":"kWh","dtype":"number","task":"regression"}
  },
  "metrics": {"r2":0.9,"rmse":12.0},
  "fingerprint": {}
}
```

该示例说明字段结构，不代表任意真实模型具有这些指标或训练统计。管理端版本详情可能含训练分布信息；对外 `GET /open-models/{code}` 会去掉输入的 `training_stats`，二者不能作为完全相同的响应使用。`fingerprint`、报告和签名目前是可扩展对象，应保留实际结构，不能从示意值补出缺失信息。

从部署打开配置的真实反查顺序：

1. 部署的 `model_version_id` → `GET /modeling-model-versions/{version_id}`。
2. 使用版本的 `pipeline_id` 读取 `GET /modeling-instances/{pipeline_id}`；仅模板实例存在该资源，普通设计流水线可能返回 404。
3. 使用版本的 `run_id` 读取运行详情；`run.pipeline_id` 应与版本的 `pipeline_id` 相同。
4. 读取 `GET /modeling-instances/{pipeline_id}/configuration?run_id={run_id}` 找回固定历史配置；需要当前配置时不带 `run_id`。

版本关联部署使用 `GET /modeling-model-versions/{version_id}/deployments`；运行列表及详情中的 `published_version_id` 可定位发布版本。所有反查均使用 UUID，调用服务时才使用部署 `code`；不能用名称、部署 UUID 或模型版本 ID 代替实例 UUID。

## 第一步 选择模板

`GET /modeling-templates?page=1&size=20`

权限：`modeling:view`。成功：HTTP 200。无请求体。

| 参数 | 是否必填 | 说明 |
|---|---|---|
| page | 否 | 页码，默认 1，最小 1 |
| size | 否 | 每页数量，默认 20，范围 1–200 |
| q | 否 | 可选检索词 |

返回 `data.items` 模板数组，以及 `page`、`size`、`total`。需要更多模板时继续翻页。

选择 `is_enabled=true` 的模板，并保存以下字段：

| 返回字段 | 用途 |
|---|---|
| id | 具体模板版本的 ID，后续作为 template_id |
| name、code | 模板名称和业务编码 |
| version | 模板版本号 |
| node_count | 节点数量，帮助核对配置是否完整 |
| is_enabled | 是否允许基于该模板创建新实例 |

模板后续发布新版本不会自动升级已有模型实例。

## 第二步 获取全部配置

`GET /modeling-templates/{template_id}/configuration`

权限：`modeling:view`。成功：HTTP 200。`template_id` 使用第一步取得的模板 ID。

| 返回字段 | 说明 |
|---|---|
| data.configuration | 可供创建和配置模型使用的完整参数对象 |
| data.configuration.nodes | 节点 ID 到参数对象的映射 |
| data.json_schema | 用于校验整份 configuration 的 JSON Schema |
| data.nodes | 每个节点的 id、alias、operator、config、known_columns 等说明 |

`nodes[].operator` 包含算子说明、参数 Schema 和输入输出端口。第三方应基于这些信息展示和校验参数，保留全部节点 ID，只修改节点参数，不修改模板结构。

## 第三步 创建模型

`POST /modeling-instances`

权限：`modeling:run`。成功：HTTP 201。建议携带 `Idempotency-Key`，避免网络重发造成重复创建。

| 字段 | 必填 | 说明 |
|---|---|---|
| template_id | 是 | 第一步选中的模板 UUID |
| code | 是 | 唯一编码，1–64 字符；以字母或数字开头，可含字母、数字、点、下划线和连字符 |
| name | 是 | 模型名称，1–128 字符 |
| description | 否 | 模型说明；非空时 1–512 字符 |
| configuration | 否 | 第二步取得并修改后的完整参数对象；省略或为 null 时使用模板默认配置 |

```json
{
  "template_id": "019c0000-0000-7000-8000-000000000001",
  "code": "chiller-01-energy",
  "name": "一号冷机能耗模型"
}
```

保存返回的 `data.id` 作为 `instance_id`，并保存 `data.revision`。新实例的修订号为 1。返回对象还包括模型名称、编码、来源模板版本、最近运行摘要等信息。

创建时已提交完整 configuration，且不需再修改时，可以直接进入第五步训练。

## 第四步 一次配置所有参数

更新已有模型前，可读取当前配置和修订号：

`GET /modeling-instances/{instance_id}/configuration`

该读取接口需要 `modeling:view`。取同一响应中的 `data.configuration` 和 `data.instance.revision` 作为编辑起点。

需要基于历史训练继续优化时，使用
`GET /modeling-instances/{instance_id}/configuration?run_id={run_id}`。
使用该次运行固定的流水线生成节点配置与 Schema，同时返回实例当前修订号；读取本身不修改实例。
先核对历史参数，再通过下述 PUT 保存和重新训练。`run_id` 必须属于当前实例，其他实例的运行返回 404。
从已部署版本继续优化时，可先读取 `GET /modeling-model-versions/{model_version_id}`，取得其 `run_id`。
历史流水线结构与当前实例不兼容，或参数已不受当前算子支持时返回 400；
此时应核对相应模板和算法版本，不能把历史参数直接应用到不同结构。

节点和连线的结构变更属于设计权限。具有 `modeling:manage` 的平台设计者可在实例页
保存当前草稿后使用“优化流水线结构”，从该模型已保存的流水线和配置复制新设计，
编辑保存后发布新工作流，再创建新的模型实例。第三方按本文的默认三项权限只能配置
既定结构；结构优化不会改写原模型或线上部署。

提交全部参数：

`PUT /modeling-instances/{instance_id}/configuration`

权限：`modeling:run`。成功：HTTP 200。

| 字段 | 必填 | 说明 |
|---|---|---|
| expected_revision | 是 | 当前模型修订号，至少为 1 |
| configuration | 是 | 完整节点参数对象，节点集合必须与模板一致 |
| name | 否 | 同时修改模型名称；省略或为 null 时不修改 |
| description | 否 | 省略时不修改，显式 null 可清空说明 |

下面与页面示例一致，演示 source、split、model 三个节点的配置结构。实际模板若还有其他节点，必须一并提交；应从接口返回的 configuration 复制并修改，不能直接套用这三个节点。

```json
{
  "expected_revision": 1,
  "configuration": {
    "nodes": {
      "source": {
        "table_code": "chiller-01",
        "columns": ["temperature", "load", "energy"],
        "since": "",
        "until": ""
      },
      "split": {
        "target_column": "energy",
        "test_ratio": 0.2,
        "method": "time_order"
      },
      "model": {"use_intercept": true}
    }
  }
}
```

成功后返回更新的模型实例，`revision` 增加 1。参数不合法返回 400；修订冲突或模型仍在训练时返回 409。遇到冲突应重新读取并核对修改，不要直接用新修订号覆盖其他人的配置。

### 选择真实训练数据

先检查 `nodes[].operator.code`，按实际来源选择参数和目录。“台账取数” `ledger_source` 和“能管取数” `bdm_source` 是两条数据路径，不能把同名目录、点位 ID 和台账编码混用。模板中的 `known_columns` 是当前图的静态列推导，可能为 null，不是当前 APIKey 的完整数据目录，也不证明所选时间段已有数据。

**平台台账 `ledger_source`** 使用 `table_code`、`columns`、`since`、`until`、`row_source`、`row_limit`。其中 `columns=[]` 表示当前全部列，`row_source` 是 `collect/manual/import/all`，默认 `collect`；`all` 中同一时刻可能有多条人工/导入记录。取数默认保留最新 50,000 行，最大 200,000 行，截断会进入运行标记。`should_drop_empty_columns` 默认 false，开启后全空列可能不再出现在下游。

以下平台台账读取另需 `dataset:view`，成功 HTTP 200：

| 方法与路径 | 选项和结果 |
|---|---|
| `GET /dataset-tables?page=1&size=20&q=...` | `data.items` 中读取真实 `id/code/name`、`collect_interval_ms`、`last_collected_ts`、`is_enabled`；后两者不是完整数据覆盖证明 |
| `GET /dataset-tables/{table_id}` | 表详情含全部 `columns` |
| `GET /dataset-tables/{table_id}/columns` | `data` 是列数组，含 `key/name/unit/decimals/data_type/source/agg/node_key`；配置 `columns` 使用 key |
| `GET /dataset-tables/{table_id}/records` | 按 `since/until` 查真实数据行；`limit` 默认 100、最大 200，下一页原样传 `after=data.next`，以 `has_more` 判断结束 |
| `GET /dataset-tables/{table_id}/series` | 重复 `keys=列key` 传选中列，支持 `since/until`；最多 50 列、20,000 行，返回序列及截断信息 |

目录地址用表 UUID；保存模型源参数使用该表返回的 `code`。记录时间字段是 `ts`；序列返回 `data.series[列key][]`，每个元素为 `{ts,value}`，另有 `is_truncated/limit`。不要求在列选择器里伪造一列时间。读取样本可以做训练前核对，但当前没有独立的“训练数据覆盖报告”或“一键预检”契约。没有数据时不能以占位行、0 或随机数据替代。

**能管取数 `bdm_source`** 在训练时由 platform worker 主动调用部署配置授权的外部能管历史接口。浏览器和模型参数不提交外部 URL 或密钥，保存 configuration 本身不上传历史数据。当前按需拉取，不维护独立历史副本或增量同步任务；每次运行按当前窗口重新取数。

以下目录读取使用平台账号 APIKey 与 `modeling:view`，不使用外部能管密钥：

| 方法与路径 | 查询与 data 字段 |
|---|---|
| `GET /modeling-bdm-capabilities` | `is_configured/timezone/minute_intervals/max_identifiers/max_formula_identifiers/max_rows/load_timeout_s`；反映配置和上限，不探测连通性 |
| `GET /modeling-bdm-catalogs` | `kind=point/raw/formula`；`page=1,size=50` 默认，size 最大 200；data 含 `kind/items/page/size/total/system_filter_available` |
| `GET /modeling-bdm-systems` | `items` 系统名数组与 `system_filter_available` |
| `GET /modeling-bdm-indicators` | `page/size/code`；data 含 `items/page/size/total`；指标的 `sources` 给出 `source_type/source_id/source_property/alias/unit/is_selectable` |

能管目录条目含 `identifier/code/name/system/history_available/table_type/unit`。`history_available` 可能为 null，仅是上游声明，不包含最早/最晚覆盖时刻。点目录支持 `name/keyword/code/system/include_unqueryable`；属性和公式不支持 keyword/code 过滤，公式不支持 system 过滤；不支持的组合返回 400。`system_filter_available=false` 时不可继续按系统筛选。指标来源仅 `source_type=unitProperty` 且 `source_id` 有效时标为可选，不把所有指标来源都当历史取数能力。

节点配置中 `kind=point` 的 identifiers 是真实 `pointId`，`raw` 是 `propertyId`，`formula` 是公式 `code`。每个标识输出一列，最多 10 个，公式最多 8 个；`value_type=number/string`，无法转数值的样本保留为空并计数。`row_limit` 默认 50,000、最大 200,000，按对齐后最新行截断。

`since` 可用 UTC 绝对时刻或 `-7d/-12h`，`until` 留空固定为本次运行时刻；区间左闭右开。上游无时区时间按能力返回的显式能管时区解释，再转 UTC 精确对齐；缺值不补零、不自动插值。公式支持 `day/month/hour/minute`，分钟间隔以 capabilities 为准；小时/分钟 `time_alignment=complete` 向内取完整周期，`strict` 要求请求边界严格对齐。

当前 worker 调用外部 `/points/query`、`/raw/query` 或 `/formula/query`，长窗分段、按标识分页，并有请求次数、offset、响应大小及总时限上限。上游 offset 分页没有跨页快照保证；同标识同时间的不同值会被拒绝。取数失败使该节点失败，不返回空成功帧。这些外部地址由部署连接的基础地址解析，不能直接拼到本平台 `/api/v1/platform` 下调用。需要快照或游标一致性、独立覆盖时段查询或增量同步时，需先补上游与平台契约。

## 第五步 训练与查询结果

开始训练：

`POST /modeling-instances/{instance_id}:train`

权限：`modeling:run`。成功：HTTP 202。建议携带 `Idempotency-Key`。

```json
{"trigger": "api"}
```

202 表示训练已提交，尚未完成。保存返回的 `data.id` 作为 `run_id`。

查询训练结果：

`GET /modeling-runs/{run_id}`

权限：`modeling:view`。成功：HTTP 200。可按例如 2 秒的间隔轮询；这是接入建议，不是服务端完成时限。

| data.status | 含义 | 接入方处理 |
|---|---|---|
| pending | 排队等待 | 继续查询 |
| running | 训练执行中 | 继续查询 |
| cancelling | 正在取消 | 等待终态 |
| succeeded | 训练成功 | 进入第六步发布版本 |
| failed | 训练失败 | 读取 error_text，修正配置后使用新键训练 |
| cancelled | 已取消 | 结束本次流程 |

返回对象还包括 `nodes` 节点状态、`duration_ms`、`row_count`、`error_text` 等。`is_source_truncated=true` 表示取数达到上限，需要核对训练样本是否充分。

需要取消时调用：

`POST /modeling-runs/{run_id}:cancel`

该接口需要 `modeling:run`，无请求体。取消在节点边界生效，应继续查询至终态。同一实例只允许一个在途运行，排队、训练或取消期间不能同时启动另一次训练。

### 读取真实评估和节点结果

运行详情的 `graph` 是本次运行冻结的图，`nodes` 只有节点状态摘要，轮询它不会取得完整评估数据。每个摘要含 `node_id/operator/alias/ordinal/status/duration_ms/has_preview/error_text`，按节点读取：

`GET /modeling-runs/{run_id}/nodes/{node_id}`

权限 `modeling:view`，成功 HTTP 200。node_id 使用冻结运行中的真实节点 ID，不能使用显示别名。响应在摘要字段上增加：

| 字段 | 使用方式 |
|---|---|
| preview | 按输出端口组织的有界摘要，不是完整训练数据 |
| is_preview_truncated | 摘要是否被截断；不能把截断摘要当全样本 |
| report | 真实算子报告与图表数据，可为 null；按返回块渲染 |
| fitted | 学到的参数，可为 null；读取不修改拟合结果 |
| exported_ports | 本次已留下 CSV 的输出端口名数组 |

各任务实际产物不同，只有流水线中对应算子执行并留下结果时才能展示：

| 任务 | 已有评估/报告举例 | 不可推断的内容 |
|---|---|---|
| 回归 | R²、RMSE、MAE、MAPE、最大误差、残差统计、真实-预测散点；线性系数、树模型重要性等依实际算法 | 不能要求所有算法都有同一套贡献；MAPE 等未定义时可为 null |
| 数值二分类 | accuracy/precision/recall/f1、混淆矩阵、类别分布；打分帧有概率列时可有 ROC/PR/校准等报告 | 没有概率列不能补概率曲线，分母为 0 的指标不能改成 0 |
| 异常检测 | 测试行数、异常率、阈值、判定分布 | 没有故障标签不能声称测试准确率、故障概率或故障原因 |
| 规则计算 | 按冻结业务规则计算的主数值、明细、命中条件及摘要 | 不生成训练准确率或拟合曲线 |

模型版本详情中的 `metrics` 是发布时冻结的指标集合；节点 report/preview 才是运行中更详细的结果入口。旧运行可能没有 report 或 fitted，未发布运行受保留策略清理，不能承诺永久保留所有训练过程。

### 下载已保留的端口 CSV

训练请求可显式使用 `{"trigger":"api","is_keeping_frames":true}`。默认 false。开启后仍须对象存储可用且导出成功；先查看节点的 `exported_ports`，只对确实存在的端口提供下载按钮。

`GET /modeling-runs/{run_id}/frames/{node_id}?port={port}`

权限须同时具备 `modeling:view`、`dataset:record:export`。成功 HTTP 200，`Content-Type: text/csv; charset=utf-8`，`Content-Disposition` 给出文件名；此端点直接返回文件，**不走 JSON 信封**。`port` 默认 `frame`，应优先使用 exported_ports 返回的真实端口名。

CSV 有时间索引时第一列叫 `__ts__`，当前导出值为 Unix 毫秒整数；它与推理请求中 RFC3339 字符串的同名保留键格式不同。每个导出最多 200,000 行。未启用保留、端口无产物、对象存储未配置或产物已过期时返回 404；不能把重跑出的新数据冒充上一次运行的原始产物。

## 第六步 发布模型版本

`POST /modeling-model-versions`

权限：`modeling:publish`。成功：HTTP 201。建议携带 `Idempotency-Key`；成功响应的 `Location` 指向版本详情。

| 字段 | 必填 | 说明 |
|---|---|---|
| run_id | 是 | 第五步状态为 succeeded 的运行 UUID |
| name | 是 | 版本名称，1–128 字符 |
| description | 否 | 版本说明；非空时 1–512 字符 |

```json
{
  "run_id": "019c0000-0000-7000-8000-000000000003",
  "name": "一号冷机能耗版本"
}
```

保存返回的 `data.id` 作为 `model_version_id`。`data.signature` 是实际输入输出签名。必须确认 `data.is_servable=true` 才进入部署；为 false 时查看 `unservable_reason`。

同一次运行只能发布一个版本。同一账号以相同 `Idempotency-Key` 重放时返回第一次发布的版本，
不会产生第二个版本；未带键或换键重复发布同一运行仍返回 409。

## 第七步 部署模型

`POST /modeling-instances/{instance_id}:deploy`

权限：`modeling:publish`。成功：HTTP 201。建议携带 `Idempotency-Key`。所选版本必须属于当前模型实例，且可以提供服务。

| 字段 | 必填 | 说明 |
|---|---|---|
| model_version_id | 是 | 第六步发布成功的版本 UUID |
| code | 是 | 稳定服务编码，2–63 字符；仅小写字母、数字和连字符，以字母或数字开头 |
| name | 是 | 服务名称，1–128 字符 |
| description | 否 | 服务说明；非空时 1–512 字符 |
| max_rows_per_call | 否 | 单次行数上限，默认 200，范围 1–1000 |
| rate_limit_per_minute | 否 | 每个用户账号在此部署上的每分钟配额，默认 60，范围 1–6000 |

```json
{
  "model_version_id": "019c0000-0000-7000-8000-000000000004",
  "code": "chiller-01-energy-api",
  "name": "一号冷机能耗服务",
  "max_rows_per_call": 200,
  "rate_limit_per_minute": 60
}
```

保存 `data.code`，它是第八步调用地址中的服务编码；`data.id` 是部署资源 UUID，两者不要混用。部署完成后继续使用原来的用户 APIKey。

部署固定指定版本。重新训练、重新发布模板或产生新模型版本，都不会自动替换已部署版本。

### 已有部署维护、回切和版本退役

| 操作 | 方法与路径 | 权限与成功状态 |
|---|---|---|
| 部署详情 | `GET /modeling-deployments/{deployment_id}` | modeling:view，200 |
| 修改部署 | `PATCH /modeling-deployments/{deployment_id}` | modeling:publish，200，返回完整部署对象 |
| 删除部署 | `DELETE /modeling-deployments/{deployment_id}` | modeling:publish，204，无响应体 |
| 近 30 天调用统计 | `GET /modeling-deployments/{deployment_id}/call-stats` | modeling:view，200，data 为 `{day,total,failed}` 数组 |
| 修改版本名称和说明 | `PATCH /modeling-model-versions/{version_id}` | modeling:publish，200，返回完整版本对象 |
| 退役版本 | `DELETE /modeling-model-versions/{version_id}` | modeling:publish，204，无响应体 |

部署 PATCH 接受 `name`、`description`、`model_version_id`、`is_enabled`、`max_rows_per_call`、`rate_limit_per_minute`，以及可选 `expected_revision`；`code` 建立后不可修改。配额范围同创建接口。业务字段给 null 时不修改，包括 description，不能以 null 清空部署说明。版本元数据 PATCH 的 `description:null` 则会清空说明；`name:null` 不修改。

停用示例：

```json
{"expected_revision": 1, "is_enabled": false}
```

旧部署 PATCH 仍兼容直接修改版本引用；新接入使用带修订、归属及签名保护的 `POST /modeling-deployments/{deployment_id}:switch`。请求示例：

```json
{"expected_revision": 2, "model_version_id": "019c0000-0000-7000-8000-000000000006", "is_signature_change_confirmed": false}
```

部署更新在同一事务中修改版本引用并推进 `revision`；带 `expected_revision` 的 PATCH 会拒绝覆盖冲突，未带修订号的旧请求仍为兼容语义。受控 `:switch` 和 `:rollback` 必须给修订号，并校验同一模型、同任务、未归档、可服务及签名变化确认；切换历史与请求说明见 [部署管理契约](MODELING_MANAGEMENT_API.md#3-部署修订换版与回滚)。已解析版本的在途推理继续使用原版，提交后新解析请求使用新引用；这不是所有在途请求同时切换的全局屏障，不提供自动健康探测或自动回滚。

删除部署会同时删除该部署的历史部署密钥和调用记录，不删除其模型版本；部署删除无恢复接口，版本切换历史继续保留。版本“退役”是物理删除，存在部署、公式绑定或切换历史引用时返回 409，停用引用仍算引用。可恢复管理使用实例和版本的 `:archive/:restore`，保留编码、版本与历史，不自动解除引用。未提供物理删除整个实例或级联删除整个模型的接口；设计流水线端点不能作为实例删除按钮的替代。未带持久幂等键删除不存在资源仍返回 404；带同一键回放按原提交结果处理。

调用统计只列实际记录过调用的日期，不补齐空日；签名读取、鉴权和配额阶段的拒绝不属于已记录推理调用，不能把该统计当完整访问审计。原始账号 APIKey 不应进入统计或日志。

## 第八步 调用服务

### 读取模型签名

`GET /open-models/{code}`

权限：`modeling:view`。成功：HTTP 200。`code` 使用部署列表选中项的服务编码，或第七步返回的服务编码。

此接口的 `data` 本身就是模型签名。重点读取：

| 字段 | 用途 |
|---|---|
| inputs[].key | 每行 JSON 中应提供的输入字段名 |
| inputs[].dtype、unit | 输入类型及单位 |
| inputs[].is_required、default_on_missing | 必填提示与可用填充值提示；当前 default_on_missing 为数值或 null，不是策略对象；null 不表示填零 |
| inputs[].missing_policy | 回归/分类新发布推理格式 2.1 的缺字段/显式 null 策略；历史和其他任务签名可能没有 |
| requires_timestamp | 为 true 时按模型要求提供每行的 __ts__ 时间 |
| output.task | 决定使用预测、异常检测还是规则计算接口 |

输入字段使用 `inputs[].key`，不使用训练后的 `feature_keys`，也不要提交训练目标列。对外签名不提供训练统计的具体数值。

当前签名输入 dtype 来自 `number/bool/string`，规则输出可标为 `object`；dtype 描述训练入口元信息，不代表所有任务的线上调用都接受所有这些类型。线上 rows 是扁平字段对象，不支持任意嵌套对象或数组。普通预测只接受数值或 null，拒绝布尔与数值字符串；缺少必填字段返回 400。

本次新发布的回归/分类推理格式 2.1 以冻结的前置填充链执行真实默认值：`missing_policy.on_missing/on_null` 为 `fitted_default` 时，缺字段和显式 null 均使用训练时的 `default_on_missing`；未覆盖的必填列为 `{on_missing:"reject",on_null:"return_null"}`。默认值为 0 时也按真实拟合值使用，不把其他空值改成 0。历史 1.0/2.0 模型计算行为不变，其签名可能没有 `missing_policy`，即使旧提示为 optional，缺值仍可能返回 null；需要新行为时重新发布并显式换版，不能改写旧模型。异常的新签名明确完整必填、`default_on_missing=null`，不发布上述回归/分类策略；异常和规则调用仍按各任务自己的严格输入契约。

`requires_timestamp=true` 时需要在每行传 `__ts__`。统一使用带时区的 UTC RFC3339，例如 `2026-10-30T01:00:00Z`，不用本地无时区字符串、Unix 秒或毫秒；派生时间特征沿用固定模型版本的时间口径。规则调用当前不支持额外时间键。

### 按任务类型执行调用

| 模型任务 | 调用接口 |
|---|---|
| regression 或 classification | `POST /open-models/{code}:predict` |
| anomaly_detection | `POST /open-models/{code}:detect` |
| rule_calculation | `POST /open-models/{code}:calculate` |

以上三种调用均需 `modeling:view`，成功为 HTTP 200。对一个具体模型选择对应的一种，均以 `{"rows":[{...}]}` 为请求体。

**预测示例**。假设签名要求 temperature 和 load：

```json
{"rows": [{"temperature": 25.0, "load": 430.0}]}
```

对应响应 data 的格式示例：

```json
{
  "model": {"code": "chiller-01-energy-api", "version": 1},
  "predictions": [1345.0],
  "warnings": []
}
```

`predictions` 与输入行顺序一致；数值仅为示例，实际值由模型计算。结果可能为 null，不能当作 0。`warnings` 中的 `row` 从 0 开始，训练区间外告警为 `out_of_training_range`。需要时间特征时，在每行增加 `"__ts__":"2026-10-28T01:00:00Z"`。

当前 warnings 条目的完整结构示例：

```json
{"row":0,"column":"temperature","kind":"out_of_training_range","message":"这一路输入超出训练区间，属于外推"}
```

`column` 是入口字段 key；告警不包含训练区间具体上下限。出现外推告警仍可能有预测值，不表示该值达到业务精度。无告警返回空数组。

**分类的真实输出**。当前可服务逻辑回归为数值二分类，训练目标须有两个数值类目。仍调用 `:predict`，例如 `predictions:[0.0,1.0]` 表示逐行判定的类目，不是回归量也不是正类概率。类别由已发布模型和阈值固定，不能统一按 0/1 之外的猜测映射名称。线上当前不返回概率数组、文本标签名或多分类结果；训练打分帧中出现 `y_proba` 不代表调用响应已有 probability 字段。需要这些输出时须另行扩展契约。

**异常检测示例**。假设检测模型签名要求电流、频率和温度：

```json
{"rows": [{"电流": 33.65, "频率": 40, "温度": 71}]}
```

响应 data 的格式示例：

```json
{
  "model": {"code": "device-anomaly", "version": 1},
  "results": [
    {"row": 0, "is_anomaly": false, "score": 0.42, "threshold": 1.0}
  ],
  "warnings": []
}
```

检测输入必须为签名要求的完整有限数值，不能缺失、为 null、为布尔值或数值字符串。异常判定为 `score > threshold`，分数不是故障概率，报警去抖和通知由第三方实现。

`results[].row` 必有，从 0 开始，与输入顺序一致；`is_anomaly/score/threshold` 均必有且不为空。不能计算有效异常分数时请求失败，不以正常判定代替“无法判断”。warnings 形状与预测相同。

**规则计算示例**。假设单位能耗模型要求能耗和产量：

```json
{"rows": [{"能耗": "0.30", "产量": "0.10"}]}
```

精确计量值优先用十进制字符串。返回 `data.model` 和 `data.results`，结果按输入行顺序对应；单位能耗模型可返回 `unit_consumption: "3"`，其他规则的结构以对应模型说明为准。当前规则结果不声明 `warnings` 字段，也不要额外提交 `__ts__`。

规则结果公共字段为 `kind`、`calculation_method="deterministic_rule"`、`decimal_places`，再按冻结规则追加不同字段。精确明细保留十进制字符串；`summary_value` 是展示摘要数值，不能替代精确核算明细。当前签名只把输出描述为 object，没有完整的逐规则输出 JSON Schema，应结合实际规则说明与返回展示。

| kind | 实际规则结果举例 |
|---|---|
| hvac_compliance | `is_compliant/violations/observations`，按冻结温湿度范围判定 |
| efficiency_fluctuation | `change_pct/threshold_pct/is_fluctuating/comparison_scope`，比较调用方明确提供的当前值与参考值 |
| unit_consumption | `energy/output/unit_consumption`，计量单位必须由业务输入约定 |
| efficiency_benchmark | `ratio/deviation_pct/grade/comparison_direction` |
| equipment_efficiency | `cop/threshold/grade/measurement_requirement`，要求同周期同功率口径 |
| supply_diagnosis | 观测越界与命中条件，不推断未观测的故障根因 |
| energy_aggregation | 按配置计量分类与折标系数归集的明细 |
| energy_trace | 显式计量拓扑的路径和节点收支差额，不把差额解释为泄漏原因 |

单位能耗响应 data 示例，假设冻结规则 decimal_places=6：

```json
{
  "model": {"code":"unit-consumption","version":1},
  "results": [{
    "kind":"unit_consumption",
    "calculation_method":"deterministic_rule",
    "decimal_places":6,
    "energy":"0.3",
    "output":"0.1",
    "unit_consumption":"3",
    "summary_value":3.0
  }]
}
```

精度参数是最多小数位数，字符串不保证补齐末尾零；分母为 0、缺字段、显式 null 或无效十进制输入均不能当正常结果。规则输入不接受签名外字段。

预测行数受 `max_rows_per_call` 限制；检测和规则计算还各有 256 行的上限。三类调用至少提交 1 行。相同账号的多把 APIKey 共用该账号在同一部署上的配额，签名读取也计入配额；网关另有限流和 256 KiB 请求体限制。

### 页面联调

可在系统“分析建模 → 部署服务”中打开所选服务的“调用说明”，使用“在线试算”核对输入和结果。
页面使用当前登录账号，无需在页面另填 APIKey。页面读取真实签名并展示字段、类型、单位、
必填及时间要求，按模型任务自动选择 `:predict`、`:detect` 或 `:calculate`。
将“试算输入 JSON”中的 `null` 替换为实际输入后点击“运行试算”，查看 JSON 结果。
停用或不可服务的部署不能试算；签名读取和试算计入当前账号在该部署上的配额。
第三方程序继续按本文使用账号 APIKey 接入相同端点。

### cURL 调用样例

将域名、服务编码和输入字段替换为真实值。用户 APIKey 从环境变量注入：

```bash
export BASE_URL='https://platform.example.com'
export MODEL_CODE='chiller-01-energy-api'
# DT_API_KEY 由本地环境或密钥管理器注入

curl --silent --show-error \
  "$BASE_URL/api/v1/platform/open-models/$MODEL_CODE" \
  -H "Authorization: Bearer $DT_API_KEY"

curl --silent --show-error --request POST \
  "$BASE_URL/api/v1/platform/open-models/$MODEL_CODE:predict" \
  -H "Authorization: Bearer $DT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"rows":[{"temperature":25.0,"load":430.0}]}'
```

## 幂等与常见错误

创建、配置、训练、发布、部署及本文管理动作支持持久 `Idempotency-Key`，完整操作清单见 [命令恢复契约](MODELING_MANAGEMENT_API.md#4-持久命令与超时核查)。同一账号在同一操作范围重发同一个逻辑请求时使用同一个键；修改参数、发布另一运行或启动下一次训练必须换新键。未带键时没有同等防重复与恢复保证，不把未列明的通用写接口默认视为持久命令。

```http
Idempotency-Key: 03b87444-47c4-4e04-8101-9db847a7e397
```

幂等范围是端点、键和账号；同一账号换 APIKey 不会变成新的逻辑调用者。同键不同参数返回 409/41442；处理中返回 409/41443、`Retry-After: 1` 和命令 ID。成功结果与业务变更同事务持久化，不依赖原 24 小时 Redis 缓存。已知 4xx 且动作回滚的拒绝会保存失败回执；非确定错误保留 pending，超过 5 分钟查询呈现 unknown，不自动接管或重做。修订号解决并行编辑覆盖，幂等键解决同一命令重复提交，两者不能替代。

保存提交响应头 `Modeling-Command-Id`，通过 `GET /modeling-commands/{command_id}` 查询；响应丢失时使用 `GET /modeling-commands?operation=...&resource_id=...` 并携带原 `Idempotency-Key` 找回。仅当前账号且有对应操作权限时可读。训练命令 succeeded 可能仅代表 HTTP 202 已提交，仍需按 run_id 查询终态。超时、5xx 或 unknown 时不生成新键盲重做。升级前旧缓存命中返回 409/41444，缓存已过期且无持久记录的历史请求仍需按已知资源人工核查；新机制不补造过去的参数指纹。

APIKey 代表平台账号；创建者和认证主体不接受客户端伪造。需要区分能管操作人时，仅部署配置授权的专用网关账号可提交 `X-Modeling-Operator-Id`，外部操作人与平台账号分别审计，详见 [可信操作人契约](MODELING_MANAGEMENT_API.md#5-外部操作人和调用审计)。不允许伪造 `X-Auth-*` 或借外部标识提权。本次保持共享权限域，前端隐藏列表或分发不同账号均不构成模型租户隔离。

| HTTP 状态 | 处理方式 |
|---|---|
| 400 | 参数、节点配置或输入数据不合法；读取 details 并修正 |
| 401 | 检查用户 APIKey、到期吊销情况及账号启用状态 |
| 403 | 检查账号权限；调用模型时还需确认部署已启用 |
| 404 | 检查模板、实例、运行、版本或服务编码及所在环境 |
| 409 | 修订冲突、仍在训练、编码占用或重复发布；先读取现状再处理 |
| 410 | 固定的模型版本不可服务，需要平台方检查版本 |
| 413 | 请求体过大，缩小批量 |
| 429 | 触发配额，降低并发并延迟重发 |
| 5xx | 保存时间、接口路径和 trace_id；写请求先确认是否已生效 |

平台错误 JSON 的 `data` 为 null；`details` 仅在有字段错误时出现。真实错误码示例：

```json
{
  "code":41429,
  "message":"模型配置已经更新，请重新加载后再保存",
  "data":null,
  "trace_id":"f14ea9b77b154691aa947da963cd8e12"
}
```

上例 HTTP 409。请求形状校验的 HTTP 400 示例：

```json
{
  "code":40001,
  "message":"参数校验失败",
  "data":null,
  "trace_id":"f14ea9b77b154691aa947da963cd8e12",
  "details":[{"field":"expected_revision","code":"greater_than_equal","message":"Input should be greater than or equal to 1"}]
}
```

| code | HTTP | 含义 |
|---|---|---|
| 40002 | 429 | 平台固定窗口限流 |
| 40004 | 409 | 通用冲突，例如同幂等键正在处理 |
| 40106 | 403 | 账号缺权限 |
| 41402 / 41418 | 409 | 实例编码 / 部署编码占用 |
| 41403 | 400 | 图或节点参数不合法，可能带 details |
| 41405 / 41409 / 41417 / 41426 / 41428 | 404 | 运行 / 版本 / 部署 / 模板 / 实例不存在 |
| 41406 / 41407 | 409 | 已有在途运行 / 当前运行不能取消 |
| 41410 / 41411 / 41412 / 41413 | 409 | 运行不可发布 / 已发布 / 版本不可服务 / 版本被引用 |
| 41419 / 41420 | 403 / 410 | 部署已停用 / 固定版本当前不可服务 |
| 41423 | 400 | 调用输入或行数不合法 |
| 41425 | 404 | 端口全量结果未保留或已过期 |
| 41427 / 41429 | 409 | 模板不可创建实例 / 配置修订冲突或训练中 |
| 41430 | 410 | 旧部署密钥签发入口已停用 |
| 51401 | 503 | 能管连接或历史读取未能提供可信结果 |

错误 message 会随具体情况变化，接入方按 HTTP 与 code 分支，不匹配整段文案。模型部署配额 429 返回 `Retry-After: 60`；边缘限流格式和响应头可能不同，写操作仍先核查结果。409 不是通用“稍后重试”信号：修订冲突需重新读取并合并，编码占用需核对资源，已在训练需找回该运行，已发布需找回同 run_id 的版本，未知命令不得自动重做。新增管理和命令错误码见 [错误与升级步骤](MODELING_MANAGEMENT_API.md#6-新错误与发布顺序)。

## 当前边界与后续扩展

以上列表、筛选、反查、目录、节点结果、归档恢复、部署维护和命令恢复已有本仓实现，客户接入前仍须完成迁移和版本升级，并按真实权限与数据联调。完整逐规则输出 JSON Schema、线上分类概率/多分类、独立覆盖时段统计和增量同步不属于此次管理接口扩展；其现有支持范围已在对应章节明确，不能从管理页面完成推断这些能力已具备。

“点位历史段 → 未来一段预测 → 统计置信带”是独立业务能力。现有 `:predict` 按输入行计算，不自动读取某点历史或生成未来时间，不返回模型预测区间。历史平移和时间特征算子不改变此边界。规划见 [时序预测专项方案](MODELING_TIMESERIES_FORECAST_PLAN.md)，其中候选接口和算法不是当前可调用契约。
