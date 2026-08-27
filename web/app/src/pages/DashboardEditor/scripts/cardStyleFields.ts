/**
 * @fileoverview 卡片外观字段组的描述表：一条字段写清「摆哪种控件 + 注入哪个变量 +
 * 平台现值（= 留空时的表现）」。键出自 `@dt/contracts` 的 `CHROME_KEYS`，
 * 这里只描述渲染方式，逐条手写 markup 会把面板撑到没法核对。
 */
import type {
  CardChrome,
  ChromeKey,
  DtNumberRange,
  DtSelectOption,
  ModuleChrome,
} from '@dt/contracts'
import { isChromeKey } from '@dt/contracts'
import {
  CARD_BORDER_STYLE_OPTIONS,
  bareBorderClasses,
  normalizeCardBorderStyle,
} from '@dt/runtime'

/**
 * 以类型化键遍历一只 chrome 袋子（含值为 undefined 的显式键，「平台默认」靠它删键）。
 * ⚠ 袋子落库时是自由 JSON：没登记进 `CHROME_KEYS` 的键在这里被过滤掉。
 * @param bag chrome 袋子
 */
export function chromeEntries(bag: CardChrome): [ChromeKey, unknown][] {
  return Object.entries(bag).filter((entry): entry is [ChromeKey, unknown] =>
    isChromeKey(entry[0]),
  )
}

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
      { value: '', label: '方形辉光（默认）' },
      { value: 'bracket', label: 'L 形角括号' },
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
    help: '「角括号」边框的括号长度、「切角边框」的切角大小也读这一项——那两档的四角与角标是同一处装饰，分开配必然对不齐。',
  },
  {
    key: 'cornerGlow',
    label: '角标辉光',
    kind: 'num',
    placeholder: '5',
    range: { min: 0, max: 40 },
    hint: 'px',
    help: '「角括号」与「切角边框」两档不吃这一项：那两档的四角画在卡片自身上，加辉光描出来的是整张卡片的轮廓光。',
  },
  {
    key: 'cornerOpacity',
    label: '角标透明度',
    kind: 'num',
    placeholder: '0.9',
    range: { min: 0, max: 1, step: 0.1, precision: 2 },
    hint: '0–1',
  },
  // 角标从框沿往里缩多少。⚠ 只收 0 及以上：一格是 overflow:hidden，负数会把角标连辉光
  // 一起裁到框外，屏幕上一点痕迹都不剩
  {
    key: 'cornerOffset',
    label: '角标内缩',
    kind: 'num',
    placeholder: '0',
    range: { min: 0, max: 40 },
    hint: 'px，贴框内沿',
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

/**
 * 文字组：整格的正文排版缺省，靠 CSS 继承往下走。
 * ⚠ 只是**缺省**：模块自己有字号 / 字色控件的（文本块），它填的值天然赢过这里。
 */
const TEXT_FIELDS: readonly CardField[] = [
  {
    key: 'fontFamily',
    label: '正文字体',
    kind: 'enum',
    options: [
      { value: '', label: '跟随主题（默认）' },
      { value: 'sans', label: '无衬线' },
      { value: 'display', label: '标题体' },
      { value: 'mono', label: '等宽' },
    ],
  },
  {
    key: 'fontSize',
    label: '正文字号',
    kind: 'num',
    placeholder: '跟随主题',
    range: { min: 8, max: 72 },
    hint: 'px',
  },
  {
    key: 'textColor',
    label: '正文字色',
    kind: 'color',
    help: '模块没有自己的颜色设置时用这个色；文本块这类有专属颜色控件的，以它自己的为准。',
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
  { id: 'text', label: '文字', fields: TEXT_FIELDS },
  { id: 'fx', label: '交互', fields: FX_FIELDS },
]

/** 无记录时默认只展开「边框」：呼吸描边是最常改的一项，其余高级字段常年收着。 */
export const DEFAULT_OPEN_GROUP = 'border'

/**
 * 模块级面板的适配输入。大屏级面板（页面缺省）不构造它：那里的键对整套 card
 * 模块都有效，一律全量摆出。
 */
export interface CardFieldContext {
  /** 选中模块的壳形态。 */
  chrome: ModuleChrome
  /** 清单声明的壳不消费键（`unsupportedChromeKeys`）。 */
  unsupportedKeys: ReadonlySet<string>
  /** `mergeCardChrome(画布缺省, 模块覆盖)` 的有效外观，开关类判定用它。 */
  effective: CardChrome
}

/** 只挂 `.dt-module--card` 的框类键（chrome.scss）：裸渲染壳没有消费点。 */
const BARE_HIDDEN_KEYS: ReadonlySet<string> = new Set([
  'bg',
  'backdropBlur',
  'hoverLift',
  'hoverGlow',
])

/**
 * 过滤出当前模块面板上可见的字段：清单声明不消费的键与裸渲染壳的框类键**隐藏**
 * （结构性不支持）；被开关关掉的键归 `cardGroupDisabledReason`（禁用 + 说明）。
 * @param fields 一组字段声明
 * @param context 模块级适配输入；undefined = 大屏级面板，不过滤
 */
export function visibleCardFields(
  fields: readonly CardField[],
  context: CardFieldContext | undefined,
): readonly CardField[] {
  if (context === undefined) return fields
  return fields.filter((field) => {
    if (context.unsupportedKeys.has(field.key)) return false
    return !(context.chrome === 'bare' && BARE_HIDDEN_KEYS.has(field.key))
  })
}

/** 「角括号 / 切角」两档下角标键改喂边框画法，四角组不随 `corners` 开关死。 */
function isCornerFedByBorder(effective: CardChrome): boolean {
  const border = effective.borderStyle
  if (border == null || border === '') return false
  const style = normalizeCardBorderStyle(border)
  return style === 'bracket' || style === 'cut'
}

/**
 * 这一组字段此刻被哪个开关整组关掉了；null = 没被关。
 * 判定按合成后的**有效**外观走：模块级留空 = 继承画布缺省。
 * @param groupId `CARD_FIELD_GROUPS` 里的组 id
 * @param context 模块级适配输入
 */
export function cardGroupDisabledReason(
  groupId: string,
  context: CardFieldContext,
): string | null {
  const effective = context.effective
  if (groupId === 'corner') {
    // 裸渲染壳只有配了边框样式才画描边浮层，四角跟着浮层走（bareBorderClasses）
    if (
      context.chrome === 'bare' &&
      bareBorderClasses(effective).length === 0
    ) {
      return '需先选择边框样式：裸渲染模块配了边框样式才画四角'
    }
    if (
      effective.corners === false &&
      !context.unsupportedKeys.has('corners') &&
      !isCornerFedByBorder(effective)
    ) {
      return '已被「四角辉光」开关关闭'
    }
  }
  // ⚠ 开关自己被壳声明为不消费时不做联动禁用：容器的标题条走它自己的
  // 「显示标题条」配置，页头页脚壳里干脆没有条，chrome 的 showTitle 对这几个
  // 本来就落不到任何地方
  if (
    groupId === 'title' &&
    effective.showTitle === false &&
    !context.unsupportedKeys.has('showTitle')
  ) {
    return '已被「显示标题」开关关闭'
  }
  return null
}

/** 标题内边距的平台现值：标题栏的 padding 8px 12px 6px。 */
export const TITLE_PAD_DEFAULT: readonly number[] = [8, 12, 6]

export const TITLE_PAD_LABELS: readonly string[] = ['上', '左右', '下']
