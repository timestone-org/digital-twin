# 模板建模与第三方接入

第三方接入页面的已部署模型查询、8 步建模流程、字段说明与调用示例见 [第三方接入页面接口说明](MODELING_THIRD_PARTY_API.md)。

模型设计仍使用原有算子画布。设计者保存流水线后点击“发布为工作流”，产生一个有名称、
用途说明和版本号的不可变模板快照。模板库可基于同一版本创建多个模型实例；每个实例
独立保存输入数据源、输入列、目标列、预处理和算法参数，以及自己的训练记录和模型版本。
模板再次发布不会修改已有实例，停用模板只阻止新建。

## 完整流程与配置归属

流水线配置 → 发布工作流（建模模板版本）→ 创建模型实例 → 配置 → 训练 → 发布模型版本
→ 部署 → 预测、检测或规则计算。已有流水线直接运行和发布模型版本的能力继续保留。

| 阶段 | 保存内容 | 后续优化方式 |
|---|---|---|
| 设计流水线 | 可编辑的节点、连线和默认参数 | 从模型实例复制独立设计，或编辑现有设计；保存后发布新的模板版本 |
| 发布工作流 | 当时流水线结构和默认配置的不可变模板快照 | 新发布产生新版本，不改写已有模板版本或模型实例 |
| 模型实例 | 指定模板版本的独立流水线副本及完整配置 | 保持结构固定，集中修改节点参数；修订号防止覆盖并行编辑 |
| 训练运行 | 提交训练时固定的流水线和配置，以及节点结果 | 按运行 ID 读取历史配置形成草稿，核对并保存后重新训练 |
| 模型版本 | 成功运行的计算本体、输入输出签名、指标及来源运行 | 新训练发布新版本，已有计算本体保持不变 |
| 部署服务 | 稳定服务编码、固定模型版本、启停及调用配额 | 显式选择版本切换；配置、重训和模板发布不会自动切换部署 |
| 预测等调用 | 使用部署固定版本的实际签名和计算能力 | 第三方通过账号 API 密钥选择对应任务接口 |

参数优化可在当前实例上继续，也可从某次历史训练的配置开始。历史配置读取不会自动保存；
保存后生成新修订号，后续训练产生新运行，原运行和已部署模型继续保留。
需要调整节点或连线时，具有 `modeling:manage` 权限的设计者可在模型实例页点击
“优化流水线结构”。先保存当前配置草稿，再填写新流水线名称和唯一编码；系统复制
**该模型当前已保存的独立流水线及配置**，创建一条已保存的新设计并进入画布。
即使来源设计后来已修改，复制起点仍保持本模型的实际结构和参数。
在新画布完成结构优化后先保存，再发布新工作流并显式创建新模型实例、训练及部署。
原模型、已发布工作流和已有部署均不修改，也不存在模板更新向已有实例的隐式传播。

“部署服务”展示共享权限域中全部部署，包括启用、停用及暂不可服务的记录。
只有 `is_enabled=true` 且 `is_servable=true` 的服务可以调用；列表展示版本、配额和不可服务原因。
同一模型版本的多个部署分别显示。切换线上版本使用部署管理页或
`PATCH /modeling-deployments/{id}` 的 `model_version_id`，不依赖“最新训练”自动替换。

## 页面操作

1. **建模工作台**：新建或编辑流水线，配置数据源及算子，保存后点击“发布为工作流”。历史运行回看、
   未保存的图或参数草稿不能发布为模板。
2. **已发布工作流（建模模板）**：按名称或编码检索工作流，查看版本和状态，点击“创建模型”并填写独立名称和编码。
3. **模型实例**：使用逐节点表单或完整 JSON 修改参数，点击“保存全部配置”。Schema 标签页
   展示与服务端校验一致的完整 JSON Schema；复杂列表和规则保留结构化 JSON 编辑。
   需要调整节点或连线时，保存草稿后使用“优化流水线结构”创建独立设计，此入口需要 `modeling:manage`。
4. **训练**：保存完成后开始训练。页面自动更新进度，训练期间配置锁定，可请求取消；
   离开页面不取消 worker 的训练。每次训练保留自己的参数快照和节点结果。
5. **版本与部署**：成功运行可发布模型版本，选择可部署版本并填写稳定服务编码及配额。
   部署完成后直接使用用户 APIKey 调用，无需再签发部署密钥。已有部署继续固定原版本，重新训练不会自动换版。
