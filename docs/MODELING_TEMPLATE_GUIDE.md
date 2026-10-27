# 模板建模与第三方接入

模型设计仍使用原有算子画布。设计者保存流水线后点击“发布为模板”，产生一个有名称、
用途说明和版本号的不可变模板快照。模板库可基于同一版本创建多个模型实例；每个实例
独立保存输入数据源、输入列、目标列、预处理和算法参数，以及自己的训练记录和模型版本。
模板再次发布不会修改已有实例，停用模板只阻止新建。

## 页面操作

1. **模板设计**：新建或编辑流水线，配置数据源及算子，保存后发布模板。历史运行回看、
   未保存的图或参数草稿不能发布为模板。
2. **模板库**：按名称或编码检索模板，查看版本和状态，点击“创建模型”并填写独立名称和编码。
3. **模型实例**：使用逐节点表单或完整 JSON 修改参数，点击“保存全部配置”。Schema 标签页
   展示与服务端校验一致的完整 JSON Schema；复杂列表和规则保留结构化 JSON 编辑。
4. **训练**：保存完成后开始训练。页面自动更新进度，训练期间配置锁定，可请求取消；
   离开页面不取消 worker 的训练。每次训练保留自己的参数快照和节点结果。
5. **版本与部署**：成功运行可发布模型版本，选择可部署版本并填写稳定服务编码及配额。
   部署完成后签发调用密钥，明文只显示一次。已有部署继续固定原版本，重新训练不会自动换版。
6. **部署服务**：查看输入输出签名和调用示例，管理密钥、启停和版本切换。

## 两类凭据

建模管理接口使用 `Authorization: Bearer <账号 API 密钥>`。第三方专用账号授予
`modeling:view`、`modeling:run`，需要发布和部署时增加 `modeling:publish`。
不授予 `modeling:manage` 即不能设计和发布模板。资源沿用平台现有共享权限域；
这些权限不代表不同第三方之间的租户隔离。

线上模型调用使用 `X-Api-Key: <部署密钥>`。部署密钥不赋予模板、参数、训练或发布管理权限。
两类密钥均不放入 URL。

## 接入顺序

所有路径均以 `/api/v1/platform` 开头。响应使用 `{code,message,data,trace_id}`，
必须同时检查真实 HTTP 状态；创建资源为 201，训练提交为 202。

| 操作 | 方法与路径 | 关键内容 |
|---|---|---|
| 找模板 | `GET /modeling-templates?page=1&size=20&q=能耗` | 选定 `is_enabled=true` 的模板 ID，列表需要翻页 |
| 取全部 Schema 和默认值 | `GET /modeling-templates/{template_id}/configuration` | `configuration.nodes`、`json_schema`、`nodes[].operator`，每个算子含参数 Schema 和输入输出端口 |
| 创建模型 | `POST /modeling-instances` | `template_id`、`code`、`name`；可同时给完整 `configuration` |
| 读取配置快照 | `GET /modeling-instances/{id}/configuration` | `instance` 和 `configuration` 来自同一读取快照，使用 `instance.revision` 保存 |
| 一次配置全部参数 | `PUT /modeling-instances/{id}/configuration` | `expected_revision`、完整 `configuration`，可附带 `name` 和 `description` |
| 发起训练 | `POST /modeling-instances/{id}:train` | `{"trigger":"api"}`，保留返回的运行 ID |
| 查询训练 | `GET /modeling-runs/{run_id}` | `pending/running/cancelling/succeeded/failed/cancelled`；失败读取 `error_text` |
| 取消训练 | `POST /modeling-runs/{run_id}:cancel` | 取消在 worker 的节点边界生效 |
| 发布模型版本 | `POST /modeling-model-versions` | `run_id`、`name`；必须是成功运行 |
| 部署 | `POST /modeling-instances/{id}:deploy` | `model_version_id`、`code`、`name`、可选配额；版本必须属于本实例并可服务 |
| 签发调用密钥 | `POST /modeling-deployments/{deployment_id}/api-keys` | `{"name":"业务系统"}`；保存一次性 `plaintext` |
| 读线上签名 | `GET /open-models/{code}` | 使用部署密钥，实际输入输出以签名为准 |
| 预测 / 检测 / 核算 | `POST /open-models/{code}:predict`、`:detect`、`:calculate` | 使用部署密钥，按模型任务类型选择端点 |

创建模板、创建实例、训练和部署支持 `Idempotency-Key`。同一逻辑操作重放时使用同一键，
新操作使用新键。配置采用乐观版本保护；409 时重新读取完整配置快照，并由调用方确认
合并后重新提交，不能直接用新修订号覆盖旧草稿。

从模板 Schema 取得参数后，保留全部节点 ID，只修改节点的参数对象。未知节点、缺少节点、
算子不认识的字段和整图约束错误都会被拒绝；整份参数全部通过才保存。
例如切分算子使用 `method: "time_order"`，线性回归使用 `use_intercept: true`；
不得根据示例猜测其他模板的节点 ID 或参数名。

输入列、目标和处理链确定后，训练发布得到实际模型签名。模型含时间特征时检查
`requires_timestamp` 并按签名提供 `__ts__`。不能根据尚未执行的图虚构最终签名。

## 验收与启动

`server/services/platform-server/scripts/verify_modeling_templates.py` 是可重复运行的真实
HTTP 验收脚本。目标必须是明确的隔离测试环境；它会创建合成台账、模板、第三方测试
账号、模型和部署，保留数据供页面复核。脚本需要真实 API、auth、NGINX、PostgreSQL、
Redis 和 worker，不使用假训练结果。

```sh
export MODELING_E2E_BASE_URL=http://127.0.0.1:18080
export MODELING_E2E_PASSWORD='<隔离环境管理员密码>'
export MODELING_E2E_RESULT=/tmp/modeling-template-e2e.json
server/.venv/bin/python server/services/platform-server/scripts/verify_modeling_templates.py
```

验收数据满足 `能耗 = 2 × 温度 + 3 × 负荷 + 5`，部署后输入温度 25、负荷 430，
预测应接近 1345。脚本同时确认第三方不能发布模板、Schema 完整，以及重复训练请求
返回同一运行 ID。集成测试与页面 E2E 使用不同数据库，避免持久化验收样本影响列表计数。

上线需先执行平台扩展迁移 `f02b841ac356`，再更新平台 API / worker、认证服务并同步权限
路由种子，最后更新前端。迁移只新增模板、实例与审计表，不回填或改写旧流水线。
代码回滚时保留新增表；旧代码不提供模板建模入口，已部署的模型版本和既有调用面保留。
