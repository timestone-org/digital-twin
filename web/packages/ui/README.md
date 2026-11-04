# @dt/ui 组件目录

新增页面或通用交互前，先从本目录选组件，再从 `@dt/ui` 公开出口导入。
组件实现、测试、交互示例分别在 `src/components/`、`tests/components/`、`stories/`；
`src/index.ts` 是可用组件与类型的唯一导出清单。执行 `pnpm storybook` 可查看主题、尺寸和交互。

## 按用途选用

| 用途                                 | 组件                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| 工作区分栏、上下区块、嵌套面板       | `DtResizableLayout`                                             |
| 卡片外框与标题、操作、页脚           | `DtCard`                                                        |
| 可展开的字段分区、原始结果、补充说明 | `DtDisclosure`                                                  |
| 页面加载、失败、空态                 | `DtPageState`、`DtEmpty`、`DtSpinner`、`DtSkeleton`             |
| 数据列表与表格/卡片切换              | `DtDataView`、`DtTable`                                         |
| 页码、游标分页                       | `DtPagination`、`DtCursorPager`                                 |
| 操作按钮与图标                       | `DtButton`、`DtIconButton`、`DtIcon`                            |
| 标签、标记、读数、进度               | `DtTag`、`DtBadge`、`DtDigits`、`DtProgress`                    |
| 字段外框、文字、数值                 | `DtField`、`DtInput`、`DtTextarea`、`DtNumberInput`             |
| 下拉、单选、多选、开关               | `DtSelect`、`DtRadioGroup`、`DtRadio`、`DtCheckbox`、`DtSwitch` |
| 日期时间、颜色、滑块、文件           | `DtDateTimeInput`、`DtColorInput`、`DtSlider`、`DtFilePicker`   |
| 弹窗、二次确认、提示                 | `DtModal`、`useConfirm`、`useToast`、`DtNotice`                 |
| 锚定浮层、菜单、辅助说明             | `DtPopover`、`DtDropdownMenu`、`DtTooltip`、`DtHelpTip`         |
| 同区内容切换                         | `DtSegmented`                                                   |
| Markdown、趋势图                     | `DtMarkdown`、`DtLineChart`                                     |

确认、消息、提示的宿主统一由应用壳挂载 `DtConfirmHost`、`DtToastHost`、`DtTipHost`，
业务页面调用对应接口。带业务语义的组合件留在页面或应用 features/components；
产品无关且有真实多个消费者的交互提升到本包，业务存储与权限仍由调用方持有。

## 列表多选

`DtDataView` 可通过 `selection` 对象开启多选，表格、默认卡片和自定义 `card` 插槽
共用同一组选中 ID；未提供时保持原有呈现。

```ts
interface DtDataViewSelection<TRow extends { id: string }> {
  selectedIds: readonly string[]
  disabled?: boolean
  selectAllLabel?: string
  rowLabel?: (row: TRow) => string
}
```

类型从 `@dt/ui` 导入。选中值由调用方持有，监听 `update:selectedIds` 更新数组；
`disabled` 与列表 `loading` 时禁止更改选择。`rowLabel` 为每行复选框提供文本名称，
缺省使用行 ID；`selectAllLabel` 缺省为“选择本页”。全选及取消全选只修改当前
`rows` 的 ID，不会新选其他页的记录，原有其他页 ID 保留。分页、筛选与刷新后的
选择清理由业务页面负责；切换表格和卡片不清空选择。

## 可调整布局与卡片

可调整卡片布局使用 `DtResizableLayout` 与 `DtCard` 组合：
前者负责区块比例、拖动、键盘调整、尺寸记忆及窄容器上下堆叠，后者负责卡片外观。
分栏页优先复用这两个组件，不再新增分隔器实现。

`panes[].id` 必须与具名插槽一致，`storageKey` 必须在页面及嵌套布局之间唯一。
最后一个区块也可使用默认插槽，具名插槽优先。
`size` 为比例，`minSize` 为像素下限；`stackAt` 根据容器宽度判断。
外层须有界高度，内部使用 `min-height: 0`，按需滚动正文，固定的表单动作留在正文外。
完整示例见 [前端 README](../../README.md#可调整页面布局)。

当前接入范围：三种协议采集、知识库、知识库对话、大屏编辑器、卡片编辑器、二维编辑器、
三维编辑器、报告模板编辑、建模画布、OPC UA 节点浏览、层级图、空调空间、空调模型、开机事件与工作台项目栏。

适用性检查后的保留项：

| 页面形态                              | 保留原因                                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| 单列列表、表格/卡片列表、系统模型目录 | 内容是集合或顺序段落，使用 `DtDataView` 或 `DtCard` 与正常滚动   |
| Profile、指标摘要的自适应卡片网格     | 卡片按内容自然增高，没有有界的并列工作区                         |
| 大屏运行与 GridStack 画布             | 尺寸属于用户保存的作品配置，继续使用画布布局语义                 |
| 短确认、普通表单弹窗                  | 使用 `DtModal` 的正文滚动与常驻 footer；无必要增加可拖分栏       |
| 模型参数节点导航                      | 位于自然高度长表单中，保留响应式导航与参数正文，避免嵌套高度计算 |

旧编辑器分隔器已移除；大屏与三维编辑器首次打开时将旧像素宽度偏好转换为新布局比例，保留旧存储键供旧版本读取。工作台的项目栏继续使用 `AppShell` 业务导航槽，由外壳统一提供拖动与尺寸记忆。

## 折叠分区

`DtDisclosure` 使用原生 `details/summary`，默认展开。
用 `:default-open="false"` 指定初始折叠；需要页面记忆时用 `v-model:open`，
页面自行持有状态。默认保留隐藏正文中的输入与状态；只有明确需要卸载时设置
`unmount-on-close`。`title` 也可用 `#title` 插槽替代。
