# 报告模板与自动生成

报告是数据台账的表达层：模板 + 报告期生成一份可下载的 Word 文档。
参考实现位于 DigitalTwinBK 的 `apps/report`；本项目的架构、接口和工程规范优先。

## 边界

- 业务归 `platform_server/apps/report`，数据归 `platform` schema。
- 台账取数只经 `dataset.services` 公开面，使用人工修正与计算之后的生效值。
- API 负责模板、指标、定时规则及生成请求；CPU 密集的文档导入与生成由 worker 执行。
- Word 只有服务端一种生成路径；编辑器试算展示数据，下载交付真实生成产物。
- 对象存储复用 `lib.objectstore`，不复制旧项目的存储、认证或后台任务基础设施。

## 功能契约

模板保留 ProseMirror 文档结构、指标表与页面设置。业务节点包括行内数字
`metricRef`、条件文本 `condText`、块级图表 `dsChart` 与台账表格 `dsTable`。
支持 Word 导入、纯文本与表格版式、折线和柱状图、页面尺寸、页边距、页眉页脚、
分页、水印及目录。导入或渲染无法保留的内容必须列出警告，不允许静默丢弃。

报告期支持日、月、季、年，按显式业务时区切半开区间 `[start, end)`。
指标支持期内聚合、最新值、指定期偏移和指标表达式；表达式复用台账公式引擎。
取数必须有行数上限，触顶在试算与产物生成记录中明确标识。
精确数值以字符串传输，时刻以 UTC RFC3339 传输，响应回显业务时区。

## 持久化与执行

模板、定时规则、生成记录和审计分别持久化。模板修改必须携带预期版本，
冲突返回 409；生成记录保存模板快照，后续编辑不能改变已经提交的任务。
定时规则同一报告期依赖数据库唯一约束去重。创建与生成接口支持调用者范围的
`Idempotency-Key`；数据库提交成功后才能投递带 `traceparent` 的队列消息。
worker 对重复消息幂等，超时与进程中断必须收敛为可见失败，不能永久停在生成中。
定时总开关默认关闭，手动生成不依赖该开关；页面显示真实有效配置。

## 接口与权限

资源前缀为 `/api/v1/platform/report-templates`、`report-renders`、
`report-schedules`。校验、试算、生成和导入采用 `POST …:verb`。
生成提交返回 202，模板创建返回 201 + Location，删除返回无正文 204。
模板与规则列表使用页码分页，生成记录使用游标分页。

读面 `report:view`；模板和试算 `report:manage`；生成及下载 `report:render`；
定时规则 `report:schedule`。下载不能被 GET 读权限兜底放行。
后端鉴权规则、服务端权限判断和前端门禁必须逐字对齐。

## 验收

1. 创建模板、插入本期与上期指标、条件文本、图表及表格，试算可核对。
2. 保存后重新打开，正文、数据引用和页面设置保持一致。
3. 生成并下载 Word；中文、数字、表格、图表与报告期正确。
4. 导入 Word 能继续编辑，不支持的内容有明确清单。
5. 定时到期生成，同期重复触发不重复出稿；开关关闭不触发。
6. 权限不足、空数据、截断、并发编辑、重复提交、存储失败和 worker 中断有测试。
7. 本地静态闸、契约、真实数据库集成、前端交互与构建通过，并检查实际 Word 产物。

## 当前实现与启用

页面入口为 `/reports`，包含模板列表、结构化正文编辑、生成记录及定时规则。
正文编辑使用与参考实现一致的 Umo Editor，并通过其 Tiptap 扩展面保留四类业务节点；
编辑器的导出入口关闭，手动和定时生成共用 worker 的同一条生成管线。Umo 的公式、
图表等外部资源随前端构建并走同源路径，不依赖公网 CDN。新建模板之后，添加指标、
插入指标数字或条件文本、图表和表格，
保存后选择报告期即可生成。页面设置支持纸张、方向、厘米边距、字号、页眉页脚、水印和目录。

模板编辑器登记为 AI 助手的 `report-editor` 工作面。助手可读取当前未保存草稿，
辅助增改指标、插入文本与四类业务节点、调整页面设置，并调用同一套模板校验和
试算接口核对结果。助手的写操作只修改浏览器里的草稿，不调用保存或生成端点；
用户审阅后仍需手动保存，避免模型把未确认内容直接持久化。

部署沿用 `docker/README.md` 的流程：

1. 安装更新后的锁文件依赖，重建 platform、auth 与前端镜像。
2. 先执行 platform 的 `alembic upgrade head`，新增四张 `report_*` 表。
3. 执行 auth 的 `python -m scripts.seed`，登记四个报告权限码与对应路由规则。
4. 更新 platform 的 API 与 worker、auth 和边缘前端进程。
5. 需要周期自动生成时，设置根环境变量 `PLATFORM_REPORT_SCHEDULE_ENABLED=true`，
   再更新 API 与 worker；界面会显示真实开关。关闭开关不影响手动生成。

不能只更新 API：Word 的生成与导入实际运行于 worker。位图后备路径依赖
`fonts-noto-cjk`，它已纳入 platform 镜像，修改后必须重建镜像。
新增迁移是纯扩展；代码回滚时保留这些表，不在部署回滚中删除报告数据。

## 数据口径与边界

- 一次试算总共读取最多 50,000 行，单窗口最多 20,000 行；展示值也有整体预算。
  截断和预算耗尽会显式显示。HTTP 试算限制 20 秒，worker 任务限制 300 秒。
- 生成队列以 100 个在途任务为背压水位；定时规则暂缓，手动提交收到 429。
- 数字保留 `value_kind`，避免小数字符串在条件表达式里变成文本排序。
  聚合使用 Decimal；派生表达式继承当前台账公式引擎的数值语义。
- `anchor=latest` 如使用早于报告期的数据，会返回 `is_stale` 与明显提示。
- 定时规则从最近完整一期开始；中断之后每拍补一期，水位只向前推进。
- 模板已有生成历史或规则时不能删除，应停用以保留历史；规则同理。
- 只读权限只能看生成状态，完整试算快照要求生成或管理权限；未保存的 Word
  导入内容仅上传者在具有管理权限时可读。
- Word 导入保留段落、基础文本标记、表格顺序及第一节页面设置；图片和图表、
  批注脚注、多节及合并单元格等存在转换损失，导入界面展示丢失清单。
  原生 Word 图表与浏览器 ECharts 的外观并非逐像素相同。

## 类型与验证命令

在 `server/services/platform-server` 执行 `python -m scripts.export_openapi`，
随后从仓库根执行 `python server/services/platform-server/scripts/export_report_types.py`。
生成器需要工作区的 pnpm；CI 会重新生成并检查报告类型没有漂移。

针对本模块的测试包括 `tests/unit/report/`、`tests/integration/test_report_api.py`
和 `tests/integration/test_report_runtime.py`，前端为 `app/tests/pages/Reports/`、
`app/tests/api/reports.test.ts` 与 `app/tests/contract/report-shapes.contract.spec.ts`。
集成测试使用独立的真实 PostgreSQL 测试库；覆盖率必须读取本服务 pyproject 中的
`thread,greenlet` 配置，否则 SQLAlchemy 异步路径会漏记覆盖。
