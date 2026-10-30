# DigitalTwin 第三方接入页面接口说明

文档版本 1.3　接口版本 v1　更新日期 2026 年 10 月 30 日

本文对应系统“分析建模 → 第三方接入 → 接入指南”页面的 8 步流程：选择模板、获取配置、创建模型、配置参数、训练、发布版本、部署、调用服务。平台方预先设计并发布模板，第三方按模板完成建模和使用模型。已有部署时，也可先获取全部已部署模型列表，选择服务后直接调用。

全部请求统一使用用户 APIKey。模板、模型实例和部署服务分别有自己的 ID 或编码，按每一步返回的结果继续调用。

**适用版本**：目标环境须已更新为统一用户 APIKey 的接入版本。BASE_URL、用户 APIKey 和可用模板由平台方提供；本文示例域名、UUID、列名和数值均为示意，实际输入以所选模板及已部署模型的签名为准。

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

完成整条流程的第三方账号需要上述三项权限，无需模板设计权限 `modeling:manage`。APIKey 继承账号权限；账号停用、密钥过期或吊销后，后续请求被拒绝。当前模型资源属于共享权限域，不按创建者做租户隔离。

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

## 获取全部已部署模型

`GET /modeling-deployments`

权限：`modeling:view`。成功：HTTP 200。使用同一把用户 APIKey，无请求体，无分页参数。

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

## 第八步 调用服务

### 读取模型签名

`GET /open-models/{code}`

权限：`modeling:view`。成功：HTTP 200。`code` 使用部署列表选中项的服务编码，或第七步返回的服务编码。

此接口的 `data` 本身就是模型签名。重点读取：

| 字段 | 用途 |
|---|---|
| inputs[].key | 每行 JSON 中应提供的输入字段名 |
| inputs[].dtype、unit | 输入类型及单位 |
| inputs[].is_required、default_on_missing | 是否必填及缺失值策略；null 不表示填零 |
| requires_timestamp | 为 true 时按模型要求提供每行的 __ts__ 时间 |
| output.task | 决定使用预测、异常检测还是规则计算接口 |

输入字段使用 `inputs[].key`，不使用训练后的 `feature_keys`，也不要提交训练目标列。对外签名不提供训练统计的具体数值。

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

**规则计算示例**。假设单位能耗模型要求能耗和产量：

```json
{"rows": [{"能耗": "0.30", "产量": "0.10"}]}
```

精确计量值优先用十进制字符串。返回 `data.model` 和 `data.results`，结果按输入行顺序对应；单位能耗模型可返回 `unit_consumption: "3"`，其他规则的结构以对应模型说明为准。当前规则结果不声明 `warnings` 字段，也不要额外提交 `__ts__`。

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

创建实例、训练实例、发布版本、部署实例建议使用 `Idempotency-Key`。同一账号在同一端点重发同一个逻辑请求时使用同一个键；修改参数、发布另一运行或启动下一次训练必须换新键。成功结果当前保留 24 小时，未带键时没有同等防重复保证。

```http
Idempotency-Key: 03b87444-47c4-4e04-8101-9db847a7e397
```

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
