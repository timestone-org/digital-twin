# 隔离交付树视觉与范围核验（2026-11-02）

本记录属于 [Issue #362](https://github.com/timestone-org/digital-twin/issues/362) 的隔离整合树，
基于 `origin/main` 的 `44081f8819771d19440f96c00180c18ea88b855b`，只验证抽取后的交付代码。
实际目录为 `/Users/heyufan/.codex/worktrees/assistant-ui-optimization-verify-20261102/DigitalTwin`。
原项目目录与旧证据没有被本轮修改；旧工作区的 90 个弹窗文件 / 93 处声明等统计仅属于
当时物理快照，不能代替本次隔离版本的覆盖数字。

## 安装与测试隔离

在该树的 `web/` 中执行 `pnpm install --frozen-lockfile --offline`，成功安装自身
`node_modules`：758 个包复用缓存，下载为零，锁文件无变更。递归核对根目录及成员
`node_modules` 链接，无链接指向原项目目录。没有把旧树的依赖目录 symlink 进来。

独立 Vite 使用 5176；API 目标为不可用的本地端口 9，测试浏览器以当前树提交的
OpenAPI 字段构造确定性样例，并拦截业务 WebSocket。未访问真实业务 API、工业设备
或真实模型提供方，没有新增业务写入、费用或部署操作。

仅复制并适配了验证工具，没有复制旧截图来充当新结果。工具、样例与新截图位于本树
ignored `logs/isolated-release-visual-20261102/`；生产入口、应用源码和旧报告均未为此修改。

## 实际范围与结果

以当前源码逐项枚举，实际为 **57 条路由地址、89 个使用 DtModal 的文件、92 处声明**。
和原工作区相比，少的是该工作区独有的 `PointBindingChoiceDialog.vue`；交付树没有
混入该文件、流水线新增 `sourcePipelineId` 复制分支或原有 `llmcore/errors.py` 未提交改动。
后者逐字节匹配基线版本。库存核对的缺失路由、文件及页内弹窗分支均为空。

分辨率为 1280×720、1920×1080、2560×1440、3840×2160，设备像素比为 1。

| 本轮重新执行的范围                                         | 状态数 | 四尺寸 case |
| ---------------------------------------------------------- | -----: | ----------: |
| 路由地址，含详情、子路由、重定向与错误页                   |     57 |         228 |
| 独立业务弹窗组件                                           |     81 |         324 |
| 页内弹窗及独立用量显示状态                                 |      9 |          36 |
| 数据源协议、样式预览、品牌主题、AI 截图 / 写确认、匿名登录 |      8 |          32 |
| 导航、报告提示、建模改名、信任证书                         |      4 |          16 |
| 完整助手 Dock：六状态、普通 / 放大两档                     |     12 |          48 |
| 合计                                                       |    171 |         684 |

结果为 **684 个 case、680 个唯一索引 PNG 路径**。四尺寸匿名登录图在路由及变体分类中
复用，未通过复制图片增加数量；长表单另有正文滚到底部的辅助截图。
全部 case 无页面脚本异常、文档横向越界、弹窗越界或当前顶层弹窗关闭 / footer 按钮遮挡。
57 个路由的 228 组顶栏检查，累计 908 个控件逐个滚入视野后均未离屏。

人工抽查了 720p 页面与弹窗缩略索引，并放大检查 Home 项目侧栏、大屏三栏与网格数字
输入、HTTP 长表单、2D 样式左侧配置与右侧预览、完整助手未确认 / 重新核验状态；同时
抽查其它尺寸。图片链接、数据量和部分数值是占位样例，本轮不将真实素材加载、业务
计算或后端持久化列为已验收。

完整助手覆盖就绪、压缩中、模型 PATCH 在途、未确认、重新核验在途、恢复成功；
普通及放大面板在四档均检查发送 / 停止 / 下拉 / 恢复按钮和草稿保留。
模型 PATCH / GET 在浏览器边界模拟失败与延迟，实际使用当前前端逻辑；用量和运行状态
为视觉输入，未发送真实聊天请求。

## 源码归属与字节变化

开始时记录 1,734 个前端 TS / Vue / SCSS / CSS 文件哈希。验证期间审查在
`contextUsage.ts`、`turnRunner.ts` 增加了三个 JSDoc 注释块，其它文件保持不变。
对照本轮初始字节版本，TypeScript AST 去注释输出完全相同，没有执行逻辑漂移。
注释更新后定向复跑完整助手 48 个 case，全部通过，并保存最终源码哈希。

这次没有为补足旧覆盖数字恢复独立任务代码，也没有修改已有源文件解决样例问题。
一处验证工具依赖的预览图最初缺失，改用本轮刚生成的清洁树截图后仅补跑相应变体；
诊断日志保留，该情况未归为产品缺陷。

## 可复查入口与边界

- [本树截图索引](../../logs/isolated-release-visual-20261102/index.html)
- [汇总数字与断言](../../logs/isolated-release-visual-20261102/summary.json)
- [实际路由 / 弹窗库存](../../logs/isolated-release-visual-20261102/inventory.json)
- [源码归属核对](../../logs/isolated-release-visual-20261102/ownership.json)
- [独立依赖安装核对](../../logs/isolated-release-visual-20261102/dependency-ownership.json)
- [两个注释变化的 AST 比对](../../logs/isolated-release-visual-20261102/comment-only-source-review.json)
- [最终源码哈希](../../logs/isolated-release-visual-20261102/source-hashes-final.json)
- [720p Home](../../logs/isolated-release-visual-20261102/finalchecks/720p/--.png)
- [720p 大屏编辑器](../../logs/isolated-release-visual-20261102/finalchecks/720p/--dashboards--sample--edit.png)
- [720p HTTP 长表单](../../logs/isolated-release-visual-20261102/variants/720p/source-http.png)
- [720p 助手未确认状态](../../logs/isolated-release-visual-20261102/ai-dock/720p/model-unconfirmed.png)

这些结果证明隔离交付源码在所列样例与尺寸下的实际渲染和交互布局，不是对本次清洁树
重新开展真实业务写入或真实模型的声明。旧工作区的真实联调证据保持原快照归属；正式
main CI 的提交与运行终态以 Issue #362 的交付记录为准。临时验证页及本轮 Vite 进程在
收集证据后清理，不进入应用产物。

## 发布前最终回归

以 `44081f8819771d19440f96c00180c18ea88b855b` 为固定基线的清洁整合树，全前端 **20,400 项通过**（1,230 个测试文件），行覆盖 **98.19%**、分支 **94.35%**，生产构建通过。包含新增未跟踪生产文件的完整前端增量补丁共710行、缺失15行，diff-cover报告 **97%**，高于85%门槛。

后端审查补修同正文工具配对、用户粘贴摘要前缀保留、恢复流式用量基数三处边界后，共享层514项、助手871项单元/契约加96项独立数据库集成、知识库定向75项通过；完整后端增量 **98.50%**。未纳入原dirty的errors两文件。

截图复跑后还补充了不改变执行语句的函数参数说明，以及最后具名插槽和默认后备同时存在的契约用例。上述源文件哈希记录对应具体采集时点，不冒称后续注释更新后的每个字节都重新截图；最新测试及正式CI以 [议题 #362](https://github.com/timestone-org/digital-twin/issues/362) 的各提交记录为准。

日志保留在本机 `/tmp/dt-clean-frontend-coverage-final-20261102.log`、`/tmp/dt-clean-frontend-build-final-20261102.log`、`/tmp/dt-clean-frontend-diff-coverage-20261102.log` 和 `/tmp/dt-phase2-backend-verification-summary-20261102.json`。
