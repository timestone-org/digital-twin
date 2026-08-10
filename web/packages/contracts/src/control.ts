/**
 * @fileoverview 表单原语的共用轴：尺寸档、语义色、按钮变体。
 * 取值与 @dt/tokens 的 --ctl-* 变量交叉锁定，见 packages/ui 的契约测试。
 */

export const DT_SIZES = ['sm', 'md', 'lg'] as const
export type DtSize = (typeof DT_SIZES)[number]

export const DT_CONTROL_DEFAULT_SIZE: DtSize = 'md'

export const DT_INTENTS = [
  'primary',
  'success',
  'warning',
  'danger',
  'info',
  'neutral',
] as const
export type DtIntent = (typeof DT_INTENTS)[number]

export const DT_BUTTON_VARIANTS = ['solid', 'soft', 'ghost', 'outline'] as const
export type DtButtonVariant = (typeof DT_BUTTON_VARIANTS)[number]

/** 控件内嵌图标边长（px），三档与 --ctl-icon-* 同值。 */
export const DT_CONTROL_ICON_PX: Record<DtSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
}

/**
 * 表格 / 数据视图的列定义。
 *
 * ⚠ 放在 contracts 而不是随组件导出：`.vue` 里 `export interface` 只有
 * vue-tsc 认得，typescript-eslint 解析不出来，消费方一律报 unsafe-any。
 */
export interface DtTableColumn {
  /** 列标识，同时是插槽名 `cell-<key>` 的后缀。 */
  key: string
  label: string
  /** 任意 CSS 长度，落到 `<col>` 上。 */
  width?: string
  align?: 'left' | 'center' | 'right'
  /** 可排序。排序**不在组件内做**，只抛事件——数据通常在服务端分页。 */
  sortable?: boolean
}

/** 排序态。`null` 表示用调用方的默认序。 */
export interface DtTableSort {
  key: string
  desc: boolean
}

/** 卡片视图里的角色。缺省 `field`：渲染成「标签 + 取值」的一行。 */
export const DT_DATA_CARD_ROLES = [
  'title',
  'meta',
  'actions',
  'field',
  'hidden',
] as const
export type DtDataCardRole = (typeof DT_DATA_CARD_ROLES)[number]

export interface DtDataColumn extends DtTableColumn {
  card?: DtDataCardRole
}

export const DT_DATA_VIEW_MODES = ['table', 'card'] as const
export type DtDataViewMode = (typeof DT_DATA_VIEW_MODES)[number]

export interface DtSegmentedOption {
  value: string
  label: string
  /** 已在 DtIcon 注册表登记的名字；缺省则只显示文字。 */
  icon?: string
  /** 只给图标、文字仅供读屏。密集工具条里用。 */
  iconOnly?: boolean
}

export interface DtSelectOption {
  value: string
  label: string
  disabled?: boolean
}
