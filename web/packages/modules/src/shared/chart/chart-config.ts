/**
 * @fileoverview 图表族共用的 configSchema 片段工厂：族 manifest 里直接 spread。
 * 分段组名在这里定死一套，各族不许另造字符串，否则属性面板会摆出两个近义分段。
 * ⚠ 紧凑控件逐个显式写 `span`：缺席等于铺满整行（`PropertyPanel.vue` 只认 `half`），
 * 而清单侧那条闸门查的是顶层 configSchema，工厂漏一个就整族红。
 */
import type {
  ConfigField,
  ConfigFieldCondition,
  ConfigOption,
} from '@dt/contracts'

/** 属性面板的分段标题，全族统一。 */
export const GROUP = {
  data: '数据',
  style: '样式',
  axis: '坐标轴',
  legend: '图例',
  tooltip: '提示框',
  dataLabel: '数据标签',
  animation: '动画',
  refLine: '参考线',
} as const

type When = ConfigFieldCondition

/**
 * 有条件才写 `when` 键。
 * ⚠ `exactOptionalPropertyTypes` 下显式写 `when: undefined` 是类型错，不是「没条件」。
 * @param when 同级字段的显隐条件
 */
function whenOf(when?: When): { when?: When } {
  return when ? { when } : {}
}

/**
 * 标题字段。留空则不渲染标题栏。
 * @param opts 占位文案覆盖
 */
export function titleField(opts: { placeholder?: string } = {}): ConfigField[] {
  return [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      default: '',
      group: GROUP.data,
      span: 'full',
      placeholder: opts.placeholder ?? '留空隐藏标题栏',
    },
  ]
}

/**
 * 图表样式切换，固定落在 `chartStyle` 键上。
 * @param options 本族的样式枚举
 * @param def 缺省样式，不给取第一项
 */
export function chartStyleField(
  options: ConfigOption[],
  def?: unknown,
): ConfigField[] {
  return [
    {
      key: 'chartStyle',
      label: '图表样式',
      type: 'enum',
      group: GROUP.style,
      default: def ?? options[0]?.value,
      span: 'half',
      options,
    },
  ]
}

/**
 * 图例开关，缺省关——存量大屏不该因为加了这个字段突然多出一块图例。
 * @param opts 显隐条件与缺省值
 */
export function legendFields(
  opts: { when?: When; default?: boolean } = {},
): ConfigField[] {
  return [
    {
      key: 'showLegend',
      label: '显示图例',
      type: 'boolean',
      default: opts.default ?? false,
      group: GROUP.legend,
      span: 'half',
      ...whenOf(opts.when),
    },
  ]
}

/**
 * 提示框开关，缺省开。
 * @param opts 显隐条件
 */
export function tooltipFields(opts: { when?: When } = {}): ConfigField[] {
  return [
    {
      key: 'showTooltip',
      label: '显示提示框',
      type: 'boolean',
      default: true,
      group: GROUP.tooltip,
      span: 'half',
      ...whenOf(opts.when),
    },
  ]
}

/**
 * 数值标签开关，缺省开。
 * @param opts 显隐条件与缺省值
 */
export function dataLabelFields(
  opts: { when?: When; default?: boolean } = {},
): ConfigField[] {
  return [
    {
      key: 'showValueLabel',
      label: '显示数值标签',
      type: 'boolean',
      default: opts.default ?? true,
      group: GROUP.dataLabel,
      span: 'half',
      ...whenOf(opts.when),
    },
  ]
}

/**
 * 直角坐标轴的轴名，留空不显。
 * @param opts 显隐条件
 */
export function cartesianAxisFields(opts: { when?: When } = {}): ConfigField[] {
  return [
    {
      key: 'xAxisName',
      label: 'X 轴名称',
      type: 'string',
      default: '',
      group: GROUP.axis,
      span: 'half',
      ...whenOf(opts.when),
    },
    {
      key: 'yAxisName',
      label: 'Y 轴名称',
      type: 'string',
      default: '',
      group: GROUP.axis,
      span: 'half',
      ...whenOf(opts.when),
    },
  ]
}

/**
 * 单位与小数位。
 * @param opts 显隐条件
 */
