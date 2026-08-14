/**
 * @fileoverview 卡片外观字段组的描述表：一条字段写清「摆哪种控件 + 注入哪个变量 +
 * 平台现值（= 留空时的表现）」。键出自 `@dt/contracts` 的 `CHROME_KEYS`，
 * 这里只描述渲染方式，逐条手写 markup 会把面板撑到没法核对。
 */
import type { ChromeKey, DtNumberRange, DtSelectOption } from '@dt/contracts'
import { CARD_BORDER_STYLE_OPTIONS } from '@dt/runtime'

/** 一条可配字段。`pad3` 是唯一的 `number[3]`（标题内边距），三格数字并排。 */
export interface CardField {
  key: ChromeKey
  label: string
  kind: 'bool' | 'num' | 'enum' | 'color' | 'pad3'
  /**
   * 这个开关的平台默认是「开」（四角辉光、显示标题）。
   * ⚠ 不给它就会把未设置画成关，用户看到的默认态与实际渲染相反。
   */
  defaultOn?: boolean
  /** 输入框占位符：一律写平台现值，作为「留空 = 此值」的可视提示。 */
  placeholder?: string
  range?: DtNumberRange
  options?: readonly DtSelectOption[]
  /** 一行说明。数值控件是半栏宽，超过八个字就折行，只写单位与最关键的一句。 */
  hint?: string
  /** 成段解释，进标签旁的问号气泡，不占版面。 */
  help?: string
}

/**
 * 边框样式的选项**从渲染侧的目录推导**，面板不另抄一份：抄一份就一定会漂成
 * 「面板能选、渲染静默回落」（DASHBOARD_DESIGN §5.3 ⑤）。
 */
const BORDER_STYLE_OPTIONS: readonly DtSelectOption[] = [
  { value: '', label: '跟随平台默认' },
  ...CARD_BORDER_STYLE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  })),
]

/** 常显块：一打开面板就在的九项，其余按分组收起。 */
const COMMON_FIELDS: readonly CardField[] = [
  {
    key: 'borderStyle',
    label: '边框样式',
    kind: 'enum',
    options: BORDER_STYLE_OPTIONS,
  },
  { key: 'bg', label: '卡片背景', kind: 'color' },
  { key: 'border', label: '边框色', kind: 'color' },
  // 悬停边框色同时是「呼吸描边」的亮端色，留空则走主题
  { key: 'borderHover', label: '悬停边框色', kind: 'color' },
  { key: 'cornerColor', label: '角标色', kind: 'color' },
  {
    key: 'radius',
    label: '圆角',
    kind: 'num',
    placeholder: '8',
    range: { min: 0, max: 60 },
    hint: 'px',
  },
  { key: 'corners', label: '四角辉光', kind: 'bool', defaultOn: true },
  { key: 'showTitle', label: '显示标题', kind: 'bool', defaultOn: true },
  { key: 'titleColor', label: '标题色', kind: 'color' },
]

/** 枚举首项恒为空串：选它 = 删键 = 回到平台默认，这是「回到默认」唯一的表达。 */
const BORDER_SIDE_OPTIONS: readonly DtSelectOption[] = [
  { value: '', label: '四边（默认）' },
  { value: 'top', label: '仅上边' },
  { value: 'bottom', label: '仅下边' },
  { value: 'left', label: '仅左边' },
  { value: 'right', label: '仅右边' },
]

/** 边框组：与边框样式正交的三个旋钮。 */
const BORDER_FIELDS: readonly CardField[] = [
  {
    key: 'borderPulse',
    label: '呼吸描边',
    kind: 'bool',
    help: '给任意边框样式叠一层明暗呼吸。「呼吸描边」这个边框样式本身已自带该效果，本开关是把它叠到辉光 / 虚线 / 角括号等其他样式上的通路。',
  },
  // 呼吸周期。上面的开关与「呼吸描边」样式两条路都读它，故不随开关隐藏
  {
    key: 'borderPulseDuration',
    label: '呼吸周期',
    kind: 'num',
    placeholder: '6',
    range: { min: 0.5, max: 60, step: 0.5 },
    hint: '秒',
  },
  // 只保留某一条边。平台现值四边各 1px，页脚一类的横条常只留一条顶边线
  {
    key: 'borderSide',
    label: '描边边数',
    kind: 'enum',
    options: BORDER_SIDE_OPTIONS,
  },
]

/** 四角组：角标形状与几何。 */
const CORNER_FIELDS: readonly CardField[] = [
  {
    key: 'cornerStyle',
    label: '角标形状',
    kind: 'enum',
    options: [
      { value: '', label: 'L 形角括号（默认）' },
      { value: 'dot', label: '小方点' },
    ],
  },
  {
    key: 'cornerSize',
    label: '角标尺寸',
    kind: 'num',
    placeholder: '10',
    range: { min: 0, max: 60 },
    hint: 'px',
  },
  {
    key: 'cornerGlow',
    label: '角标辉光',
    kind: 'num',
    placeholder: '5',
    range: { min: 0, max: 40 },
    hint: 'px',
  },
  {
    key: 'cornerOpacity',
    label: '角标透明度',
    kind: 'num',
    placeholder: '0.9',
    range: { min: 0, max: 1, step: 0.1, precision: 2 },
    hint: '0–1',
  },
  // 角标相对边框的偏移。平台现值 -1px（骑在边框上、略微出框）；小方点建议 0 贴框内沿，
  // 因为这一格是 overflow:hidden，出框的角标与辉光会被裁掉
  {
    key: 'cornerOffset',
    label: '角标偏移',
    kind: 'num',
    placeholder: '-1',
    hint: 'px，小方点用 0',
  },
]

