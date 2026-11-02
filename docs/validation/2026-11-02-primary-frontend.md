# 主环境前端只读补验（2026-11-02）

> 快照边界：本记录来自原工作区，其中同时存在其它任务的未提交改动。原有大屏传输选项、流水线复制与错误提示改动未纳入本系列提交。干净抽取版已另做自动化与视觉验证，发布范围及日志见 [隔离交付记录](2026-11-02-isolated-release.md) 和 [议题 #362](https://github.com/timestone-org/digital-twin/issues/362)。后续新增的边界修复以隔离分支及正式 CI 为准，不把本记录的旧源码哈希冒充最终版本。

本次保留 [11 月 1 日验收](2026-11-01-frontend-layout.md) 的历史结论与证据，
仅针对恢复后的主环境追加检查；没有重新运行旧 750 个 case，没有修改已有业务资源、
容器配置或部署，也没有在主环境发起模型调用；末节另记隔离环境的一次真实模型浏览器验收。

## 证据完整性与当前运行入口

- 旧证据仍为 **750 个 case、746 张独立 PNG**，全部存在；四尺寸登录图被两个分类复用。
- 当前覆盖清单仍对应 57 条路由地址、90 个弹窗源文件及 93 处声明。
- 本次对 746 张旧图以及 1,343 个前端入口、UI 与契约源文件记录 SHA-256，补验前后均无变化。
  11 月 1 日没有记录完整源码哈希基线，因此不把上述检查说成跨日期逐字节冻结证明。
- 当前 Git HEAD 为 `e8760510d4c044dd07a9513553139c951625358b`，保留工作区既有未提交改动。
- 最初通过进程、监听端口及 HTTP 三项核对，5173 / 5174 均已停止；随后只启动当前工作区
  Vite 的 5173，代理到 `http://127.0.0.1:8080`。未重启或修改旧验收栈。

[当前完整性清单](../../logs/visual-validation-20261102/integrity-manifest.json) /
[补验前后比对](../../logs/visual-validation-20261102/integrity-check.json)。

## 真实服务与页面检查

使用既有 `database-migrate` 容器中的同一组 seed 配置登录，首次返回 201；
没有猜测或切换其它凭据。定向补验另取一张临时短票，仍返回 201。
凭据和令牌只在脚本 / 临时浏览器内存中，没有保存 storage-state 或秘密值。

| 检查对象                           | 实际结果            |
| ---------------------------------- | ------------------- |
| auth / platform readiness          | 200                 |
| assistant / knowledge capabilities | 200                 |
| OPC UA readiness                   | 200                 |
| 层级图鉴权后 capabilities          | 502，可选服务未部署 |

实际只读打开 15 条关键静态路由，随后从真实目录读取已有资源，检查：

- 含 3D 内容的大屏编辑器，四分辨率。
- 台账列配置、数据与趋势三个子路由。
- 建模流水线画布，模型实例详情及已有报告模板详情；画布 / 报告补拍四分辨率。
- HTTP 数据源、新建流水线、新建定时规则与新建用户四种长表单，四分辨率；仅打开、查看和关闭。

首轮 **47 个截图 case** 均无页面脚本异常、弹窗 / 文档横向越界或顶层弹窗操作按钮遮挡。
没有提交表单、保存配置、训练模型、下发设备值或其它业务数据写入。

## 保留的异常与定向核验

本轮不能表述为所有 HTTP 请求全绿：

1. 层级图能力探测共 26 次 502，页面仍正常渲染不可用状态。
2. 打开新建流水线时，一次 `GET /api/v1/platform/modeling-pipelines` 返回 500。
   原始浏览器记录只有路径 / 状态 / case，未捕获该次响应的 trace 或正文，原记录保留。
3. Root 在边缘直接找到匹配证据：`2026-11-02T01:13:35Z` 的该 GET 返回 500，
   同连接 `55938` 出现 `/_auth` 子请求到认证服务的 `/internal/v1/verify` 超时，
   随后为 `auth request unexpected status: 504`。请求在边缘鉴权阶段失败，
   不能归因于平台流水线 handler。
4. 仅重复一次当前 UI 构造的同一路径与查询：
   `/api/v1/platform/modeling-pipelines?page=1&size=200&include_instances=false`，
   返回 200、code 0、`ok`、12 项；trace 为 `aa38044721494101a07833648f5c3412`。
   这说明定向复核成功，不抹去首次超时。

曾误把邻近平台日志 `6507d8df215e313fa685362c27de1faf` 关联到上述 500，已明确更正。
Root 核对后确认该日志属于内部采集计划的 `collect_points` SELECT 超时，
不作为流水线 GET 的 trace 或根因。权威更正及边缘证据见
[定向核验记录](../../logs/visual-validation-20261102/targeted-checks.json)。

首轮严格拦截所有非 GET，阻止了画布自动发出的两次 `:validate`。
核对实现为只读图校验后，仅放行这一条明确端点，其它业务写继续拦截：
当前前端实际发出两次 POST，均返回 200、code 0、`is_valid=true`；没有保存或运行。
该定向画布补拍四档，新增 **4 个 case**。首轮拦截记录仍保留，未伪造成接口失败。

控制台另有四条软件 WebGL `ReadPixels` 性能警告，以及报告编辑器三条 Vue
`textContent` 警告。后者脱敏组件栈为 `TButton → TDialogCard → SearchReplace → UmoEditor`；
现有 HEAD 的 `ReportEditor.runtime.spec.ts` 已列入 `EXPECTED_WARNINGS`，
独立最小 Umo 11.1.1 挂载也能复现，没有本轮新增回归的证据。
未通过修改源码、依赖或屏蔽 warning 来制造干净控制台。

## 可复查材料

本次共 **51 个新 case、51 张独立 PNG**，与旧 750 case 分开保存：

- [本次截图索引](../../logs/visual-validation-20261102/index.html)
- [汇总数字](../../logs/visual-validation-20261102/summary.json)
- [首轮真实页面 / 弹窗 / 控制台 / API 失败](../../logs/visual-validation-20261102/primary-smoke-results.json)
- [单次 GET 复核、只读校验、脱敏 Vue 栈](../../logs/visual-validation-20261102/targeted-checks.json)
- [720p 真实大屏编辑器](../../logs/visual-validation-20261102/screenshots/720p/--dashboards--01a07acf-1ad2-7113-9cf2-7619066db5e0--edit.png)
- [720p 真实 HTTP 长表单](../../logs/visual-validation-20261102/screenshots/720p/modal---collect--http.png)
- [720p 校验成功的真实流水线画布](../../logs/visual-validation-20261102/targeted/720p/pipeline-readonly-validated.png)

浏览器脚本没有注入 API 样例。本报告证明当前前端在上述真实数据和请求范围内的渲染、
只读交互与布局；不能据此承诺所有业务写操作、真实供应商、设备链路或服务端恢复稳定性。
本次未修改产品代码、业务数据或部署，未覆盖 11 月 1 日的旧证据。

## 追加：身份夹具下的直接真实模型浏览器闭环

在独立当前源码 FastAPI / PostgreSQL / Redis 中，仅发送一次空历史短消息，
使用当前目录快照登记的真实 Codex OAuth 模型。浏览器挂载真实 `AiAssistantPanel`、
`useAiConversation`、`advanceTurn` 与生产 API 客户端；没有替换这些模块或响应解析器。

身份为明确的合成测试身份：本地流式反代在服务端注入测试 MAC，浏览器不接触签名密钥，
没有接管主环境网关。SSE 不缓冲；原始 Response 直接交给生产解析路径，旁路 clone
仅独立记录真实 `context` 帧作为核对依据，没有 `route.fulfill` 或整段假 SSE。
本轮配置预算 32,768 token、最多一次真实模型 HTTP 请求、最多输出 64 token、low 档、禁止工具执行。

**15 项浏览器断言全部通过**：MutationObserver 在点击发送前安装，发送后 106.6ms
第一次显示约 22%，此时 `chat.isRunning=true`、停止按钮可见、真实响应尚未 EOF；
该百分比比流结束早 4,190.8ms 出现。

| 观测                   |         首帧 |       最终帧 |
| ---------------------- | -----------: | -----------: |
| used_tokens / 配置预算 | 7280 / 32768 | 4754 / 32768 |
| API percent            |        22.2% |        14.5% |
| is_estimated           |         true |        false |
| 反代观察时上游流仍打开 |         true |         true |

真实模型报告输入 4,748、输出 6、合计 4,754 token，回复为“你好。”。
最终可见标签按既有规则取整为 15%，ARIA 值为 14.5，token 辅助说明与最后真实帧一致。
SSE 次序为 `context → delta → delta → context → step → turn.done`；没有脚本或控制台错误。
最终真实 Panel 在四种分辨率均未越界，补拍 **4 张 PNG**。

准备页预检曾在发送前因步骤字段层级、Vite 缓存的自动化定位问题中止，模型请求仍为零。
修正后复用首个空会话完成唯一发送，没有重试真实模型调用。两个专用合成会话已逐个
API 删除返回 204，清理前独立库会话数为零。仅本轮隔离 API、反代和标签容器已关闭；
5174 已停止、临时 ignored cache 页已删除，主环境 5173 保留，未改产品代码或主环境业务资源。

- [浏览器真实帧、MutationObserver 与 15 项断言](../../logs/visual-validation-20261102/real-model-ui/browser-e2e-result.json)
- [精简时序与匹配结果](../../logs/visual-validation-20261102/real-model-ui/summary.json)
- [后端真实 usage、流式帧与清理记录](2026-11-02-assistant-browser-runtime.json)
- [720p 完成后的真实 Panel](../../logs/visual-validation-20261102/real-model-ui/panel-final-720p.png)
- [4K 完成后的真实 Panel](../../logs/visual-validation-20261102/real-model-ui/panel-final-4k.png)
- [当前源码模块哈希](../../logs/visual-validation-20261102/real-model-ui/source-hashes.json)

本报告追加索引现为 **55 个 case、55 张独立 PNG**：主环境只读 51、隔离真实模型 4。
这次空历史调用证明浏览器实时百分比显示与真实模型 usage 闭环，不单独证明自动压缩；
真实模型自动压缩的三调用证据见
[11 月 2 日真实模型运行时验收](2026-11-02-assistant-real-runtime.md)。
