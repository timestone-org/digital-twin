/**
 * @fileoverview gauge-card 的配置 → 形态：一次读完外观那一半 config，收成一份 `GaugeLook`
 * （修饰类、`--gc-*` 变量、夹取后的尺寸、五档几何的参数与外层网格）。纯函数，模板只摆件
 * 不判档位（MODULE_INFO_CARD_DESIGN §4.2 / §9.2）。
 * ⚠ 数值一律夹回清单声明的范围：`min` / `max` 只约束属性面板，脏配置里的 `-8` 会让整条
 * CSS 声明被浏览器丢掉，而 `0` 厚度会让整条轨道彻底看不见。
 * ⚠ 外层网格走 `gridStyle` 而不是 CSS 变量：列模板、格间距与整块内边距只有容器一个消费者，
 * 摊成变量就要靠另一个文件写对名字才生效，而变量名拼错既不报错也不生效。
 */
import type { CSSProperties } from 'vue'

import {
  readArray,
  readEnum,
  readNumber,
  readRecord,
  readText,
  readTrimmedText,
} from '../../shared/config'

import {
  arcPath,
  GAUGE_ARC_SPAN_DEFAULT,
  GAUGE_ARC_SPAN_MAX,
  GAUGE_ARC_SPAN_MIN,
  resolveThickness,
} from './geometry'
import {
  GAUGE_COLUMN_VALUES,
  GAUGE_FILL_STYLE_VALUES,
  GAUGE_INDICATOR_VALUES,
  GAUGE_LABEL_PLACE_VALUES,
  GAUGE_LABEL_TONE_COLORS,
  GAUGE_LABEL_TONE_VALUES,
  GAUGE_LAYOUT_VALUES,
  GAUGE_READOUT_PLACE_VALUES,
  GAUGE_SHAPE_VALUES,
  GAUGE_UNIT_PLACE_VALUES,
  type GaugeColumns,
  type GaugeFillStyle,
  type GaugeIndicator,
  type GaugeLabelPlace,
  type GaugeLayout,
  type GaugeReadoutPlace,
  type GaugeShape,
} from './options'

/** 已按仪表个数收敛过的排布：`auto` 到这里已经变成两档之一。 */
export type GaugeGridLayout = Exclude<GaugeLayout, 'auto'>

/**
 * 储罐宽、管宽、球径三个尺寸的可配区间与缺省，清单与渲染共用这一份。
 * ⚠ 缺省 56 / 14 / 26 逐字取自参考仓 `entity-gauge` 的 `.eg-tank` / `.eg-thermo-tube`
 * / `.eg-thermo-bulb`；各写一遍的话，面板放行的值会被渲染层再夹一次，表现是
 * 「拖到头了还在变小」。
 */
export const GAUGE_SIZE_BOUNDS = {
  tankWidth: { min: 16, max: 200, fallback: 56 },
  tubeWidth: { min: 6, max: 60, fallback: 14 },
  bulbSize: { min: 10, max: 96, fallback: 26 },
} as const

/**
 * 储罐居中读数的描边阴影。
 * ⚠ 这是一处**有意的偏离**（MODULE_INFO_CARD_DESIGN §10.1）：参考仓那处用
 * `mix-blend-mode: difference`，它会新建层叠上下文，与可配的半透明外壳、毛玻璃与辉光
 * 叠加后不可预测。改成描边阴影 + 可配前景色，只有储罐这一档注入。
 */
const TANK_OUTLINE =
  '0 0 4px var(--surface-sunken), 0 0 8px var(--surface-sunken)'

/** 自适应列的最小列宽，与 gauge-card 清单声明的最小宽同值。 */
const AUTO_MIN_COL = 120

// 属性面板声明的取值范围，`look` 这一层再夹一次
const MAX_PAD = 40
const MIN_FONT = 8
const MAX_LABEL_FONT = 48
const MAX_UNIT_FONT = 32
const MAX_VALUE_FONT = 200
const MIN_TICK_FONT = 8
const MAX_TICK_FONT = 20
const MAX_GLOW = 24

type GcVarName =
  | '--gc-track-color'
  | '--gc-fill-color'
  | '--gc-thickness'
  | '--gc-tank-w'
  | '--gc-tube-w'
  | '--gc-bulb'
  | '--gc-value-size'
  | '--gc-value-color'
  | '--gc-value-glow'
  | '--gc-unit-size'
  | '--gc-label-size'
  | '--gc-label-color'
  | '--gc-tick-size'
  | '--gc-outline'