6. **部署服务**：管理启停和版本切换，打开“调用说明”查看输入输出要求，使用“在线试算”
   验证真实输入和结果。页面使用当前登录账号，无需输入 APIKey；第三方程序使用用户 APIKey 调用。

在线试算先读取部署固定版本的真实签名，展示字段、类型、单位和必填提示，自动选择预测、
异常检测或规则计算端点。将 JSON 示例中的 `null` 替换为实际输入；需要时间特征时补齐每行
`__ts__`，再点击“运行试算”，结果以 JSON 显示。停用或不可服务的部署不能试算。
签名读取和试算都计入当前账号在该部署上的配额，与同账号的 APIKey 调用共用额度。

## 统一账号凭据

建模管理与线上模型调用均使用 `Authorization: Bearer <账号 API 密钥>`。第三方专用账号授予
`modeling:view`、`modeling:run`，需要发布和部署时增加 `modeling:publish`。
不授予 `modeling:manage` 即不能设计和发布模板。资源沿用平台现有共享权限域；
这些权限不代表不同第三方之间的租户隔离。

仅调用模型需要 `modeling:view`。密钥由系统管理中的 API 密钥入口统一管理，
账号停用、密钥到期或吊销后调用立即被拒绝。密钥不放入 URL。

## 接入顺序

所有路径均以 `/api/v1/platform` 开头。响应使用 `{code,message,data,trace_id}`，
必须同时检查真实 HTTP 状态；创建资源为 201，训练提交为 202。

| 操作 | 方法与路径 | 关键内容 |
|---|---|---|
| 获取全部已部署模型 | `GET /modeling-deployments` | 返回 data 数组，无需分页；选取 is_enabled 与 is_servable 均为 true 的记录，使用其 code 读取签名并调用 |
| 找模板 | `GET /modeling-templates?page=1&size=20&q=能耗` | 选定 `is_enabled=true` 的模板 ID，列表需要翻页 |
| 取全部 Schema 和默认值 | `GET /modeling-templates/{template_id}/configuration` | `configuration.nodes`、`json_schema`、`nodes[].operator`，每个算子含参数 Schema 和输入输出端口 |
| 创建模型 | `POST /modeling-instances` | `template_id`、`code`、`name`；可同时给完整 `configuration` |
| 读取配置快照 | `GET /modeling-instances/{id}/configuration` | `instance` 和 `configuration` 来自同一读取快照，使用 `instance.revision` 保存 |
| 读取历史训练配置 | `GET /modeling-instances/{id}/configuration?run_id={run_id}` | 返回该次运行固定的配置和当前实例修订号，核对后复用 PUT 保存并继续优化；跨实例运行返回 404 |
| 一次配置全部参数 | `PUT /modeling-instances/{id}/configuration` | `expected_revision`、完整 `configuration`，可附带 `name` 和 `description` |
| 发起训练 | `POST /modeling-instances/{id}:train` | `{"trigger":"api"}`，保留返回的运行 ID |
| 查询训练 | `GET /modeling-runs/{run_id}` | `pending/running/cancelling/succeeded/failed/cancelled`；失败读取 `error_text` |
| 取消训练 | `POST /modeling-runs/{run_id}:cancel` | 取消在 worker 的节点边界生效 |
| 发布模型版本 | `POST /modeling-model-versions` | `run_id`、`name`；必须是成功运行 |
| 部署 | `POST /modeling-instances/{id}:deploy` | `model_version_id`、`code`、`name`、可选配额；版本必须属于本实例并可服务 |
| 读线上签名 | `GET /open-models/{code}` | 使用账号 API 密钥，实际输入输出以签名为准 |
| 预测 / 检测 / 核算 | `POST /open-models/{code}:predict`、`:detect`、`:calculate` | 使用账号 API 密钥，按模型任务类型选择端点 |

创建模板、创建实例、训练、发布模型版本和部署支持 `Idempotency-Key`。同一逻辑操作重放时使用同一键，
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
返回同一运行 ID、模型版本发布重放返回同一版本与 `Location`、历史训练配置可恢复继续编辑，
以及配置优化不改变已有部署固定的版本。集成测试与页面 E2E 使用不同数据库，
避免持久化验收样本影响列表计数。

上线需先执行平台扩展迁移 `f02b841ac356`，再更新平台 API / worker、认证服务并同步权限
路由种子，最后更新前端。迁移只新增模板、实例与审计表，不回填或改写旧流水线。
代码回滚时保留新增表；旧代码不提供模板建模入口，已部署的模型版本和既有调用面保留。
