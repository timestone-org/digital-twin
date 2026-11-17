# 绿色生产评价系统：报告迁移兼容性调研

调研日期：2026-11-17。范围为当前仓库的报告实现、本次旧系统只读迁移快照，以及
主代理写入的本次迁移验证产物。下文区分转换依据与已观察到的执行结果。

## 已验证的真实旧模板

本机快照为 `~/Downloads/fuyang-green-migration-2026-11-17/source-data.json`。
其中有 1 个模板「卷烟工厂绿色生产指数分析报告」、1 份成功的 2026-08 Word 生成记录，
没有定时规则。模板有 24 个指标（17 个 `window_agg`、7 个 `expr`），正文包含
22 个 `metricRef`、8 个 `condText`、8 个 `dsChart`、7 个 `dsTable`；8 个图表共有
13 条系列，旧 `axis` 全部为 `left`。旧大屏的 `report-view` 节点通过
`config_json.template` 保存模板 UUID，并位于弹窗容器内。以上为对迁移快照的读取结果。

用当前 `TemplateBody.model_validate` 实测，原样输入唯一的类型阻断是
`page_json.show_toc`：当前页面字段为 `is_toc_enabled`，且输入禁止多余字段。
另有一项不会触发类型错误的语义适配：图表系列 `label` 必须改成 `name`，
否则当前系列模型会忽略旧 `label`，丢失「综合指数 γ」等自定义图例。
做完这两处转换后，实际模板通过 `TemplateBody.model_validate` 与
`validate_template`，结果为 `is_valid=true, issues=[]`。
依据：[页面与文档模型](../../server/services/platform-server/src/platform_server/apps/report/schemas/document.py#L21)、
[输入边界](../../server/services/platform-server/src/platform_server/apps/report/schemas/common.py#L33)、
[系列模型](../../server/services/platform-server/src/platform_server/apps/report/schemas/nodes.py#L10)、
[模板校验器](../../server/services/platform-server/src/platform_server/apps/report/services/document.py#L102)。

实际转换应保留其他正文属性、标记和表达式，封装为：

```python
body = {
    "name": old["name"],
    "description": old["description"],
    "granularity": old["granularity"],
    "is_enabled": old["enabled"],
    "doc_json": converted_document,
    "metrics": old["metrics_json"],
    "page_json": {"is_toc_enabled": old["page_json"]["show_toc"]},
    "api_sources": [],
}
```

这里的页面映射针对快照中实际只有 `show_toc` 的页面对象；通用迁移器应逐字段映射
已有页边距、字体、页眉页脚等设置，不能用这个最小对象覆盖别的旧模板页面。
`SeriesSpec` 当前没有双轴设置；本模板全部为左轴，因此移除旧 `axis=left` 不改变
实际取值轴。当前字段名与范围见
[PageSettings](../../server/services/platform-server/src/platform_server/apps/report/schemas/document.py#L80)、
[DataNodeSpec](../../server/services/platform-server/src/platform_server/apps/report/schemas/nodes.py#L20)。

源台账时间范围换算北京时间为 2022-01 至 2023-12；报告期 2026-08 是旧历史记录的
真实元数据，不代表存在 2026 年业务数据。模板使用 `anchor=latest, window=12mo`。
当前实现会在期末之前找最新有效数据，明确产生陈旧标记和警告，不能为消除警告而
改写源时间或补造新年度数据。依据：
[latest 口径](../../server/services/platform-server/src/platform_server/apps/report/services/metrics.py#L88)、
[日历与最新值窗口](../../server/services/platform-server/src/platform_server/apps/report/services/period.py#L67)、
[陈旧提示](../../server/services/platform-server/src/platform_server/apps/report/services/preview.py#L89)。

真实数据迁移产物 `data-migration-verification.json` 记录：7 张台账、224 列（189 列公式、
35 列人工值）、168 行历史记录已逐值核对，报告模板和历史报告各 1 份，定时规则为 0。
这些数量来自本次迁移文件，不是对数据库的另一次独立盘点。

## 持久化映射

当前报告属于 `platform` schema，模板、定时规则、生成记录、审计分表保存。
正文仍是 ProseMirror AST，四类业务节点名称保持一致。
依据：[平台上下文](../../server/services/platform-server/CONTEXT.md#L533)、
[实体](../../server/services/platform-server/src/platform_server/apps/report/models/entities.py#L31)、
[业务节点](../../server/services/platform-server/src/platform_server/apps/report/services/document.py#L20)。

| 旧数据 | 当前数据 | 迁移处理 |
| --- | --- | --- |
| `dt_rpt_templates.code/name/description/granularity/enabled` | `report_templates` 同名字段，启用字段改为 `is_enabled` | 保持编码及业务名称；没有旧版本号时从 `row_version=1` 开始 |
| 独立 `doc_json/metrics_json/page_json` | `report_templates.body_json` | 组装完整 `TemplateBody`，其中 `metrics_json → metrics`，补 `api_sources=[]`，保留结构化正文 |
| `dt_rpt_renders` | `report_renders` | 保留报告期、粒度、状态、时间、警告、错误、模板关联和 Word 原件；补当前必填字段 |
| `dt_rpt_schedules.enabled` | `report_schedules.is_enabled` | 若存在规则，保留粒度、延迟、水位和关联；本次源快照无规则，不应凭空新增 |

字段依据：[TemplateBody](../../server/services/platform-server/src/platform_server/apps/report/schemas/template.py#L26)、
[模板落库列](../../server/services/platform-server/src/platform_server/apps/report/services/template_service.py#L135)、
[ReportRender](../../server/services/platform-server/src/platform_server/apps/report/models/entities.py#L67)、
[ScheduleBody](../../server/services/platform-server/src/platform_server/apps/report/schemas/jobs.py#L63)。

历史生成记录新增必填项包括 `timezone`、`kind`、`snapshot_json`、`traceparent`、
`created_by`；`request_key/request_hash/result_json` 可以为空。没有原时区时应从旧部署
业务时区确认后明确写入，不能只凭数据库 UTC 时间猜测。旧表未保存不可变模板快照时，
可以为兼容构造迁移模板快照，但必须在迁移审计说明它是重建结果，不能宣称它是当年
原始快照。新任务提交时会冻结完整 `TemplateBody`。
依据：[必填列](../../server/services/platform-server/src/platform_server/apps/report/models/entities.py#L88)、
[新任务快照](../../server/services/platform-server/src/platform_server/apps/report/services/render_service.py#L99)。

本次旧生成记录确实没有模板快照。迁移程序已在 `report_audits` 记录
`snapshot_rebuilt_from_current_legacy_template=true`，明确说明当前兼容快照是重建的。
该操作见本机迁移脚本 `migrate-data.py`，不应把重建快照作为当年模板未变的证据。

不要把旧 `pending/running` 状态不加区分地导入为可执行工作：当前补偿器会发现
`pending`，worker 会将其原子认领并执行；旧任务缺少当前快照时可能自动失败或重复
外部取数。应先核对旧任务实际终态，确需重做时由新任务生成。
依据：[原子认领](../../server/services/platform-server/src/platform_server/apps/report/crud/renders.py#L66)、
[补偿扫描](../../server/services/platform-server/src/platform_server/apps/report/crud/renders.py#L133)、
[平台 ADR-0007](../../server/services/platform-server/docs/adr/0007-报告待投递记录兼作持久补偿队列.md)。

## 历史 Word 与重新生成

现有成功文件应按原字节复制到新对象存储，记录源键、新键、大小与 SHA-256，逐份下载
对比。历史下载只要求 `status=succeeded`、`kind=render` 和有效 `object_key`，不会重新
查询台账或生成文档；因此可以保留旧 `reports/<uuid>.docx` 键，也可记录新键映射。
新任务的规范键为 `reports/renders/<render_id>.docx`。
依据：[下载条件及文件名](../../server/services/platform-server/src/platform_server/apps/report/services/render_service.py#L292)、
[当前出稿对象键](../../server/services/platform-server/src/platform_server/apps/report/services/worker.py#L297)。

旧文件可以下载，不等于旧试算结果可以直接放入当前 `result_json`。
任务详情会把成功的 `result_json` 校验为当前 `PreviewOut`，后者要求 `period/timezone/
metrics/nodes/warnings/is_valid`。没有兼容的旧试算快照时，历史记录可将 `result_json`
保持为空，并另外保存旧记录原貌；原 Word 下载不受影响。
依据：[详情读取](../../server/services/platform-server/src/platform_server/apps/report/services/render_service.py#L224)、
[PreviewOut](../../server/services/platform-server/src/platform_server/apps/report/schemas/preview.py#L94)。

本次历史 Word 原件为 53,233 字节，包内没有 `word/media/` 图片，包含 8 份
`word/charts/chart*.xml` 原生 DrawingML 图表。迁移程序从原件的分类、系列名称与数值
缓存恢复了 8 个当前 `NodeValue`，组成可读取的历史 `PreviewOut`；这是恢复成品里的
生成时图表，不是用今天的试算替换旧报告数据。原 DOCX 正文字节仍保持不变，SHA-256
为 `825fa79070e7ff50abdfc4a51d4a8e0cf1a16a10dc7bbe83ecff0b501e2bfbaa`。
依据为本机 `original-green-report.docx` 的 ZIP 内容、本次 `migrate-data.py` 的缓存读取，
以及 `data-migration-verification.json` 的原件校验结果。

不要用 Word 导入功能代替历史原件保存。导入器会转换编辑器能表达的部分，并列出丢失
清单；图片或图表不会完整保留，多节只保留第一节。导入用于创建可编辑模板，不能
作为旧成品无损备份。依据：
[Word 导入](../../server/services/platform-server/src/platform_server/apps/report/services/docx_import.py#L71)。

新出稿只走 worker：它认领任务、校验快照、试算、调用独立 Word 进程，然后写对象与
终态。必要数据失败会拒绝出稿，陈旧或截断等警告则保留到产物提示；因此验收应分开
核对“成功的历史原件下载”和“迁移模板在新系统重新生成”。
依据：[worker 执行](../../server/services/platform-server/src/platform_server/apps/report/services/worker.py#L244)、
[必要数据检查](../../server/services/platform-server/src/platform_server/apps/report/services/worker.py#L403)、
[Word 提示](../../server/services/platform-server/src/platform_server/apps/report/services/docx_builder.py#L72)。

本次真实 2023-12 试算返回 `is_valid=false`，原因是 39 项陈旧提示；24 个指标均没有
`error`，45 个业务节点均未出现 `[数据不可用]`。这里不能仅凭试算的 `is_valid=false`
就断言禁止生成：`preview()` 把任意警告计入该标志，而当前 worker 的
`_require_complete()` 只阻止指标错误或节点数据不可用。
该模板已经成功生成新记录 `01a1e827-32d0-7e47-99c9-2a24ccdf6277`；生成快照包含
24 个指标、45 个业务节点和 8 个图表，并保留全部 39 项陈旧提示。
执行证据为本机 `current-report-preview.json` 和 `new-report-result.json`。
代码依据：[试算标志](../../server/services/platform-server/src/platform_server/apps/report/services/preview.py#L58)、
[worker 完整性条件](../../server/services/platform-server/src/platform_server/apps/report/services/worker.py#L403)。

## 台账与公式依赖

报告依赖稳定的台账 `code` 和列 `key`，取数会解析当前台账编码后读取生效值；有效值
采用人工修正、计算值与原始值的既有合并口径。因此必须迁移正文图表/表格、指标所引用
台账，并沿台账列公式的跨表依赖迁移前置表与相关公式；只迁报告模板会在试算时报缺源。
依据：[台账来源适配](../../server/services/platform-server/src/platform_server/apps/report/services/source.py#L42)、
[生效值扫描](../../server/services/platform-server/src/platform_server/apps/dataset/services/record_read.py#L168)、
[指标求值](../../server/services/platform-server/src/platform_server/apps/report/services/metrics.py#L178)。

报告表达式复用台账公式引擎，但只允许引用已定义报告指标；跨行、跨表、模型等取数
不能直接藏在报告表达式中，跨期应通过指标偏移配置。模板校验拒绝重复指标、未知引用
及依赖环。本模板结构校验通过不替代对实际迁移数据的试算与数值对照。
依据：[报告公式入口](../../server/services/platform-server/src/platform_server/apps/dataset/services/report_formula.py#L21)、
[依赖排序](../../server/services/platform-server/src/platform_server/apps/report/services/document.py#L81)。

## 大屏内报告入口的当前实现

本次已采用宿主注入：`report-view` 模块薄壳读取 `templateCode` 与刷新间隔，把展示
委托给应用壳注册的异步 `DashboardReportHost`。报告请求和权限留在 app，模块包没有
反向 import 应用 API；原有 `DashboardRuntimePorts` 仍只服务实时/历史/台账绑定。
依据：[模块薄壳](../../web/packages/modules/src/modules/report-view/Component.vue#L9)、
[宿主注入口](../../web/packages/modules/src/modules/report-view/host.ts#L1)、
[异步启动装配](../../web/app/src/bootstrap/dashboard.ts#L77)、
[包依赖约束](../agents/project-structure-typescript.md#L72)。

原节点的模板 UUID 应解析到迁移模板编码 `green_index_monthly`。宿主按该编码找到
模板，再分页查其生成记录，只选 `kind=render` 且 `status=succeeded` 的第一条；
排队、运行、失败及导入任务不会顶替上一份成功报告。“最新”沿用服务端生成记录创建
时间的排序。前端历史 API 现已支持模板 ID 与取消信号。
依据：[选择成功成品](../../web/app/src/features/reports/scripts/latestReport.ts#L10)、
[模板过滤与信号](../../web/app/src/api/reports.ts#L71)、
[后端排序](../../server/services/platform-server/src/platform_server/apps/report/crud/renders.py#L34)。

宿主显示下载得到的原 DOCX，并从该生成记录的 `detail.preview.nodes` 展示生成时图表；
不会为旧报告发起今天的模板试算。相同生成记录的原件只下载一次，切换模板时取消在飞
请求并清空旧内容，卸载时取消请求、清理刷新定时器。
依据：[成品与图表展示](../../web/app/src/features/reports/DashboardReportHost.vue#L28)、
[刷新及竞态处理](../../web/app/src/features/reports/scripts/useLatestReport.ts#L25)。

共享展示件现已放在正确作用域，后续引用使用这些路径：

- `features/reports/components/ReportChart.vue` 使用
  `features/reports/scripts/reportChartTheme.ts`，同一组件负责报告图表的渲染与卸载释放。
  依据：[共享图表](../../web/app/src/features/reports/components/ReportChart.vue#L7)、
  [共享图表语义](../../web/app/src/features/reports/scripts/reportChartTheme.ts#L42)。
- `components/documents/DocumentPreviewDocx.vue` 只预览原件 Blob，使用独立渲染容器、
  竞态防护与卸载取消；图表快照由报告宿主单独呈现，不能把 DOCX 预览当作原生图表
  已自动还原的证据。
  依据：[共享 Word 预览](../../web/app/src/components/documents/DocumentPreviewDocx.vue#L16)、
  [宿主生成时图表区域](../../web/app/src/features/reports/DashboardReportHost.vue#L83)。
- 模板编辑页继续通过既有 `previewReport/generateReport` 操作试算和手动生成，
  与大屏的“最新成功成品”展示分开。编辑器正文试算仍按节点路径与属性指纹匹配。
  依据：[报告 API](../../web/app/src/api/reports.ts#L56)、
  [预览指纹](../../web/app/src/pages/Reports/Editor/scripts/documentPreview.ts#L64)。

报告 REST 接口仍需各自权限：模板读 `report:view`，试算 `report:manage`，生成及下载
`report:render`。当前宿主显式检查 `route.meta.public`，匿名路由强制不读取报告，
并显示权限说明；公开大屏票据没有变成报告凭据。
依据：[模板权限](../../server/services/platform-server/src/platform_server/apps/report/api/templates.py#L34)、
[生成与下载权限](../../server/services/platform-server/src/platform_server/apps/report/api/renders.py#L33)、
[匿名路由禁读](../../web/app/src/features/reports/DashboardReportHost.vue#L17)、
[ADR-0014](../adr/0014-公开大屏是平台唯一的匿名可达面.md#L8)。

## 定时语义与本次选择

当前定时规则保留 `granularity/delay_hours/is_enabled/last_run_period`，新任务以
`(schedule_id,period)` 唯一防重。第一次从最近完整一期开始，已有水位每拍最多前进
一期，不能把迁移时刻写成水位，否则可能跳过待补期；也不能清空旧水位而重新触发旧期。
源有生成历史时，应保留规则身份或维护映射关系。
依据：[实体约束](../../server/services/platform-server/src/platform_server/apps/report/models/entities.py#L47)、
[到期与水位计算](../../server/services/platform-server/src/platform_server/apps/report/services/scheduler.py#L36)、
[规则生成及写回](../../server/services/platform-server/src/platform_server/apps/report/services/scheduler.py#L136)。

本次源快照没有规则，所以应迁移现有模板与历史文件，并验证手动生成，不应擅自开启
自动出稿。全局总开关 `PLATFORM_REPORT_SCHEDULE_ENABLED` 默认关闭；若以后迁移到真实
旧规则，应在核对水位后同步 API 与 worker 的开关，再检查运行设置接口回显。
依据：[配置默认值](../../server/services/platform-server/src/platform_server/settings.py#L72)、
[总开关生效](../../server/services/platform-server/src/platform_server/apps/report/services/scheduler.py#L103)、
[运行配置 API](../../server/services/platform-server/src/platform_server/apps/report/api/renders.py#L100)。

## 验收建议

1. 转换后的真实模板通过当前 Pydantic 与 `POST /report-templates:validate`；保持 24 个
   指标和 45 个业务节点数量，核对图例名与目录开关。
2. 先读所有依赖台账、列与公式，保留编码/键和原时间、修正、计算值；试算 2023-12 与
   原历史报告期 2026-08，核对数值及陈旧提示，不把后者误判成 2026 年现场数据。
3. 原历史 Word 在新下载 API 返回 200，字节 SHA-256 与源相同；详情不因旧结果形状
   报错，文件名保留模板名与报告期。
4. 用新任务重新生成，等待成功后下载真实 Word，核对中文、标题目录、22 个数字节点、
   8 个条件文本、8 个图表、7 个动态表格及静态表格，检查数据/版式警告。
5. 验证大屏弹窗展示原件与生成时图表、模板切换、最新成功记录选择、刷新、下载、权限、
   错误与卸载清理；报告期切换和手动生成在模板编辑页验证，保留原来无定时规则的状态。

上述建议对应现有规格的验收及真实数据库/worker用例，不能以“SQL 行数相同”替代功能验证。
依据：[验收规格](../REPORT_TEMPLATE_DESIGN.md#L46)、
[可下载 Word 集成用例](../../server/services/platform-server/tests/integration/test_report_runtime.py#L50)、
[定时幂等用例](../../server/services/platform-server/tests/integration/test_report_runtime.py#L102)、
[报告期与缺源集成用例](../../server/services/platform-server/tests/integration/test_report_api.py#L255)。

适用命令（仓库现有工具，不访问生产测试库）：

```bash
uv run --project server --package platform-server pytest \
  server/services/platform-server/tests/unit/report -q

# 配置独立真实测试数据库后执行
uv run --project server --package platform-server pytest \
  server/services/platform-server/tests/integration/test_report_api.py \
  server/services/platform-server/tests/integration/test_report_runtime.py -q

cd web
pnpm vitest run app/tests/pages/Reports app/tests/api/reports.test.ts \
  app/tests/contract/report-shapes.contract.spec.ts
```

测试范围和覆盖率配置依据：[验证说明](../REPORT_TEMPLATE_DESIGN.md#L99)。
