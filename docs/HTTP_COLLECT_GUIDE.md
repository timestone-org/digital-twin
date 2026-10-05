# HTTP JSON 数据采集接入指南

HTTP 采集把一个接口响应中的多个字段映射为点位，随后沿用 OPC UA、Modbus TCP
的 Redis 实时快照、历史归档、大屏绑定和业务分析管线。运行时连接由
`collector-server` 持有，平台负责保存数据源、点位和采集计划。

设计边界见 [ADR-0057](adr/0057-HTTP采集复用点位管线并限制出站目标.md)，
统一采集与归档口径见 [COLLECT_DESIGN.md](COLLECT_DESIGN.md)。

## 1. 先配置采集进程的出站授权

HTTP 采集默认关闭。在已有数据库、Redis、平台服务和服务级密钥配置的基础上，
为采集进程设置以下变量；修改后重启或重建采集进程，使启动配置生效。

```dotenv
COLLECT_HTTP_READ_ENABLED=true
COLLECT_HTTP_ALLOWED_ENDPOINTS=https://api.example.test:443,https://identity.example.test:443
COLLECT_HTTP_MAX_CONCURRENT_REQUESTS=8
```

| 变量                                   | 默认值  | 含义                                               |
| -------------------------------------- | ------- | -------------------------------------------------- |
| `COLLECT_HTTP_READ_ENABLED`            | `false` | 是否允许驱动向 HTTP 接口发请求                     |
| `COLLECT_HTTP_ALLOWED_ENDPOINTS`       | 空      | 逗号分隔的精确 origin 允许清单，即协议、主机和端口 |
| `COLLECT_HTTP_MAX_CONCURRENT_REQUESTS` | `8`     | 全采集进程的 HTTP 在途请求上限，范围 `1–256`       |

允许清单使用 `https://主机:443` 或 `http://主机:端口`，不使用通配符。
例如数据端点 `https://api.example.test/v1/metrics` 对应
`https://api.example.test:443`；OAuth Token URL 位于另一个 origin 时也必须
单独列入清单。只启用开关但没有允许目标时，启动校验拒绝此配置。

工业内网接口可以明确授权，例如 `http://192.168.10.20:8080`。云元数据、链路本地、
组播与未指定地址仍被拒绝。域名解析后的 IP 会固定到当前请求，Host 与 TLS SNI
保留原域名；不跟随重定向、不使用环境代理、保留 TLS 证书校验。
元数据拒绝规则也包括阿里云 `100.100.100.200` 和 AWS IPv6 `fd00:ec2::254`。
每次请求重新建立连接，以独立校验令牌接口和数据接口各自的 TLS 主机证书。

Docker 部署需要把上述变量传入 `collector-server` 容器的环境。只修改宿主机
`.env` 文件后，还应核对 `docker compose config` 和重建后的容器配置。
迁移按 [docker/README.md](../docker/README.md) 的步骤先执行，再更新服务代码。
HTTP 协议扩展迁移属于平台服务，不新增 HTTP 历史表。

## 2. 在页面中接入一个接口

1. 进入「工业数据采集」，新建数据源时选择「HTTP / HTTPS」，填写名称、稳定编码和完整 HTTP(S) 地址。
2. 选择 GET 或「POST（查询接口）」，配置认证、普通请求头、查询参数，以及 POST 请求体。
3. 设置轮询周期、请求超时和响应上限后保存。HTTP 使用轮询，源周期至少 `1000ms`。
4. 添加至少一个有效点位，可以手工填写 JSON Pointer，也可以从样例 JSON 批量生成。
5. 启用数据源，等待采集计划收敛，然后使用「测试连接」，查看运行态、实时值和质量。
6. 按业务需要调整各点位的归档、死区、归档心跳等设置，再进行业务绑定。

刚保存但没有有效点位的数据源不会打开会话。「测试连接」只对已启用、已建立会话的
数据源执行，并会实际读取上游接口；不能用空点位数据源的测试结果判断接口本身。
保存参数不代表接口已连通，应核对真实运行态与至少一个点位的读数。
HTTP 测试命令的预算至少是请求超时加 `1s`，且不小于原命令总线默认预算；
例如请求超时为 `10s` 时，测试命令保留 `11s`，避免总线先于上游请求超时。

修改数据源或点位后，平台广播计划变更，采集器按版本重新收敛；周期重拉计划用于
补偿遗漏的通知。点位 `code` 是稳定身份，不能改名；修改 JSON Pointer 保持同一
`node_key`，已有绑定和历史身份继续有效。

POST 仅接入重复调用不会改变上游状态的查询接口。采集器会按周期发送请求，不提供
写入、下发、创建、删除等 HTTP 业务操作。

## 3. 认证方式与凭据

