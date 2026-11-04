# 数据分析模块第三方模型调用接口文档

本文供第三方系统接入已部署模型，覆盖查询全部部署、读取模型输入 schema，以及执行预测、异常检测和规则计算。接入顺序为：查询部署列表，选择可调用部署，读取输入说明，再向该模型的 `invoke_url` 提交数据。

核对日期：2026 年 11 月 4 日。本文依据仓库当前接口实现与 OpenAPI 编写，实际服务地址、部署模型和输入字段以目标环境返回为准。文中模型编码、字段和计算结果均为示例。

## 1 接入约定

### 1.1 服务地址与认证

平台部署方提供 `BASE_URL` 和具有 `modeling:view` 权限的账号 APIKey。本文所有路径均拼接在 `BASE_URL` 后，例如：

```text
https://platform.example.com/api/v1/platform/modeling-deployments
```

所有接口均携带以下认证头，无需先换取 JWT：

```http
Authorization: Bearer <账号 APIKey>
```

账号 APIKey 形如 `dtk_…`，由平台管理员在“系统管理 → API 密钥”中签发。密钥权限继承所属账号；当前模型资源为共享权限域，具有 `modeling:view` 的账号可查看全部部署并调用任意启用且可服务的部署。

POST 接口还需携带：

```http
Content-Type: application/json
```

### 1.2 响应格式

本文接口成功均返回 HTTP `200`，JSON 响应使用统一信封：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

`data` 为具体业务结果，部署列表中为数组；`trace_id` 用于排查调用问题。客户端同时检查 HTTP 状态与业务 `code`，兼容响应中新增的字段。

### 1.3 接口总览

| 用途 | 方法 | 路径 |
| --- | --- | --- |
| 查询全部部署 | GET | `/api/v1/platform/modeling-deployments` |
| 读取模型输入 schema 和输出说明 | GET | `/api/v1/platform/open-models/{code}` |
| 回归或分类预测 | POST | `/api/v1/platform/open-models/{code}:predict` |
| 异常检测 | POST | `/api/v1/platform/open-models/{code}:detect` |
| 规则计算 | POST | `/api/v1/platform/open-models/{code}:calculate` |

`{code}` 使用部署列表返回的 `code`，不是部署 UUID `id`，也不是模型名称。推荐直接使用列表中的 `signature_url` 与 `invoke_url`；它们是包含 `/api/v1/platform` 前缀的同源相对路径，拼接时不要重复添加前缀。

## 2 查询全部部署

```http
GET /api/v1/platform/modeling-deployments
```

无请求体。不带查询参数时返回全部部署，包括已停用或不可服务的部署；当前接口不分页，`data` 直接为数组，无 `items` 或 `total`。没有部署时返回 `[]`。

可选查询参数如下；查询全部时全部省略即可。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `code` | string | 按部署编码精确筛选，2–63 位小写字母、数字或连字符，首位为字母或数字 |
| `model_version_id` | UUID string | 按固定模型版本筛选 |
| `instance_id` | UUID string | 按来源模型实例筛选 |
| `is_enabled` | boolean | `true` 仅查询启用项，`false` 仅查询停用项 |

成功响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "019b9b96-7fd0-7000-8000-000000000001",
      "code": "chiller-energy",
      "model_version_id": "019b9b96-7fd0-7000-8000-000000000002",
      "model_name": "冷机能耗模型",
      "model_version": 1,
      "task": "regression",
      "invoke_url": "/api/v1/platform/open-models/chiller-energy:predict",
      "signature_url": "/api/v1/platform/open-models/chiller-energy",
      "name": "冷机能耗预测服务",
      "description": "根据温度与负载预测能耗",
      "is_enabled": true,
      "is_servable": true,
      "unservable_reason": null,
      "max_rows_per_call": 200,
      "rate_limit_per_minute": 60,
      "key_count": 0,
      "created_by_name": "平台管理员",
      "created_at": "2026-11-04T01:00:00.000Z",
      "updated_at": "2026-11-04T01:00:00.000Z",
      "revision": 1
    }
  ],
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