/** 标题条组：标题栏的几何 / 配色 / 脉动 / 右侧装饰带。 */
const TITLE_FIELDS: readonly CardField[] = [
  {
    key: 'titleAlign',
    label: '纵向对齐',
    kind: 'enum',
    options: [
      { value: '', label: '居中（默认）' },
      { value: 'bottom', label: '底对齐' },
    ],
  },
  { key: 'titlePadding', label: '标题内边距', kind: 'pad3' },
  // 下限 1 而非 0：这个间距同时管「竖条 ↔ 文字」与「文字 ↔ 装饰带」，0 会让两侧都贴死
  {
    key: 'titleGap',
    label: '竖条与文字间距',
    kind: 'num',
    placeholder: '8',
    range: { min: 1, max: 40 },
    hint: 'px',
  },
  {
    key: 'titleFontSize',
    label: '标题字号',
    kind: 'num',
    placeholder: '13',
    range: { min: 8, max: 48 },
    hint: 'px',
  },
  {
    key: 'titleFontWeight',
    label: '标题字重',
    kind: 'enum',
    options: [
      { value: '', label: '半粗 600（默认）' },
      { value: '400', label: '常规 400' },
      { value: '500', label: '中黑 500' },
      { value: '600', label: '半粗 600' },
      { value: '700', label: '粗体 700' },
    ],
  },
  {
    key: 'titleLetterSpacing',
    label: '标题字距',
    kind: 'num',
    placeholder: '默认',
    range: { min: 0, max: 20, step: 0.5 },
    hint: 'px，留空 0.025em',
  },
  {
    key: 'titleBarWidth',
    label: '竖条宽度',
    kind: 'num',
    placeholder: '3',
    range: { min: 0, max: 20 },
    hint: 'px',
  },
  {
    key: 'titleBarFull',
    label: '竖条贯穿整行',
    kind: 'bool',
    hint: '竖条高度拉满标题行',
  },
  {
    key: 'titleBarRadius',
    label: '竖条圆角',
    kind: 'num',
    placeholder: '胶囊',
    range: { min: 0, max: 20 },
    hint: 'px，0=方角',
  },
  {
    key: 'titleBarGlow',
    label: '竖条辉光',
    kind: 'num',
    placeholder: '6',
    range: { min: 0, max: 40 },
    hint: 'px',
  },
  { key: 'titleBarColor', label: '竖条颜色', kind: 'color' },
  // 脉动的另一端色必须独立成字段：有的主题主 / 辅色差极小、有的差异巨大
  { key: 'titleBarColorAlt', label: '竖条脉动辅色', kind: 'color' },
  {
    key: 'titlePulse',
    label: '标题脉动',
    kind: 'bool',
    hint: '竖条主辅色互换 + 文字辉光呼吸',
  },
  {
    key: 'titlePulseDuration',
    label: '脉动周期',
    kind: 'num',
    placeholder: '3',
    range: { min: 0.5, max: 60, step: 0.5 },
    hint: '秒',
  },
  // 开启后标题文字从占满余量收成自然宽度，把右侧空间让给装饰带
  {
    key: 'titleRule',
    label: '右侧装饰带',
    kind: 'enum',
    options: [
      { value: '', label: '无（默认）' },
      { value: 'line', label: '细线' },
      { value: 'hatch', label: '45° 斜纹' },
    ],
  },
  // 「细线」档不改带高（它只把斜纹层打成透明），故本项在两档下都按填写值生效
  {
    key: 'titleRuleHeight',
    label: '装饰带高度',
    kind: 'num',
    placeholder: '13',
    range: { min: 0, max: 40 },
    hint: 'px',
  },
  {
    key: 'titleRuleOpacity',
    label: '装饰带透明度',
    kind: 'num',
    placeholder: '0.3',
    range: { min: 0, max: 1, step: 0.1, precision: 2 },
    hint: '0–1',
  },
]

/** 交互组：卡片框整体质感，全部模块共享。 */
const FX_FIELDS: readonly CardField[] = [
  // 非 0 会新建合成层，整屏开启前请实测性能
  {
    key: 'backdropBlur',
    label: '毛玻璃模糊',
    kind: 'num',
    placeholder: '0',
    range: { min: 0, max: 40 },
    hint: 'px，0=关',
  },
  {
    key: 'hoverLift',
    label: '悬停上浮',
    kind: 'num',
    placeholder: '0',
    range: { min: 0, max: 40 },
    hint: 'px',
  },
  {
    key: 'hoverGlow',
    label: '悬停辉光',
    kind: 'bool',
    hint: '悬停时叠加内外双层辉光',
  },
]

export interface CardFieldGroup {
  id: string
  label: string
  fields: readonly CardField[]
}

/** 常显块的九项，不进分组。 */
export const CARD_COMMON_FIELDS = COMMON_FIELDS

/** 四个高级分组，默认收起，只留一行标题，不改变面板既有长度。 */
export const CARD_FIELD_GROUPS: readonly CardFieldGroup[] = [
  { id: 'border', label: '边框', fields: BORDER_FIELDS },
  { id: 'corner', label: '四角', fields: CORNER_FIELDS },
  { id: 'title', label: '标题条', fields: TITLE_FIELDS },
  { id: 'fx', label: '交互', fields: FX_FIELDS },
]

/** 无记录时默认只展开「边框」：呼吸描边是最常改的一项，其余高级字段常年收着。 */
export const DEFAULT_OPEN_GROUP = 'border'

/** 标题内边距的平台现值：标题栏的 padding 8px 12px 6px。 */
export const TITLE_PAD_DEFAULT: readonly number[] = [8, 12, 6]

export const TITLE_PAD_LABELS: readonly string[] = ['上', '左右', '下']