| 认证方式                     | `auth_type`                 | 用户名栏    | 凭据栏        | 额外配置                     |
| ---------------------------- | --------------------------- | ----------- | ------------- | ---------------------------- |
| 无认证                       | `none`                      | 不填写      | 不填写        | 无                           |
| Basic                        | `basic`                     | HTTP 用户名 | 密码          | 无                           |
| Digest                       | `digest`                    | HTTP 用户名 | 密码          | 按上游认证挑战协商           |
| Bearer                       | `bearer`                    | 不填写      | Token 本体    | 系统添加 `Bearer ` 前缀      |
| API Key                      | `api_key`                   | 不填写      | API Key       | 请求头名称，默认 `X-API-Key` |
| OAuth 2.0 Client Credentials | `oauth2_client_credentials` | Client ID   | Client Secret | Token URL 与可选 Scope       |

秘密统一写入 `credential`，平台以 Fernet 加密保存。普通查询只返回
`has_credential`，不返回明文或密文。不要把 `Authorization`、Cookie、Token、API Key、
Client Secret 等写进 URL、普通请求头 JSON、查询 JSON 或请求体 JSON。
常见秘密字段及其大小写、分隔符和命名变体会被拒绝。

编辑时，凭据栏留空表示保持原凭据；API PATCH 不带 `credential` 也表示保持。
填写新值会轮换凭据并推进采集计划版本。显式 `credential: null` 表示清空；
仍使用需要凭据的认证方式时拒绝清空。改回无认证时同时清空账号和凭据。

OAuth Token URL 必须支持 `grant_type=client_credentials` 的表单请求，以及
HTTP Basic 客户端认证。Token 响应必须包含非空 `access_token` 和 Bearer
`token_type`；`expires_in` 以秒计，缺省时按 `60s` 处理。令牌仅驻留当前会话内存，
在有效期的 `10%`、最多 `30s` 前重新获取，不写入配置库或 Redis。
需要用户交互、浏览器登录、授权码、Cookie 会话或 query API Key 的接口不在支持范围。

## 4. 请求选项

界面字段对应 API 的 `options_json`。这个对象的所有取值都是字符串；请求头、
查询参数和请求体使用 JSON 文本表示。

| 键                   | 默认值与限制                                              |
| -------------------- | --------------------------------------------------------- |
| `method`             | `GET`；仅支持 `GET`、`POST`                               |
| `auth_type`          | `none`；认证值见上表                                      |
| `auth_header`        | `X-API-Key`；API Key 只通过该请求头发送                   |
| `headers_json`       | `{}`；名称和取值都为字符串，最多 `64` 个字段、`64 KiB`    |
| `query_json`         | `{}`；名称和取值都为字符串，最多 `64` 个字段、`64 KiB`    |
| `body_json`          | 未配置；仅 POST，合法 JSON，最多 `64 KiB`、`64` 层        |
| `timeout_s`          | `5`；`0 < timeout_s <= 10`，包含排队、DNS、认证与响应读取 |
| `max_response_bytes` | `1048576`；范围 `1–4194304`，即最多 `4 MiB`               |
| `token_endpoint`     | OAuth 必填 HTTP(S) Token URL                              |
| `scope`              | OAuth 可选 Scope，多个值用空格分隔，最多 `1024` 字符      |

URL 中已有的普通查询参数会保留，`query_json` 中同名键覆盖 URL 的同名参数。
响应必须是合法、未压缩的 JSON；请求发送 `Accept-Encoding: identity`。
返回 gzip、HTML、畸形 JSON、超出响应上限等情况会明确产生失败读数。
请求与响应中的 NaN、Infinity 以及超过深度上限的 JSON 都会被拒绝。

每个数据源一次最多一个请求，多个数据源共享全进程并发上限。客户端不自动重试，
认证和配置错误会停止本会话的后续轮询，等待会话退避重连；修改配置后重新收敛。
一次失败不会把其他数据源停掉。

## 5. 从一个响应生成多个点位

以下响应可以解析成温度、运行状态、设备编号和多个数组值：

```json
{
  "data": {
    "temperature": 23.5,
    "running": true,
    "deviceId": "9223372036854775807",
    "meters": [{ "value": 101 }, { "value": 202 }],
    "a/b": { "~key": 8 }
  }
}
```

| 点位编码示例  | `address`              | `data_type` | 读取值                  |
| ------------- | ---------------------- | ----------- | ----------------------- |
| `temperature` | `/data/temperature`    | `float`     | `23.5`                  |
| `running`     | `/data/running`        | `bool`      | `true`                  |
| `device_id`   | `/data/deviceId`       | `string`    | `"9223372036854775807"` |
| `meter_1`     | `/data/meters/0/value` | `int`       | `101`                   |
| `escaped_key` | `/data/a~1b/~0key`     | `int`       | `8`                     |