接入时重点读取以下字段：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `code` | string | 调用模型使用的部署编码 |
| `name` / `model_name` | string | 服务名称 / 模型版本名称，用于展示 |
| `model_version_id` / `model_version` | string / integer | 当前固定模型版本的 UUID / 版本号 |
| `task` | string | `regression`、`classification`、`anomaly_detection` 或 `rule_calculation` |
| `signature_url` | string | 输入输出签名的 GET 路径 |
| `invoke_url` | string | 对应任务的 POST 路径 |
| `is_enabled` | boolean | 平台是否启用该部署 |
| `is_servable` | boolean | 固定模型版本是否可服务 |
| `unservable_reason` | string 或 null | 不可服务时的原因 |
| `max_rows_per_call` | integer | 单次调用最大输入行数 |
| `rate_limit_per_minute` | integer | 同一账号在该部署上的每分钟请求额度 |

选择 `is_enabled=true` 且 `is_servable=true` 的部署。`key_count` 是历史部署密钥数量，不决定当前账号能否调用。部署换版后 `code` 和地址可保持不变，模型版本与签名可能变化，接入方应重新核对输入输出说明。

## 3 读取模型输入 schema

```http
GET /api/v1/platform/open-models/{code}
```

路径参数 `code` 必填，无请求体。也可直接 GET 部署项中的 `signature_url`。

接口返回模型签名，其中 `inputs` 就是组装请求行所需的输入 schema。当前没有单独的 `input_schema` 字段，也不是标准 JSON Schema 文档。

成功响应示例，假设该回归模型已声明缺值处理策略：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "task": "regression",
    "invoke_url": "/api/v1/platform/open-models/chiller-energy:predict",
    "format_version": "1.0",
    "requires_timestamp": false,
    "timestamp_key": null,
    "inputs": [
      {
        "key": "temperature",
        "label": "温度",
        "unit": "℃",
        "dtype": "number",
        "is_required": true,
        "default_on_missing": null,
        "missing_policy": {
          "on_missing": "reject",
          "on_null": "return_null"
        }
      },
      {
        "key": "load",
        "label": "负载",
        "unit": "kW",
        "dtype": "number",
        "is_required": true,
        "default_on_missing": null,
        "missing_policy": {
          "on_missing": "reject",
          "on_null": "return_null"
        }
      }
    ],
    "derived": [],
    "output": {
      "task": "regression",
      "key": "energy",
      "label": "能耗",
      "unit": "kWh",
      "dtype": "number"
    }
  },
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

| 字段 | 含义 |
| --- | --- |
| `task` / `invoke_url` | 模型任务与推荐调用地址 |
| `inputs[].key` | 请求中每行对象使用的字段名，必须原样使用 |
| `inputs[].label` / `unit` | 展示名称与单位；数值按该单位提供，不把单位拼入值中 |
| `inputs[].dtype` | 训练入口类型元信息；线上可接受的值还须遵守下文各任务的输入规则 |
| `inputs[].is_required` | 是否必须提供该字段 |
| `inputs[].default_on_missing` | 模型已冻结的拟合默认值；可能为 null 或省略，不表示默认填零 |
| `inputs[].missing_policy` | 缺字段和显式 null 的处理策略，历史签名可能省略 |
| `requires_timestamp` / `timestamp_key` | 为 true 时每行必须提供 `__ts__`；不需要时 `timestamp_key` 为 null |
| `derived` | 模型内部派生字段，调用方无需提交 |
| `output` | 输出任务、名称、单位等说明 |
| `format_version` | 公开输入输出签名的格式版本，当前为 `1.0`，历史签名可能省略；与内部推理格式版本不同 |

组装请求时按 `inputs[].key` 提交原始输入，不提交训练目标列或 `derived` 字段；JSON 对象键的排列顺序不影响字段对应关系。公开签名不返回训练区间统计。

对于回归和分类模型，`missing_policy.on_missing=fitted_default` 或 `on_null=fitted_default` 表示相应缺值按冻结的拟合默认值计算；`reject` 表示缺字段被拒绝，`return_null` 表示相应空值保留为空。历史模型中的“可选”提示不保证实际执行填值，接入时应优先提供完整输入，不能自行补零。

