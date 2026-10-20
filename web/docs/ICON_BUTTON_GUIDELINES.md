# 常见操作的图标按钮

调研日期：2026-10-20。适用于全站管理页、列表行操作与编辑器工具栏。

## 选择范围

优先把语义稳定、使用频繁且上下文明确的操作改成图标按钮，例如撤销、重做、
添加、编辑、复制、刷新、预览。相邻操作使用同一线形风格、尺寸和间距。
图标不容易表达的业务动作保留文字，例如发布模型、启动采集、重新训练、授予权限。
这是结合项目页面作出的设计选择；Carbon 同样建议纯图标用于可识别动作或紧凑工具栏，
且每个图标按钮都提供解释其动作的 tooltip。
来源：[Carbon Button](https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines)。

表单底部的保存、取消、提交、空态首次创建和危险最终确认保留文字；工具栏中的保存可采用图标。
列表中的垃圾桶可作为打开删除确认的入口，确认弹窗必须显示“删除”和目标信息。
直接不可逆的清空、删除、吊销动作保留清晰文字和已有确认流程。这是本项目对紧凑
入口与最终确认的区分；Carbon 对危险按钮更保守，建议始终有可见文字。
来源：[Carbon Button · Danger](https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines)。

## 图标映射

下表是本项目的语义映射，复用受控注册表中的 24 × 24 线形 SVG，不引入新图标库。
源码：[图标注册表](../packages/ui/src/components/DtIcon/registry.ts)。

| 操作         | 图标名                                   | 提示示例与使用边界                       |
| ------------ | ---------------------------------------- | ---------------------------------------- |
| 撤销         | `undo`                                   | 撤销；已实现快捷键时才附快捷键           |
| 重做         | `redo`                                   | 重做；弯箭头区别于前进、后退             |
| 添加、新建   | `plus`                                   | 添加点位、新建文件夹；不能只靠位置猜对象 |
| 编辑、重命名 | `pencil`                                 | 编辑数据源、重命名文件夹                 |
| 复制         | `copy`                                   | 复制配置、复制地址；明确复制的对象       |
| 删除确认入口 | `trash`                                  | 删除节点；沿用原确认与禁用逻辑           |
| 刷新         | `refresh-cw`                             | 刷新列表；加载中保留名称与忙碌状态       |
| 保存         | `save`                                   | 保存配置；表单最终提交仍用文字           |
| 预览、查看   | `eye`                                    | 预览大屏；运行或播放使用 `play`          |
| 导入、上传   | `upload`                                 | 导入 CSV、上传模型；必须写清格式或对象   |
| 导出、下载   | `download`                               | 导出 CSV、下载报告；必须区分具体动作     |
| 上移、下移   | `arrow-up`、`arrow-down`                 | 用直箭头表示排序移动                     |
| 置顶、置底   | `arrow-up-to-line`、`arrow-down-to-line` | 直箭头加边界线，区别于移动一层           |
| 定位选中     | `focus`                                  | 四角取景框加中心点，区别于缩放与吸附     |
| 放大、缩小   | `zoom-in`、`zoom-out`                    | 放大镜加正负号，区别于添加与删除         |
| 对齐、分布   | `align-*`、`distribute-*`                | 保留方向与所需选中数量的提示             |
| 展开、折叠   | `chevron-down`、`chevron-up`             | 与排序移动的直箭头区分                   |
| 设置         | `settings`                               | 设置；多个设置入口时说明对象             |
| 关闭         | `close`                                  | 关闭；不使用未注册的 `x`                 |

## 名称、提示与键盘

- 每个纯图标按钮必须有非空无障碍名称，直接落在原生 `button` 的 `aria-label`。
  名称描述动作，例如“编辑数据源”；装饰性 SVG 保持 `aria-hidden="true"`。
  名称不能仅依赖鼠标悬停。原生按钮保留 Tab 聚焦和 Enter、Space 激活。
  来源：[WAI Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)。
- tooltip 在鼠标悬停和键盘聚焦时可见，Esc 可收起且焦点留在触发按钮。
  提示内容可通过 `aria-describedby` 关联；不得用提示代替按钮名称。
  来源：[WAI Tooltip Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
  （该模式仍标记为工作草案）。
- 自定义提示需要允许指针移入气泡，并持续显示到移出触发器与气泡、失去焦点、
  用户关闭或内容失效。单独依靠 `title` 无法保证一致的键盘提示体验。
  来源：[WCAG 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)。
- 切换按钮沿用 `pressed` 与 `aria-pressed`；禁用、加载、权限和原事件保持原语义。
  来源：[WAI Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)、
  [DtButton](../packages/ui/src/components/DtButton/DtButton.vue)。

## 尺寸与组件复用

常规工具栏和列表操作优先 `sm`，与输入框并排时跟随同组控件尺寸；本项目
`sm` / `md` / `lg` 分别为 32 / 40 / 48 px。纯图标按钮保持正方形，沿用主题色、
圆角、焦点环和 hover 状态；一般次级操作使用低强调度外观，主操作保留层级。
来源：[尺寸 token](../packages/tokens/src/tokens.scss)、
[DtButton](../packages/ui/src/components/DtButton/DtButton.vue)。

避免把全站常见操作压缩到现有 `xs` 的 20 × 20 px。WCAG 2.2 的目标尺寸最低要求为
24 × 24 CSS px，同时允许规定的间距等例外；本项目使用 32 px 常规目标减少误触。
来源：[WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)。

公共实现放在 `@dt/ui`：`DtIconButton` 组合 `DtButton` 与 `DtTooltip`，`label` 必填，
显式传图标和动作名称。复用 `DtButton` 的前置插槽和既有图标尺寸判断，原文字作为
视觉隐藏文本保留，加载期间也始终提供无障碍名称。不按按钮中文文案自动猜图标，也不全局隐藏文字。
页面继续持有权限、确认、加载与业务事件；图标通过受控注册表契约验证。
来源：[web 上下文](../CONTEXT.md)、
[前端包边界 ADR-0001](adr/0001-前端采用source-only-pnpm-workspace.md)。

验证应覆盖实际模板的图标注册名与无障碍名称、点击转发、禁用/加载、键盘提示和
按下状态，并在浅色、深色与窄屏检查布局。现有 `DtTooltip` 的气泡不接收指针且
移离触发器即关闭，本次图标迁移保留这一限制；不据此声称满足完整提示交互要求。
来源：[DtTooltip](../packages/ui/src/components/DtTooltip/DtTooltip.vue)、
[WCAG 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)。