`address` 使用 RFC 6901 JSON Pointer：

- `/` 分隔每一级对象键或数组下标，数组下标从 `0` 开始。
- 键名里的 `~` 编码为 `~0`，`/` 编码为 `~1`。
- 根响应本身是标量时，使用 `$`；`/` 则表示根对象中名为空字符串的键。
- 最大路径长度 `1024` 字符、最大深度 `64` 层；不使用 `$.data.value` 等 JSONPath 写法。
- 数组下标是固定位置。如果数组顺序可能改变，应让上游返回稳定顺序或按稳定业务键组织对象。

页面中的「从 JSON 响应生成点位」接收粘贴的响应样例，点击「解析并预览」后选择
叶子字段，调整名称、唯一编码和类型，设置统一的初始采样/归档参数，然后批量创建。
界面不会因为粘贴样例而访问外部接口。单次最多解析 `200` 个叶子、样例上限
`1 MiB`、样例深度上限 `32` 层；`null` 无法推断类型，会提示跳过，可手工建点。

同一轮到期点位共享一次接口请求。点位实际采样不会快于源轮询周期，较慢点位仍按
自身周期调度，不会为了它单独建立一个 HTTP 会话。

支持 `float`、`int`、`bool`、`string` 四种标量点位。缺失路径、`null`、对象、数组
或无法收敛为声明类型的值会产生该点位的 `bad` 质量，其他合法字段继续采集。
请求或响应整体失败时，本轮所有请求点位产生 `bad`，不把缺失值补成零。

整数点位的安全范围是 `−9007199254740991` 到 `9007199254740991`，超过范围拒绝
作为整数采集，避免 Redis→浏览器和数值归档丢失精度。超大整数应选择 `string`；
字符串点位也可把响应中的 JSON 整数精确转换成字符串。
精确小数、金额也应由上游返回字符串并使用字符串点位，不按浮点测量值保存。
采集时间戳为本次读取时间，当前不提供自定义响应时间字段映射。

## 6. API 配置示例

下列请求发往平台的已鉴权业务入口，使用具备 `collect:manage` 权限的账号。
示例凭据与地址都是占位内容，实际接入时按接口配置替换。

创建一个使用请求头 API Key 的数据源：

```http
POST /api/v1/platform/collect-sources
Idempotency-Key: create-http-meter-source
Content-Type: application/json
```

```json
{
  "name": "能源接口",
  "code": "energy-http",
  "protocol": "http",
  "endpoint": "https://api.example.test/v1/readings?site=plant1",
  "credential": "<API Key>",
  "read_mode": "poll",
  "poll_interval_ms": 5000,
  "is_enabled": false,
  "options_json": {
    "method": "GET",
    "auth_type": "api_key",
    "auth_header": "X-API-Key",
    "headers_json": "{\"Accept\":\"application/json\"}",
    "query_json": "{\"device\":\"line1\"}",
    "timeout_s": "5",
    "max_response_bytes": "1048576"
  }
}
```

成功返回 `201` 和数据源 `id`。随后批量创建点位：

```http
POST /api/v1/platform/collect-points
Idempotency-Key: create-http-meter-points
Content-Type: application/json
```

```json
{
  "source_id": "<创建的数据源 UUID>",
  "items": [
    {
      "code": "temperature",
      "name": "温度",
      "address": "/data/temperature",
      "data_type": "float",
      "unit": "℃",
      "sampling_interval_ms": 5000,
      "archive_enabled": true,
      "deadband": 0.1,
      "archive_max_interval_ms": 60000
    },
    {
      "code": "running",
      "name": "运行状态",
      "address": "/data/running",
      "data_type": "bool",
      "sampling_interval_ms": 5000,
      "archive_enabled": true,
      "archive_max_interval_ms": 60000
    }
  ]
}
```

保存前会校验配置与 Pointer 语法。平台未取得 collector 的现场地址验证结论时，
返回的 `address_checks` 为 `unverified`，不表示字段已经存在于真实响应。
本次 HTTP 扩展不新增响应预览 API，也不把未知字段验证冒充通过。

最后 `PATCH /api/v1/platform/collect-sources/{id}`，发送
`{"is_enabled":true}`。会话建立后，可通过
`POST /api/v1/platform/collect-sources/{id}:test` 发起真实接口连通性测试，
该动作需要 `collect:operate` 权限。HTTP 不支持 `:browse`、`:browse-subtree`
或点位 `:write`，这些动作明确返回不支持。

OAuth 数据源把 `username` 设置为 Client ID、`credential` 设置为 Client Secret，
并使用以下非秘密选项：

