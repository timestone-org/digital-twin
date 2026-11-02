# AI 助手真实模型运行时验收（2026-11-02）

> 快照边界：本记录来自原工作区，其中同时存在其它任务的未提交改动。原有大屏传输选项、流水线复制与错误提示改动未纳入本系列提交。干净抽取版已另做自动化与视觉验证，发布范围及日志见 [隔离交付记录](2026-11-02-isolated-release.md) 和 [议题 #362](https://github.com/timestone-org/digital-twin/issues/362)。后续新增的边界修复以隔离分支及正式 CI 为准，不把本记录的旧源码哈希冒充最终版本。

**当前源码的真实模型自动压缩验收通过。** 主环境恢复后重新读取了实际目录；当前助手使用目录中的订阅模型，并不是11月1日被403拒绝的环境变量模型。未部署、重建或修改既有业务容器及模型配置。

## 当前路径的只读确认

- 按原有服务级内部接口读取primary模型目录，HTTP 200；4个启用供应商：3个OpenAI兼容来源、1个订阅来源。这里只记录数量和形态，不记录端点、密钥、账号或供应商行标识。
- 助手chat/vision/summary的分配指向订阅供应商，但分配中的3个模型名称未出现在该供应商当前登记清单中。当前model_for按既有规则回落到该供应商已登记的适用chat模型，本轮未修改这些配置。
- 通过原有平台凭据租借面取得短期令牌，HTTP 200。当前ModelRegistry选中了分配的订阅供应商，不使用ENV路径。
- 一次最小真实请求成功返回非空正文：输入37、输出7、合计44 token；无自动重试，输出上限64、总超时30秒。最小探针当时只对字符串content做整串比较，尚不处理结构化content，因此不把该比较结果作为语义失败；完整事实语义由后续场景验证。

记录：[目录审计](2026-11-02-assistant-catalog-audit.json)、[最小实际路径调用](2026-11-02-assistant-actual-probe.json)。

## 真实验收发现并修复的缺陷

第一次完整真实运行中，两次摘要模型请求都成功，但摘要未落库、压缩次数为0。原因是共享ModelSummarizer只接受字符串content，订阅模型的结构化可见text块被当作空内容丢弃。

先增加结构化text与reasoning混合响应的回归用例，修复前明确失败（got为None）。修复复用llmcore.deltas.text_of，只提取字符串或type=text正文，排除reasoning、refusal等其它块；同时覆盖字符串、空串、空列表、空text、reasoning-only和refusal-only。没有改变模型fixture绕过问题。

修前失败结果保留为[对照记录](2026-11-02-assistant-real-runtime-before-fix.json)，注明其来源为首次命令捕获输出。最终结果和源文件SHA-256在[修后记录](2026-11-02-assistant-real-runtime.json)，共享摘要模块hash为5cef0263da655adad2c4d142cabeb4bd2015b375cec33df98acacc30fdf61823。

## 修后真实模型场景

修前Uvicorn正常停止，修后源码另起新进程，验收进程PID92194。应用使用真实FastAPI socket HTTP、PostgreSQL、Redis和当前CodexOAuthAdapter，没有模型mock或Responder替身。

为保证调用一致和有界，从primary读取当前目录快照后在验收进程内固定；令牌仍经平台原有租借面取得。只创建独立本地dt_ai_validation数据库与tmpfs容器；输入全为合成数据。模型使用low档，每次最多256输出token，整个场景最多3次模型请求，禁止工具执行，不访问真实业务资源。

配置的验收预算人为收紧为11000 token以触发压缩；它不是对供应商真实最大窗口的测量。合成事实为点位T001、温度26.5摄氏度、只读且禁止修改用户数据/下发写值。

| 检查                       | 修前                 | 修后                                  |
| -------------------------- | -------------------- | ------------------------------------- |
| 持久摘要有效切点           | 无                   | 有                                    |
| 摘要含T001、26.5与只读约束 | 否                   | 全部保留                              |
| SSE压缩状态                | compressing后回ready | compressing → compressed → ready      |
| compression_count          | 0                    | 1                                     |
| HTTP历史                   | 6条完整              | 6条完整                               |
| 最终事实JSON               | 正确                 | 正确                                  |
| 最后一次chat输入/输出token | 9777 / 28            | 4367 / 28                             |
| 最终context                | 9805 token，89.1%    | 4395 token，40.0%，is_estimated=false |

修后实际3次调用为：

| 用途           | 输入 | 输出 | 合计 |
| -------------- | ---: | ---: | ---: |
| 持久摘要       | 2082 |   98 | 2180 |
| 回合内压缩摘要 | 1121 |  106 | 1227 |
| 最终答复       | 4367 |   28 | 4395 |

最终合成事实JSON为point_code=T001、temperature_c=26.5、read_only=true、can_write=false。上述数字是这一次真实运行的供应商usage，不是普遍性能承诺，也不推断账单。

## 本地回归与证据边界

- llmcore摘要、文本块提取、订阅流及契约定向检查：96项通过。
- knowledge-server摘要消费、上下文预算、模型适配与标题定向检查：67项通过。
- 共享修改的Black、Ruff及strict Pyright通过；修复只改变可见摘要正文提取。
- 助手数据库集成与摘要/压缩相关单元检查：正确fixture环境下139项通过（包括全部96项数据库集成）。

两处准备错误均没有执行业务写入：一次迁移命令的相对配置路径未加载，默认连接鉴权失败，未进入迁移SQL；随后改为绝对路径、set -e和独立host/port/db/user四项断言后才迁移。一次回归误继承仿真环境的MODEL_ENABLED=true，导致两条“模型关闭”能力测试失败；与正文提取修复无关，已改用模型关闭的正确fixture环境执行。

本轮未修改主环境业务配置、没有开通或购买产品、没有扫描未配置模型，也没有输出/保存实际模型端点、令牌、密钥或原始headers。11月1日ENV路径403证据保留，但它不能代表本轮恢复后的实际目录路径。当前报告证明独立环境中当前源码的真实模型场景；不等同于既有生产容器已经加载新源码。

## 验收终态（terminal verified）

- 真实修后场景通过，源文件SHA-256、独立新进程PID92194、实际usage、摘要事实检查与压缩计数已记录；未使用旧进程缓存证明修后行为。
- 全部139项助手相关回归、96项共享模块与契约定向检查、67项知识库定向检查通过。Black、Ruff、strict Pyright与diff空白检查通过；新增报告与JSON按项目Prettier格式化。
- 清理前独立测试库会话count为0。本轮Uvicorn及标签为ai-real-context-validation-20261102的两个临时容器已关闭/删除，18086、55439、56389均确认关闭。没有删除业务卷或其它任务的容器。
- 原始端点、密钥、令牌、账号与请求headers只在受控进程内存使用，没有写入工作区、报告、控制台或原始HTTP日志。保存的模型答复仅是通过固定schema验证的合成事实JSON，摘要保存事实检查布尔而非完整原文。
- 本轮没有部署既有业务容器，主环境模型配置及分配保持原状。11月1日ENV403仍是历史事实，但不再构成当前实际助手路径的可用性阻塞。

## 真实浏览器的发送中百分比（追加直接E2E）

在上述真实压缩CLI/API场景之外，又将真实AiAssistantPanel、useAiConversation与生产advanceTurn/openStream连接到当前源码的独立FastAPI、PostgreSQL、Redis及实际目录模型。没有route.fulfill、伪造SSE或模型替身。

身份是明确的合成验收身份：仅本地流式反代在服务端注入测试MAC，浏览器不接触签名密钥；只开放隔离助手路径，不接管或修改primary网关。初始会话历史为空，只发送一次短句，模型硬限制64输出token、low档、禁止工具执行，反代总窗口30秒，SSE不buffer。

结果：**15项浏览器断言全部通过**。MutationObserver在发送前安装；首个百分比于发送后106.6毫秒出现，此时Stop可见、chat仍running、真实响应流尚未EOF，比流结束早4190.8毫秒。原始Response交给生产解析路径，旁路clone仅作为独立真实帧核对。

| 观测                     |       估算帧 | 最终真实usage帧 |
| ------------------------ | -----------: | --------------: |
| API代理观察时刻          |      97.82ms |       4259.87ms |
| used_tokens / max_tokens | 7280 / 32768 |    4754 / 32768 |
| percent                  |        22.2% |           14.5% |
| is_estimated             |         true |           false |
| 观察时上游流仍open       |         true |            true |

本轮唯一真实chat的usage为输入4748、输出6、合计4754 token；浏览器最终标签、ARIA百分比和token数均与最后一帧一致。无脚本或console错误，四种分辨率的真实Panel截图均在边界内。此处是空历史的实时使用率验证，compression_count=0符合预期；真实压缩本身由前节三调用场景证明。

证据：[后端真实帧、usage及清理JSON](2026-11-02-assistant-browser-runtime.json)、[前端验收报告](2026-11-02-primary-frontend.md)。原始浏览器断言与截图在本地logs/visual-validation-20261102/real-model-ui/，不包含实际凭据或headers。

本轮两个合成会话逐个通过API删除并返回204，清理前独立库会话为0。仅本轮本地proxy、当前源码API与标签为ai-browser-context-validation-20261102的两个tmpfs容器被关闭/删除，18086、18087、55439、56389均确认关闭；没有修改业务主体源码或既有服务。