/**
 * 本模块自己的一组 CSS 变量；样式表只认变量，不认配置键。
 * ⚠ 这套变量没有全局闸看着（`css-variables.contract.spec.ts` 扫不到
 * `packages/modules/src`），拼错既不报错也不生效，只能靠 `look.test.ts` 里那条与 scss
 * 双向吻合的断言。
 */
export type GaugeVars = CSSProperties & Partial<Record<GcVarName, string>>

/** 变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const GC_VAR_NAMES: readonly GcVarName[] = [
  '--gc-track-color',
  '--gc-fill-color',
  '--gc-thickness',
  '--gc-tank-w',
  '--gc-tube-w',
  '--gc-bulb',
  '--gc-value-size',
  '--gc-value-color',
  '--gc-value-glow',
  '--gc-unit-size',
  '--gc-label-size',
  '--gc-label-color',
  '--gc-tick-size',
  '--gc-outline',
]

/**
 * 一档色标：落在量程的百分之几处、什么颜色。
 * ⚠ 颜色只填 `var(--…)` 引用或十六进制；算出来的色值换肤时不跟着走。
 */
export interface GaugeColorStop {
  at: number
  color: string
}

/**
 * 读自定义色标，按位置排好序。
 * ⚠ 排序不能省：SVG 的 `<stop>` 按**文档序**生效，位置写倒了的那两档会被浏览器
 * 静默夹平成一段纯色，而配置里明明是两个颜色。
 * ⚠ 不足两档时返回空表：一档渐变没有意义，而 `<linearGradient>` 只有一个 stop 时
 * 画出来是透明。
 * @param raw 配置里那个数组
 */
export function readColorStops(raw: unknown): GaugeColorStop[] {
  const stops = readArray(raw).flatMap((one) => {
    const row = readRecord(one)
    const color = readText(row.color).trim()
    return color === ''
      ? []
      : [{ at: clamp(readNumber(row.at, 0), 0, 100), color }]
  })
  return stops.length < 2 ? [] : [...stops].sort((a, b) => a.at - b.at)
}

/** 五档几何真正用到的那几个数，模板与 svg 直接绑它。 */
export interface GaugeGeometryLook {
  /**
   * 弧的描边宽 / 条与轨道的高（px）。
   * ⚠ 储罐与温度计恒 `0`：那两档不吃厚度，粗细由 `tankWidth` / `tubeWidth` 管。
   */
  thickness: number
  arcSpan: number
  tankWidth: number
  tubeWidth: number
  bulbSize: number
  /** 弧度盘那一整条 `d`，模板直接绑 `:d`。 */
  arcPath: string
}

/** 解析并夹取之后的尺寸，变量由它派生；断言尺寸时读这一份而不是解析 px 串。 */
export interface GaugeNums {
  gap: number
  padX: number
  padY: number
  /** 0 = 跟着格宽自适应，样式表里的 `clamp()` 接手。 */
  valueSize: number
  valueGlow: number
  unitSize: number
  labelSize: number
  tickSize: number
}