export function unitPrecisionFields(opts: { when?: When } = {}): ConfigField[] {
  return [
    {
      key: 'unit',
      label: '单位',
      type: 'string',
      default: '',
      group: GROUP.style,
      span: 'half',
      ...whenOf(opts.when),
    },
    {
      key: 'precision',
      label: '小数位',
      type: 'number',
      min: 0,
      max: 6,
      step: 1,
      group: GROUP.style,
      span: 'half',
      help: '留空自动（最多 2 位、去尾随零）',
      ...whenOf(opts.when),
    },
  ]
}

/**
 * 缩放条开关，类目多时用。
 * @param opts 显隐条件与缺省值
 */
export function dataZoomFields(
  opts: { when?: When; default?: boolean } = {},
): ConfigField[] {
  return [
    {
      key: 'showDataZoom',
      label: '显示缩放条',
      type: 'boolean',
      default: opts.default ?? false,
      group: GROUP.style,
      span: 'half',
      help: '类目较多时启用滑动缩放。⚠ 滑块跟着几何走：竖柱与曲线摆在图下方，横条图摆在图右侧。',
      ...whenOf(opts.when),
    },
  ]
}

/**
 * 动画开关，缺省关：实时刷新时曲线直接就位，不做滑动与形变。
 * ⚠ 宿主自己定入场时长、不读 `animationDuration` 时必须传 `duration:false`，
 * 否则面板上会摆出一个配了没反应的旋钮。
 * @param opts 显隐条件与是否产出时长字段
 */
export function animationFields(
  opts: { when?: When; duration?: boolean } = {},
): ConfigField[] {
  const fields: ConfigField[] = [
    {
      key: 'animation',
      label: '启用动画',
      type: 'boolean',
      default: false,
      group: GROUP.animation,
      span: 'half',
      help: '默认关闭；开启后首帧入场与数据更新会带过渡。',
      ...whenOf(opts.when),
    },
  ]
  if (opts.duration === false) return fields
  // 只在开了动画时可见：关着动画调时长没有意义，摆出来只会让面板变长。
  // ⚠ when 只判一级，同时约束不了 opts.when——宿主隐藏「启用动画」时，
  // 本字段会因 animation 恒为 false 而一并隐藏。
  fields.push({
    key: 'animationDuration',
    label: '动画时长(ms)',
    type: 'number',
    min: 0,
    step: 50,
    default: 600,
    group: GROUP.animation,
    span: 'half',
    help: '首帧入场 / 数据更新的过渡时长；仅在启用动画时生效。',
    when: { key: 'animation', in: [true] },
  })
  return fields
}

/**
 * 自定义色板，每行一色；留空用当前主题色板。
 * @param opts 显隐条件
 */
export function paletteOverrideField(
  opts: { when?: When } = {},
): ConfigField[] {
  return [
    {
      key: 'palette',
      label: '自定义色板',
      type: 'array',
      group: GROUP.style,
      help: '留空使用主题色板；每行一个颜色，按系列顺序取用。',
      itemSchema: [{ key: 'color', label: '颜色', type: 'color' }],
      default: [],
      ...whenOf(opts.when),
    },
  ]
}