当 `requires_timestamp=true` 时，每行增加如下字段；统一使用带时区的 UTC RFC3339 时间，不使用本地无时区时间或 Unix 时间戳：

```json
{"temperature": 25.0, "load": 430.0, "__ts__": "2026-11-04T01:00:00Z"}
```

签名读取同样校验部署状态并计入调用配额，停用或不可服务的部署不能通过此接口读取签名。

## 4 执行模型调用

三类调用均为同步 HTTP 请求，至少提交 1 行，成功直接返回结果。按签名中的 `task` 选择对应的 `invoke_url`：

| task | 接口动作 | 返回结果 |
| --- | --- | --- |
| `regression` / `classification` | `:predict` | `predictions` 逐行预测值或数值类目 |
| `anomaly_detection` | `:detect` | `results` 逐行异常判定、分数、阈值 |
| `rule_calculation` | `:calculate` | `results` 逐行结构化计算结果 |

请求体统一为 `{"rows":[{...}]}`，每行是扁平字段对象。行数不得超过部署的 `max_rows_per_call`；异常检测和规则计算还各有 256 行上限，即实际最大行数为 `min(max_rows_per_call, 256)`。通过现有边缘网关调用时，请求体上限为 256 KiB，批次还需满足该大小限制。

### 4.1 回归或分类预测

```http
POST /api/v1/platform/open-models/{code}:predict
```

请求示例，输入字段对应第 3 节签名：

```json
{
  "rows": [
    {"temperature": 25.0, "load": 430.0},
    {"temperature": 26.0, "load": 450.0}
  ]
}
```

输入特征接受 JSON 数值或 null，不接受布尔值、数值字符串、嵌套对象或数组。缺少必填字段会被拒绝；空值结果取决于固定模型版本的缺值策略。

成功响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "model": {"code": "chiller-energy", "version": 1},
    "predictions": [1345.0, 1402.0],
    "warnings": []
  },
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

`predictions[i]` 对应 `rows[i]`，结果可能为 null，不能当作 0。`model.version` 是本次实际执行的模型版本。分类模型同样使用 `predictions` 返回数值类目，不是类目概率；其含义应按该模型业务约定解释。

预测和异常检测的 `warnings` 均为数组，无告警时返回 `[]`。输入超出训练区间时，可能包含：

```json
{
  "row": 0,
  "column": "temperature",
  "kind": "out_of_training_range",
  "message": "这一路输入超出训练区间，属于外推"
}
```

`row` 从 0 开始，`column` 是输入字段 key。存在告警仍可能返回预测值，调用方应保留并展示告警。

### 4.2 异常检测

```http
POST /api/v1/platform/open-models/{code}:detect
```

仅用于 `task=anomaly_detection`。假设对应签名要求以下三个字段：

```json
{
  "rows": [
    {"电流": 33.65, "频率": 40, "温度": 71}
  ]
}
```

全部输入必须提供完整的有限数值，不接受缺失、null、布尔值或数值字符串，也不接受签名外的业务字段；需要时间时按签名额外提供 `__ts__`。

成功响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "model": {"code": "device-anomaly", "version": 1},
    "results": [
      {"row": 0, "is_anomaly": false, "score": 0.42, "threshold": 1.0}
    ],
    "warnings": []
  },
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

`results[].row` 从 0 开始，对应输入行；`score > threshold` 时 `is_anomaly=true`。分数不是故障概率。无法产生有效分数时请求失败，不会返回正常判定来代替“无法判断”。

### 4.3 规则计算

```http
POST /api/v1/platform/open-models/{code}:calculate
```

仅用于 `task=rule_calculation`。假设对应单位能耗模型要求“能耗”和“产量”：

```json
{
  "rows": [
    {"能耗": "0.30", "产量": "0.10"}
  ]
}
```

所有输入字段必须齐全，接受数值或有效十进制字符串，精确计量值推荐用十进制字符串。拒绝缺失、null、布尔值和签名外字段；此接口不接受额外 `__ts__`。