/** 一块仪表卡从配置里读出来的全部形态。 */
export interface GaugeLook {
  classes: string[]
  vars: GaugeVars
  nums: GaugeNums
  /** 已按仪表个数收敛的实际排布。 */
  layout: GaugeGridLayout
  shape: GaugeShape
  fillStyle: GaugeFillStyle
  /** 读数怎么指示：填到读数，还是满弧加指针。⚠ 只有弧度盘吃 `needle`。 */
  indicator: GaugeIndicator
  /** 自定义色标；空表 = 不走这一档。 */
  colorStops: GaugeColorStop[]
  readoutPlace: GaugeReadoutPlace
  /** ⚠ 类名由仪表自己在标签真渲染时才挂，这里只给档位。 */
  labelPlace: GaugeLabelPlace
  geometry: GaugeGeometryLook
  gridStyle: CSSProperties
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 按 `GAUGE_SIZE_BOUNDS` 里的一条读并夹一个尺寸。
 * @param raw 几何簇里的原值
 * @param bound 该尺寸的区间与缺省
 */
function readSize(
  raw: unknown,
  bound: { min: number; max: number; fallback: number },
): number {
  return clamp(readNumber(raw, bound.fallback), bound.min, bound.max)
}

/**
 * 五档几何的参数。
 * ⚠ 厚度走 `resolveThickness`：`0`、负数与非有限数都当「随形状」，属性面板清空那个
 * 数字输入框、JSON 里写 `null`、预设里写 `0` 落库形态各不相同但意思是同一个。
 * @param config 该节点落库的配置
 * @param shape 已收敛的形状
 */
function readGeometry(
  config: Record<string, unknown>,
  shape: GaugeShape,
): GaugeGeometryLook {
  const geometry = readRecord(config.geometry)
  const thickness = resolveThickness(shape, readNumber(geometry.thickness, 0))
  const arcSpan = clamp(
    readNumber(geometry.arcSpan, GAUGE_ARC_SPAN_DEFAULT),
    GAUGE_ARC_SPAN_MIN,
    GAUGE_ARC_SPAN_MAX,
  )
  return {
    thickness,
    arcSpan,
    tankWidth: readSize(geometry.tankWidth, GAUGE_SIZE_BOUNDS.tankWidth),
    tubeWidth: readSize(geometry.tubeWidth, GAUGE_SIZE_BOUNDS.tubeWidth),
    bulbSize: readSize(geometry.bulbSize, GAUGE_SIZE_BOUNDS.bulbSize),
    arcPath: arcPath(thickness, arcSpan),
  }
}

/**
 * 解析并夹取全部尺寸。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
function readNums(config: Record<string, unknown>): GaugeNums {
  return {
    gap: clamp(readNumber(config.gap, 10), 0, MAX_PAD),
    padX: clamp(readNumber(config.padX, 10), 0, MAX_PAD),
    padY: clamp(readNumber(config.padY, 6), 0, MAX_PAD),
    valueSize: clamp(readNumber(config.valueSize, 0), 0, MAX_VALUE_FONT),
    valueGlow: clamp(readNumber(config.valueGlow, 0), 0, MAX_GLOW),
    unitSize: clamp(readNumber(config.unitSize, 12), MIN_FONT, MAX_UNIT_FONT),
    labelSize: clamp(
      readNumber(config.labelSize, 12),
      MIN_FONT,
      MAX_LABEL_FONT,
    ),
    tickSize: clamp(
      readNumber(config.tickSize, 10),
      MIN_TICK_FONT,
      MAX_TICK_FONT,
    ),
  }
}

/**
 * 实际排布：`auto` 只有一个仪表时铺满，多个走网格。
 * @param config 该节点落库的配置
 * @param count 这一块真的画出来几个仪表
 */
function resolveLayout(
  config: Record<string, unknown>,
  count: number,
): GaugeGridLayout {
  const layout = readEnum(config.layout, GAUGE_LAYOUT_VALUES, 'auto')
  if (layout !== 'auto') return layout
  return count > 1 ? 'grid' : 'single'
}

/**
 * 外层容器的排布。
 * ⚠ 行走 `minmax(0, 1fr)`：不给的话仪表少时整排堆在顶上，卡片下半截空着。
 * @param nums 已夹取的尺寸
 * @param columns 列数档
 * @param layout 已收敛的排布
 */
function gridStyle(
  nums: GaugeNums,
  columns: GaugeColumns,
  layout: GaugeGridLayout,
): CSSProperties {
  const template =
    columns === 'auto'
      ? `repeat(auto-fit, minmax(${AUTO_MIN_COL}px, 1fr))`
      : `repeat(${columns}, minmax(0, 1fr))`
  return {
    display: 'grid',
    gridTemplateColumns: layout === 'single' ? 'minmax(0, 1fr)' : template,
    gridAutoRows: 'minmax(0, 1fr)',
    gap: `${nums.gap}px`,
    padding: `${nums.padY}px ${nums.padX}px`,
  }
}

/**
 * 几何那几个尺寸的变量。
 * ⚠ 厚度是 0 的两档（储罐、温度计）**不注入** `--gc-thickness`：注入了 `0px` 就再也
 * 落不回样式表里那档缺省，而那两档本来就不吃厚度。
 * @param geometry 已夹取的几何参数
 * @param shape 已收敛的形状
 */
function shapeVars(geometry: GaugeGeometryLook, shape: GaugeShape): GaugeVars {
  const vars: GaugeVars = {
    '--gc-tank-w': `${geometry.tankWidth}px`,
    '--gc-tube-w': `${geometry.tubeWidth}px`,
    '--gc-bulb': `${geometry.bulbSize}px`,
  }
  if (geometry.thickness > 0) {
    vars['--gc-thickness'] = `${geometry.thickness}px`
  }
  if (shape === 'tank') vars['--gc-outline'] = TANK_OUTLINE
  return vars
}

/**
 * 读数、单位、标签、刻度四段文字与两个填充色的变量。
 * @param config 该节点落库的配置
 * @param nums 已夹取的尺寸
 */
function textVars(config: Record<string, unknown>, nums: GaugeNums): GaugeVars {
  const tone = readEnum(config.labelTone, GAUGE_LABEL_TONE_VALUES, 'secondary')
  const fill = readTrimmedText(config.fillColor)
  const track = readTrimmedText(config.trackColor)
  const value = readTrimmedText(config.valueColor)
  const vars: GaugeVars = {
    '--gc-unit-size': `${nums.unitSize}px`,
    '--gc-label-size': `${nums.labelSize}px`,
    '--gc-label-color': GAUGE_LABEL_TONE_COLORS[tone],
    '--gc-tick-size': `${nums.tickSize}px`,
  }
  // 以下五项「没配 = 不写键」：注入了空串或一个兜底值，就再也回落不到
  // `_variants.scss` 里那档缺省——而三个颜色的缺省是逐档不同的（弧与条的空轨道取
  // `--surface-sunken`、粗轨道取 `--border-strong` 的 55%），一个数写不下
  if (fill !== '') vars['--gc-fill-color'] = fill
  if (track !== '') vars['--gc-track-color'] = track
  if (value !== '') vars['--gc-value-color'] = value
  if (nums.valueSize > 0) vars['--gc-value-size'] = `${nums.valueSize}px`
  if (nums.valueGlow > 0) vars['--gc-value-glow'] = `${nums.valueGlow}px`
  return vars
}

/** 已收敛的三个档位，类名与形态两处读同一份，免得缺省值在两边各写一遍。 */
interface GaugeModes {
  shape: GaugeShape
  fillStyle: GaugeFillStyle
  indicator: GaugeIndicator
  readoutPlace: GaugeReadoutPlace
}

/**
 * 三个既进类名又进形态的档位，只解析这一次。
 * ⚠ 各解析一遍的代价不是多跑几行，是缺省档在两处各写一份：改一处不改另一处时，
 * 类名说的是这一档、形态说的是另一档，而两边都不报错。
 * @param config 该节点落库的配置
 */
function readModes(config: Record<string, unknown>): GaugeModes {
  return {
    shape: readEnum(config.shape, GAUGE_SHAPE_VALUES, 'arc'),
    fillStyle: readEnum(config.fillStyle, GAUGE_FILL_STYLE_VALUES, 'solid'),
    indicator: readEnum(config.indicator, GAUGE_INDICATOR_VALUES, 'fill'),
    readoutPlace: readEnum(
      config.readoutPlace,
      GAUGE_READOUT_PLACE_VALUES,
      'center',
    ),
  }
}

/**
 * 一档一个修饰类；同一份类名既挂在卡片根上也挂在每个仪表上，容器与仪表因此吃同一套档位。
 * ⚠ 标签位置**不在这里**：它只有在标签真渲染时才准挂，而那是逐个仪表才知道的事。
 * @param config 该节点落库的配置
 * @param layout 已收敛的排布
 * @param modes 已收敛的形状、填充与读数位置
 */
function classesOf(
  config: Record<string, unknown>,
  layout: GaugeGridLayout,
  modes: GaugeModes,
): string[] {
  return [
    `gc--layout-${layout}`,
    `gc--shape-${modes.shape}`,
    `gc--fill-${modes.fillStyle}`,
    `gc--ind-${modes.indicator}`,
    `gc--read-${modes.readoutPlace}`,
    `gc--unit-${readEnum(config.unitPlace, GAUGE_UNIT_PLACE_VALUES, 'baseline')}`,
  ]
}

/**
 * 读一块仪表卡的形态。
 * @param config 该节点落库的配置（已铺清单缺省）
 * @param count 这一块真的画出来几个仪表，`auto` 排布靠它二选一
 */
export function readGaugeLook(
  config: Record<string, unknown>,
  count = 0,
): GaugeLook {
  const layout = resolveLayout(config, count)
  const modes = readModes(config)
  const nums = readNums(config)
  const geometry = readGeometry(config, modes.shape)
  const columns = readEnum(config.columns, GAUGE_COLUMN_VALUES, 'auto')
  return {
    classes: classesOf(config, layout, modes),
    vars: { ...textVars(config, nums), ...shapeVars(geometry, modes.shape) },
    nums,
    layout,
    ...modes,
    colorStops: readColorStops(config.colorStops),
    labelPlace: readEnum(config.labelPlace, GAUGE_LABEL_PLACE_VALUES, 'below'),
    geometry,
    gridStyle: gridStyle(nums, columns, layout),
  }
}