/** 首字母大写，用来拼 `area` + `Gradient` → `areaGradient`。 */
function cap(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/** `gradientFields()` 能产出的字段名，不含前缀。 */
export type GradientFieldName =
  'gradient' | 'gradientTo' | 'topAlpha' | 'opacity'

const GRADIENT_ORDER: GradientFieldName[] = [
  'gradient',
  'gradientTo',
  'topAlpha',
  'opacity',
]

/** 渐变四项的共性部分；key 前缀与标签前缀由工厂按调用补齐。 */
const GRADIENT_TEMPLATES: Record<
  GradientFieldName,
  { labelSuffix: string; field: Omit<ConfigField, 'key' | 'label'> }
> = {
  gradient: {
    labelSuffix: '渐变',
    field: {
      type: 'boolean',
      default: false,
      group: GROUP.style,
      span: 'half',
      help: '默认关闭（纯色填充）；开启后由主色派生上浓下透的竖向渐变。',
    },
  },
  gradientTo: {
    labelSuffix: '渐变末端色',
    field: {
      type: 'color',
      default: '',
      group: GROUP.style,
      span: 'half',
      help: '留空由主色自动派生同色渐隐；支持 var(--x) 随换肤走。',
    },
  },
  topAlpha: {
    labelSuffix: '起始透明度',
    field: {
      type: 'number',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      group: GROUP.style,
      span: 'half',
      help: '渐变顶端的不透明度，底端固定全透明。',
    },
  },
  opacity: {
    labelSuffix: '整体不透明度',
    field: {
      type: 'number',
      default: 0.18,
      min: 0,
      max: 1,
      step: 0.02,
      group: GROUP.style,
      span: 'half',
      help: '叠在填充色之上的整体透明度，与渐变无关，纯色填充时也生效。',
    },
  },
}

/** 渐变字段工厂的入参。 */
export interface GradientOptions {
  when?: When
  /** key 前缀，缺省 `area`；给空串产出裸 key。 */
  prefix?: string
  /** 标签前缀，缺省「面积」；柱图传「柱体」。 */
  label?: string
  /** 只产出这几项，缺省全部四项。 */
  include?: GradientFieldName[]
  topAlpha?: number
  opacity?: number
}

function gradientDefault(
  name: GradientFieldName,
  opts: GradientOptions,
): number | undefined {
  if (name === 'topAlpha') return opts.topAlpha
  if (name === 'opacity') return opts.opacity
  return undefined
}

/**
 * 渐变填充字段（折线的面积与柱图的柱体共用一套语义）。
 * 输出顺序固定，不随 `include` 的书写顺序变。
 * @param opts 前缀、标签与缺省值覆盖
 */
export function gradientFields(opts: GradientOptions = {}): ConfigField[] {
  const prefix = opts.prefix ?? 'area'
  const label = opts.label ?? '面积'
  const wanted = opts.include ?? GRADIENT_ORDER
  return GRADIENT_ORDER.filter((name) => wanted.includes(name)).map((name) => {
    const template = GRADIENT_TEMPLATES[name]
    const override = gradientDefault(name, opts)
    return {
      ...template.field,
      key: prefix ? prefix + cap(name) : name,
      label: `${label}${template.labelSuffix}`,
      ...(override === undefined ? {} : { default: override }),
      ...whenOf(opts.when),
    }
  })
}

/**
 * 参考线数组字段，对应 chartKit 的 `markLineRef()`。缺省 `[]` = 不画。
 * @param opts 显隐条件
 */
export function markLineFields(opts: { when?: When } = {}): ConfigField[] {
  return [
    {
      key: 'refLines',
      label: '参考线',
      type: 'array',
      group: GROUP.refLine,
      default: [],
      help: '阈值线 / 目标线 / 基线；留空不画。',
      itemLabelKey: 'label',
      itemSchema: [
        { key: 'value', label: '参考值', type: 'number' },
        {
          key: 'label',
          label: '文字',
          type: 'string',
          placeholder: '留空只画线不写字',
        },
        { key: 'color', label: '颜色', type: 'color' },
        {
          key: 'lineType',
          label: '线型',
          type: 'enum',
          default: 'dashed',
          options: [
            { value: 'dashed', label: '虚线' },
            { value: 'solid', label: '实线' },
            { value: 'dotted', label: '点线' },
          ],
        },
        {
          key: 'fontSize',
          label: '文字字号',
          type: 'number',
          min: 6,
          max: 40,
          step: 1,
        },
      ],
      ...whenOf(opts.when),
    },
  ]
}

/**
 * 类目轴抽稀、值轴量程与两端留白。
 * ⚠ `xLabelInterval` 是 string 不是 number：它要表达三种状态——留空自动抽稀、
 * 0 全部显示、n 每隔 n 个显示一个，而数字控件分不出「留空」与「0」。
 * @param opts 显隐条件与两个缺省值覆盖
 */
export function axisIntervalFields(
  opts: { when?: When; boundaryGap?: boolean; yScale?: boolean } = {},
): ConfigField[] {
  return [
    {
      key: 'xLabelInterval',
      label: '类目标签间隔',
      type: 'string',
      default: '',
      group: GROUP.axis,
      span: 'half',
      placeholder: '自动',
      help: '留空自动抽稀；填 0 全部显示，填 n 每隔 n 个显示一个。',
      ...whenOf(opts.when),
    },
    {
      key: 'yScale',
      label: '数值轴不强制含 0',
      type: 'boolean',
      default: opts.yScale ?? false,
      group: GROUP.axis,
      span: 'half',
      help: '默认从 0 起；开启后按数据范围自适应，适合高基线上的窄幅波动。',
      ...whenOf(opts.when),
    },
    {
      key: 'boundaryGap',
      label: '类目轴两端留白',
      type: 'boolean',
      default: opts.boundaryGap ?? true,
      group: GROUP.axis,
      span: 'half',
      help: '关闭后曲线 / 面积贴紧左右边缘。',
      ...whenOf(opts.when),
    },
  ]
}

/**
 * 折线数据点。`symbolSize` 缺省绑在 `showSymbol=true` 上——点都关了没必要再调大小。
 * @param opts 显隐条件与两个缺省值覆盖
 */
export function symbolFields(
  opts: { when?: When; showSymbol?: boolean; symbolSize?: number } = {},
): ConfigField[] {
  return [
    {
      key: 'showSymbol',
      label: '显示数据点',
      type: 'boolean',
      default: opts.showSymbol ?? true,
      group: GROUP.style,
      span: 'half',
      help: '关闭后只画线不画点，密集时序远观更干净。',
      ...whenOf(opts.when),
    },
    {
      key: 'symbolSize',
      label: '数据点大小',
      type: 'number',
      default: opts.symbolSize ?? 6,
      min: 0,
      max: 40,
      step: 1,
      group: GROUP.style,
      span: 'half',
      when: opts.when ?? { key: 'showSymbol', in: [true] },
    },
  ]
}

/** `chartFontFields()` 能产出的字段名，就是它产出的 config key。 */
export type ChartFontFieldKey =
  | 'axisLabelFontSize'
  | 'axisNameFontSize'
  | 'legendFontSize'
  | 'tooltipFontSize'
  | 'labelFontSize'
  | 'labelFontFamily'
  | 'labelColor'

const CHART_FONT_ORDER: ChartFontFieldKey[] = [
  'axisLabelFontSize',
  'axisNameFontSize',
  'legendFontSize',
  'tooltipFontSize',
  'labelFontSize',
  'labelFontFamily',
  'labelColor',
]

const FONT_SIZE_RANGE = { min: 6, max: 40, step: 1 }

/** 字号缺省逐个等于 chartKit 里参数化之前的取值，改一个就污染全部存量大屏。 */
const CHART_FONT_TEMPLATES: Record<ChartFontFieldKey, ConfigField> = {
  axisLabelFontSize: {
    key: 'axisLabelFontSize',
    label: '轴刻度字号',
    type: 'number',
    default: 11,
    ...FONT_SIZE_RANGE,
    group: GROUP.axis,
    span: 'half',
  },
  axisNameFontSize: {
    key: 'axisNameFontSize',
    label: '轴名称字号',
    type: 'number',
    default: 11,
    ...FONT_SIZE_RANGE,
    group: GROUP.axis,
    span: 'half',
  },
  legendFontSize: {
    key: 'legendFontSize',
    label: '图例字号',
    type: 'number',
    default: 11,
    ...FONT_SIZE_RANGE,
    group: GROUP.legend,
    span: 'half',
  },
  tooltipFontSize: {
    key: 'tooltipFontSize',
    label: '提示框字号',
    type: 'number',
    default: 12,
    ...FONT_SIZE_RANGE,
    group: GROUP.tooltip,
    span: 'half',
  },
  labelFontSize: {
    key: 'labelFontSize',
    label: '数值标签字号',
    type: 'number',
    default: 11,
    ...FONT_SIZE_RANGE,
    group: GROUP.dataLabel,
    span: 'half',
  },
  labelFontFamily: {
    key: 'labelFontFamily',
    label: '数值标签字体',
    type: 'enum',
    default: 'sans',
    group: GROUP.dataLabel,
    span: 'half',
    help: '族层负责把它换成已解析的字体栈——canvas 不认 var(--x)。',
    options: [
      { value: 'sans', label: '默认（继承正文）' },
      { value: 'display', label: '标题体' },
      { value: 'mono', label: '等宽体' },
    ],
  },
  labelColor: {
    key: 'labelColor',
    label: '数值标签颜色',
    type: 'color',
    default: '',
    group: GROUP.dataLabel,
    span: 'half',
    help: '留空用次要文字色；支持 var(--x) 随换肤走。',
  },
}

/**
 * 图表字号 / 字体 / 标签色，与 chartKit 那批可选参数一一对应。
 * 输出顺序固定，不随 `include` 的书写顺序变。
 * @param opts 显隐条件与按族裁剪
 */
export function chartFontFields(
  opts: { when?: When; include?: ChartFontFieldKey[] } = {},
): ConfigField[] {
  const wanted = opts.include ?? CHART_FONT_ORDER
  return CHART_FONT_ORDER.filter((key) => wanted.includes(key)).map((key) => ({
    ...CHART_FONT_TEMPLATES[key],
    ...whenOf(opts.when),
  }))
}
