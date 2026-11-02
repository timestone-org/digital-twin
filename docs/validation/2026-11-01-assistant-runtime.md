# AI 助手运行时验收（2026-11-01）

> 快照边界：本记录来自原工作区，其中同时存在其它任务的未提交改动。原有大屏传输选项、流水线复制与错误提示改动未纳入本系列提交。干净抽取版已另做自动化与视觉验证，发布范围及日志见 [隔离交付记录](2026-11-02-isolated-release.md) 和 [议题 #362](https://github.com/timestone-org/digital-twin/issues/362)。后续新增的边界修复以隔离分支及正式 CI 为准，不把本记录的旧源码哈希冒充最终版本。

> 2026-11-02更新：主环境恢复后，当前目录的实际订阅模型路径已成功完成真实自动压缩验收；见[新验收报告](2026-11-02-assistant-real-runtime.md)。下文保留11月1日环境与ENV路径的历史证据，不作为今天实际目录模型不可用的结论。

本记录区分真实数据库/HTTP 证据与供应商证据。当前主环境依赖不可用，本轮不修改既有容器、数据库、网络或路由；独立运行专用 PostgreSQL 与 Redis。

## 已完成的数据库与应用集成

- 使用本机已有 postgres:16-alpine 镜像，独立容器 dt-ai-goal-validation-20261101、端口 127.0.0.1:55439、库 dt_ai_validation，数据在专用 tmpfs 中。
- 完整运行助手 Alembic 迁移至 head，然后运行 tests/integration：**96 项通过**，无跳过。
- 用例通过真实 FastAPI 路由、签名身份、SQLAlchemy 与 PostgreSQL；HTTP 客户端为 ASGITransport，模型在这一层使用现有脚本模型 seam。
- 新增 test_context_api.py 验证：按容量触发摘要并保存 summary_json；HTTP detail 中旧消息逐字完整；当前用户要求保留；运行期 SSE 有 compressing / compressed；供应商用量映射为已用 token。现有会话归属、客户端回执、待续及 MCP 确认等集成测试也全部通过。
- 一条旧流式测试仍假定只有原来的事件，已更新为保留原事件相对顺序并检查新增 context，不依赖不同队列之间的调度顺序。

## 跨网络模型协议验收

**三个跨网络场景全部通过。** 真实 Uvicorn 助手监听本地18086，PostgreSQL与Redis分别独立运行在55439、56389；ready返回200。Postman CLI 1.77.0仿真位于4141，仅模型服务是mock，应用没有替换Responder或数据库。真实OpenAiCompatAdapter、GuardedModel与流式API完成整个链路。

| 场景           | 模型端独立观测                                                           | 应用与数据库结果                                                                  |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 自动压缩       | 非流式summary两次，流式chat一次，chat携带37个工具声明                    | summary_json有效切点；6条历史完整；context出现compressed；usage为1520且明确非估算 |
| 结构化超限恢复 | chat 5037字符返回400；summary 3583字符返回200；chat缩到1804字符后返回200 | 仅一次恢复；回复只有一份；6条历史完整                                             |
| 客户端回执续跑 | 独立receipts前后chat计数仍为1，续跑后为2                                 | 一条实际tool回执，重复提交不重复写，最终正常turn.done                             |

字符数统计的是序列化messages，不包括工具声明。使用率1520来自合成供应商回包的1500输入与20输出，不是实际供应商的用量计费证据。去除原始正文与身份信息的结果保存于同目录 [JSON记录](2026-11-01-assistant-runtime.json)；模型端日志为本地 /tmp/dt-assistant-context-sim.ndjson，未提交原始日志。

额外边界观测：以16384配置预算运行时，当前固定提示词和37个工具声明的预算估算已约14878。一次压缩后收到合成超限错误，进一步摘要没有降低输入，服务明确返回52203，未继续循环请求。不能依靠摘要解决固定前缀本身过大的窗口；部署预算必须适配模型和实际工具集。

仿真格式来自本仓适配器与已有协议用例，没有指定外部供应商，也没有复用供应商所有者 mock。未上传或部署任何 mock。入口 postman/tests/assistant_context_app.py 仅允许本地专用验收库与本地模型端点。

## 证据边界

- 最初只检查根环境，未发现启用的模型密钥；健康旧验收栈供应商列表为空。这些来源不足以判断运行中的助手是否有真实模型配置。随后发现 Docker 环境和运行容器中的真实配置，已按下节进行一次实际供应商请求。
- 主环境数据库的只读探测显示 TCP 可连接，但 PostgreSQL 协议握手超时；没有修改该数据库或网络配置。该环境仍需要恢复后再做业务环境验收；真实模型的独立请求结果见下节。
- 本地仿真通过只能证明调用方在这些协议响应下的行为，不证明任何真实供应商的窗口、费用、摘要质量或可用性。

## 复现入口

验收配置均为明确的本地合成值，位于 postman/tests/assistant-context.env.example。
只可用于新建的独立验收库，入口会拒绝其它数据库与远端模型地址。

1. 新建独立postgres:16-alpine容器，127.0.0.1:55439映射5432、tmpfs数据目录，数据库dt_ai_validation、账号dt_validation；Redis使用独立56389端口。禁止把此配置指向业务库。
2. 从仓库根导入合成配置，在助手目录运行Alembic到head。
3. 在独立终端启动Postman和真实应用，再运行验收脚本：

```sh
set -a
source postman/tests/assistant-context.env.example
set +a
postman simulation run postman/simulations/assistant-context.sim.yaml --port 4141 --no-history --output ndjson
```

```sh
set -a
source postman/tests/assistant-context.env.example
set +a
server/.venv/bin/uvicorn assistant_context_app:build_validation_app --factory --app-dir postman/tests --host 127.0.0.1 --port 18086
```

```sh
server/.venv/bin/python postman/tests/verify_assistant_context.py
```

验收脚本仅对新建的dt_ai_validation数据库写合成会话，逐场景通过API删除本次会话。
所有仿真、应用进程和本次独立容器均可在验收后关闭；不删除任何业务卷。

## 验收终态（terminal verified）

- 最终源文件、强类型解析及安全入口重新启动后，三个跨网络场景再次全部通过。
- 最终模拟端共收到8次真实模型HTTP请求，状态依次为200、200、200、400、200、200、200、200；其中400是显式注入的上下文超限。普通JSON、流式工具调用、SSE终止帧及usage均经真实适配器处理。
- 清理前专用数据库的会话数量为0。验收应用、Postman进程和本轮两个独立容器已关闭/删除；18086、4141、55439、56389四个本地端口均确认关闭。未删除业务卷、未修改既有服务。
- 显式检查新增Postman Python：Black、按server规范的Ruff、strict Pyright均通过；Pyright明确使用server虚拟环境，不能以默认CI扫描范围代替。
- 新Python模块均低于600行、函数不超过50行、形参不超过5个；最大函数为验收脚本48行、安全入口11行、新DB集成测试46行。
- 新增Markdown、JSON、YAML、JavaScript的Prettier检查通过，mock JavaScript的Node语法检查通过。Python规模、命名、配置密钥闸及git diff空白检查通过。

## 前端与合成业务写链证据

四分辨率页面 / 弹窗、完整助手状态、真实平台只读浏览，以及项目和静态大屏
创建 / 保存 / 重开 / 精确清理的证据，见
[前端可视化与交互验收](2026-11-01-frontend-layout.md)。该报告明确区分模拟 API、
真实只读和专用合成资源写入，不将旧验收栈当作本次新助手后端已部署的证明。

## 真实供应商独立探测（后续新证据）

只读检查发现 docker/.env 和正在运行的 digitaltwin-ai-assistant-1 均启用了真实模型；两者的端点、模型、密钥、摘要档及额外参数配置一致。**存在配置不代表可调用**，此前仅从根环境得出的“未发现真实配置”结论已更正。

使用当前源码的 OpenAiCompatAdapter 读取运行配置到进程内存，调用配置的对话模型一次：要求只回复固定短句，最多64输出token，端点超时25秒、总超时30秒，适配器不自动重试。不访问平台目录或业务数据库，不改变运行中的容器、环境和业务数据。

实际HTTP结果为 **403**，机器type与code均为 **AccessDenied.Unpurchased**，适配器异常为 OpenAIPermissionDeniedError。没有得到有效回复，也没有供应商usage；不据此推断账单。为避免重复无效调用，没有对这个永久拒绝盲目重试，也没有启动真实模型的摘要与压缩场景。

最初一次本地读取容器环境时发现存在无等号条目，解析失败发生在发HTTP之前；过滤这些条目后才发出了上述唯一一次真实请求。测试没有输出或保存实际端点地址、密钥、令牌及原始请求头。安全结果保存于 [真实供应商探测记录](2026-11-01-assistant-runtime-provider.json)。

本地三个跨网络仿真场景仍全部通过；实际模型调用、真实摘要质量和真实模型上下文压缩尚未通过验收。下一步需要解决该供应商403开通/访问限制，或提供另一份明确可调用的模型配置后再验证。

### 有界只读模型目录审计

随后仅追加一次只读模型目录GET，返回一页21个模型。当前已配置的chat、vision、summary都在目录中，但三者实际指向同一个模型，vision也使用同一端点；Docker文件与运行容器没有不同的模型/密钥/端点候选。因此没有再次发送chat、没有尝试未配置模型，也没有开通或购买产品。

目录列出模型不代表当前账号拥有该模型的调用授权；上述唯一一次实际chat的403仍是有效结果。审计只记录计数和相同/包含布尔，不包含完整模型列表、账号、端点或凭据。相关计数和包含关系已在本节列明。

目录审计原始 JSON 最初仅保留在本机快照，未纳入原优化发布；后续按 [Issue #371](https://github.com/timestone-org/digital-twin/issues/371) 的工作区集中交付指令，作为[历史诊断材料](2026-11-01-assistant-provider-models-audit.json)归档。该文件不构成后续模型调用授权或自动压缩验收的证据。

当前结论：真实供应商授权尚未通过，实际自动压缩与摘要质量验收仍被该403阻塞；主环境数据库协议握手也仍未恢复。本地仿真和隔离数据库测试的通过结果保持原有证据边界。