成功响应示例，假设该规则最多保留 6 位小数：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "model": {"code": "unit-consumption", "version": 1},
    "results": [
      {
        "kind": "unit_consumption",
        "calculation_method": "deterministic_rule",
        "decimal_places": 6,
        "energy": "0.3",
        "output": "0.1",
        "unit_consumption": "3",
        "summary_value": 3.0
      }
    ]
  },
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

`results[i]` 对应 `rows[i]`，具体字段随规则变化。精确结果保留为十进制字符串，不保证补齐末尾零；`summary_value` 是展示摘要，不能代替精确明细。规则接口不返回 `warnings` 字段。目前签名的规则输出只描述为 object，完整结果结构需结合具体规则说明确认。

## 5 调用配额与错误处理

同一账号的多把 APIKey 共享该账号在同一部署上的每分钟额度；不同账号、不同部署分别计数。签名读取与模型计算共享该额度。超过部署额度返回 HTTP `429`，并带 `Retry-After: 60`，客户端按该响应头延迟再发。

平台业务错误示例，HTTP `400`：

```json
{
  "code": 41423,
  "message": "第 1 行缺少「temperature」",
  "data": null,
  "trace_id": "f14ea9b77b154691aa947da963cd8e12"
}
```

| HTTP | 业务 code | 含义与处理 |
| --- | --- | --- |
| 400 | `40001` | 请求形状或参数校验失败，按可选 `details` 修正字段 |
| 400 | `41423` | 模型输入不合法、行数超限或任务接口不匹配，核对签名和请求数据 |
| 401 | 以实际响应为准 | 凭据缺失、无效、吊销、过期或账号停用，检查账号 APIKey |
| 403 | `40106` | 账号缺少所需权限，联系管理员授予 `modeling:view` |
| 403 | `41419` | 部署已停用，联系平台方确认 |
| 404 | `41417` | 部署编码不存在，重新查询当前环境的部署列表 |
| 410 | `41420` | 固定模型版本不可服务，联系平台方检查模型和产物 |
| 413 | 以实际响应为准 | 网关拒绝过大的请求体，缩小批次 |
| 429 | `40002` | 部署账号配额超限，遵循 `Retry-After` |
| 5xx | 以实际响应为准 | 服务异常，保存调用时间、路径和 `trace_id` 供排查 |

网关还有独立的 IP 限流，网关认证失败、限流和超大请求等响应可能没有上述 JSON 信封。客户端先判断 HTTP 状态和响应内容类型，再解析 JSON，不按整段 `message` 文案做程序分支。本文计算接口不提供按 `Idempotency-Key` 去重的保证，重复调用会再次执行并消耗额度。

## 6 cURL 接入示例

将示例域名替换为实际地址，`DT_API_KEY` 通过本地环境或密钥管理器注入；`MODEL_CODE` 替换为列表返回的部署编码。

```bash
export BASE_URL='https://platform.example.com'
export MODEL_CODE='chiller-energy'
# DT_API_KEY 由环境注入

# 第一步 查询全部部署
curl --silent --show-error \
  "$BASE_URL/api/v1/platform/modeling-deployments" \
  -H "Authorization: Bearer $DT_API_KEY"

# 第二步 查看所选模型的输入 schema
curl --silent --show-error \
  "$BASE_URL/api/v1/platform/open-models/$MODEL_CODE" \
  -H "Authorization: Bearer $DT_API_KEY"

# 第三步 按签名准备输入并调用 此例为回归预测
curl --silent --show-error --request POST \
  "$BASE_URL/api/v1/platform/open-models/$MODEL_CODE:predict" \
  -H "Authorization: Bearer $DT_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"rows":[{"temperature":25.0,"load":430.0}]}'
```

异常检测或规则模型将第三步地址改为该模型返回的 `invoke_url`，并按对应 `inputs` 更换字段。上述接口按调用方提供的行数据计算；不会自动读取点位历史、生成未来时间点或返回预测置信区间。

## 7 契约来源

- [Platform OpenAPI](../server/services/platform-server/openapi.json)：请求与响应字段定义。
- [账号 API 密钥决策](adr/0062-模型调用统一使用账号API密钥.md)：账号权限与配额口径。
- [完整第三方建模接口说明](MODELING_THIRD_PARTY_API.md)：需要扩展到建模管理时查阅。