```json
{
  "auth_type": "oauth2_client_credentials",
  "token_endpoint": "https://identity.example.test/oauth/token",
  "scope": "read:metrics",
  "method": "POST",
  "body_json": "{\"filter\":{\"site\":\"plant1\"}}"
}
```

## 7. 实时值、归档与业务模块

数据源和点位仍使用 `{source_id}:{point_code}` 身份。实时值写入
`collect:snapshot:{source_id}` Redis 哈希，字段为点位编码，载荷为
`{"value":...,"ts_ms":...,"quality":...}`。数据经平台 publisher 和
realtime-hub 推送到采集页面及大屏；页面断线或取不到新值时按现有规则标识陈旧或缺失。

开启全局归档与点位归档后，准入合格的读数经 `collect:archive:{source_id}`
Stream 写入 `collect.point_history`。首值、质量变化、超过死区的变化和归档心跳
沿用现有规则；HTTP 轮询点位的心跳在实际采样到达时判断，不生成虚构读数。
`archive_retention_days` 可以保存，但按点位保留期清理的 worker 尚未实现，
不能把该配置理解为已经自动删除过期历史。

| 使用模块 | 接入步骤                                                         |
| -------- | ---------------------------------------------------------------- |
| 大屏实时 | 在现有实时点位绑定中选择 HTTP 点位，读取同一份 Redis/WS 实时数据 |
| 大屏历史 | 使用归档来源及原有点位历史/聚合接口，选择时间窗口                |
| 数据台账 | 建立点位汇总列，绑定 `node_key`，按台账周期和聚合方式生成记录    |
| 报告     | 模板指标读取已生成的台账列，复用报告期与报告 worker              |
| 分析建模 | 台账取数算子读取对应台账列，经特征帧进入原有建模流水线           |

报告和分析通过台账层读取业务数据，应先验证历史归档与台账聚合均有有效值。
未归档、质量不合格或窗口没有有效样本时，沿用缺失/截断标注，不用零替代。
API 调用者需注意，现有实时绑定的 `source_kind="opcua"` 是兼容命名；它读取统一
点位快照，同样能绑定 HTTP 点位，不需要增加 `source_kind="http"`。

## 8. 排查与验证

| 现象                    | 检查项                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| 保存成功但没有会话      | 数据源启用状态、至少一个有效点位、collector 进程、HTTP 开关及允许清单               |
| OAuth 数据源无法连接    | 数据与 Token 两个 origin 的授权、Client ID/Secret、Token URL 与服务端客户端认证方式 |
| 认证错误                | 凭据是否有效、API Key 请求头名称、Bearer 是否仅填写 Token 本体、上游账号权限        |
| 请求/配置错误           | 上游状态码、重定向、TLS 证书、JSON 格式、压缩响应、响应上限与超时                   |
| 部分点位 `bad`          | Pointer、数组顺序、字段是否为 `null`、声明类型与整数安全范围                        |
| 实时有值而历史没有      | 全局与点位归档开关、归档准入参数、Stream/归档 writer、TimescaleDB                   |
| 历史有值而报告/分析无值 | 台账点位绑定、聚合周期和窗口、有效质量、台账生成记录                                |

本地验证使用受控 HTTP 假件或 loopback 服务，不访问生产接口。真实 Redis 与
PostgreSQL/TimescaleDB 环境配置沿用服务测试规范；没有依赖时跳过的集成用例不算
验证通过。

从仓库根目录运行共享配置测试：

```bash
uv run --project server pytest server/domain/collectwire/tests/unit/test_http.py server/domain/collectwire/tests/unit/test_http_security.py
```

进入 `server/services/collector-server` 后运行驱动与真实链路测试：

```bash
uv run --project ../../ pytest tests/unit/test_drivers_http.py tests/unit/test_drivers_http_auth.py tests/unit/test_drivers_http_targets.py tests/unit/test_drivers_http_concurrency.py tests/integration/test_http_loopback_pipeline.py
```

进入 `server/services/platform-server` 后运行配置与下游消费测试：

```bash
uv run --project ../../ pytest tests/unit/test_collect_http_profile.py tests/integration/test_collect_http_api.py tests/integration/test_http_collect_consumers.py
uv run --project ../../ python -m scripts.export_openapi --check
```

前端测试在 `web/` 目录执行，验证认证表单、Pointer 映射和实际 DOM：

```bash
corepack pnpm@11.21.0 --filter @dt/app exec vitest run tests/pages/Collect/httpPointMapping.test.ts tests/pages/Collect/httpPointMappingDialog.spec.ts tests/pages/Collect/httpSourceForm.spec.ts
```

提交前从仓库根目录执行 `scripts/ci-local.sh --fast` 并补原有采集范围回归。
这些受控测试不代替现场接口验收；实际接入后应核对至少两个点位的实时值、质量、
历史记录，以及一个实际使用这些点位的业务绑定。
