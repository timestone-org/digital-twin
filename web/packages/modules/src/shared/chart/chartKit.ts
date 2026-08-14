/**
 * @fileoverview 图表族共用的 option 片段构建器：全是纯函数，入参只有主题与配置，
 * 不读 DOM、不留副作用。族的 option 因此只写「数据整形 + series 类型」。
 * 颜色只来自 `theme` 或经 `resolveColor` 解析的 `var(--x)`，取不到就省略该键、
 * 交回 echarts 默认——不伪造颜色。
 */
import { readArray, readNumber, readRecord, readText } from '../config'
import { NO_DATA, isPresent } from '../format'
import type { ECOption } from './echarts'
import {
  divergingStops,
  resolveColor,
  sequentialStops,
  withAlpha,
  withColor,
  type ChartTheme,
} from './theme'

/** CSS 变量名 → 实际色值；取不到给空串。 */
export type ColorResolver = (name: string) => string

/** 可 spread 进 option 的属性袋。 */
export type OptionFragment = Record<string, unknown>

/**
 * 族出 option 的签名：主题与取色器由壳自渲染根派生后喂进来，
 * `full` 是「这次是不是全量重建」，多数族用不上它。
 */
export type ChartBuild = (
  theme: ChartTheme,
  resolve: ColorResolver,
  full: boolean,
) => ECOption

/**
 * 小数位钳到面板契约的 [0,6]。
 * ⚠ 手编的 config 绕得过面板的 min/max，越界值会让 toLocaleString 抛 RangeError。
 * @param precision 配置里的小数位
 */
function clampPrecision(precision: number | null | undefined): number {
  if (precision == null || !Number.isFinite(precision)) return 2
  return Math.min(6, Math.max(0, Math.trunc(precision)))
}

/**
 * 数值 + 单位文本；缺值 → 「—」。默认最多 2 位、去尾随零、无千分位。
 * @param value 原值
 * @param precision 小数位，null 走默认
 * @param unit 单位后缀
 */
export function valueText(
  value: unknown,
  precision: number | null,
  unit = '',
): string {
  if (!isPresent(value)) return NO_DATA
  const base = value.toLocaleString('en-US', {
    maximumFractionDigits: clampPrecision(precision),
    useGrouping: false,
  })
  return `${base}${unit}`
}

/**
 * HTML 转义，**只给 tooltip 的函数 formatter 用**。
 * ⚠ echarts 把函数 formatter 的返回值原样 `innerHTML` 进去，绕开一切清洗；
 * 而拼进去的类目名 / 系列名 / 单位全是编辑器里的自由输入，于是一个能编辑大屏的
 * 用户可以让只读访客悬停即中招。
 * ⚠ 别拿它转义 series label / axisLabel：canvas 不解析 HTML 实体，
 * 单位里的 `&` 会显示成字面量 `&amp;`。
 * ⚠ 只有字符串与数字算文本：别的类型拼出来是「[object Object]」这种没人看得懂的东西，
 * 与其显示它不如什么都不显示。
 * @param raw 待转义的文本
 */
export function escapeHtml(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return ''
  const table: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return String(raw).replace(/[&<>"']/g, (char) => table[char] ?? char)
}

/**
 * 提示框基础样式；消费方自行补 `trigger` 与 `formatter`。
 * @param theme 当前主题色
 * @param opts 字号覆盖
 */
export function tooltipStyle(
  theme: ChartTheme,
  opts: { fontSize?: number } = {},
): OptionFragment {
  return {
    backgroundColor: theme.tooltipBg || undefined,
    borderColor: theme.tooltipBorder || undefined,
    borderWidth: theme.tooltipBorder ? 1 : 0,
    textStyle: { fontSize: opts.fontSize ?? 12, ...withColor(theme.text) },
  }
}

/** 图例的位置与朝向覆盖。 */
export interface LegendOptions {
  bottom?: number
  top?: number
  left?: number | string
  right?: number | string
  orient?: 'horizontal' | 'vertical'
  data?: unknown[]
  selectedMode?: boolean
  fontSize?: number
}

/**
 * 图例样式，缺省底部横向滚动。
 * ⚠ left 与 right 互不兜底：都给了 echarts 只认先解析到的那个。
 * @param theme 当前主题色
 * @param opts 位置、朝向与数据
 */
export function legendStyle(
  theme: ChartTheme,
  opts: LegendOptions = {},
): OptionFragment {
  const fragment: OptionFragment = {
    type: 'scroll',
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 6,
    textStyle: {
      fontSize: opts.fontSize ?? 11,
      ...withColor(theme.textMuted),
    },
  }
  if (opts.orient) fragment.orient = opts.orient
  if (opts.top != null) fragment.top = opts.top
  else fragment.bottom = opts.bottom ?? 0
  if (opts.left != null) fragment.left = opts.left
  if (opts.right != null) fragment.right = opts.right
  if (opts.data) fragment.data = opts.data
  if (opts.selectedMode != null) fragment.selectedMode = opts.selectedMode
  return fragment
}

/**
 * grid 内边距；`legend:true` 时给底部图例让出位置。四边收百分比串。
 * @param opts 四边留白与是否有图例
 */
export function cartesianGrid(
  opts: {
    top?: number | string
    right?: number | string
    bottom?: number | string
    left?: number | string
    legend?: boolean
    containLabel?: boolean
  } = {},
): OptionFragment {
  return {
    top: opts.top ?? 16,
    right: opts.right ?? 16,
    bottom: opts.bottom ?? (opts.legend ? 26 : 6),
    left: opts.left ?? 6,
    containLabel: opts.containLabel ?? true,
  }
}

/** 轴的字号与配色覆盖（双轴图才需要逐轴各配一份）。 */
export interface AxisTextOptions {
  name?: string
  labelFontSize?: number
  nameFontSize?: number
  labelColor?: string
  nameColor?: string
}

/**
 * 类目轴（横向柱/折线的 x 轴，横向条形时用作 y 轴）。
 * ⚠ `interval` 不给时不写这个键：写了 `undefined` 与写 0 一样会关掉自动抽稀。
 * @param theme 当前主题色
 * @param data 类目
 * @param opts 轴文本与抽稀间隔
 */
export function categoryAxis(
  theme: ChartTheme,
  data: unknown[],
  opts: AxisTextOptions & {
    boundaryGap?: boolean
    inverse?: boolean
    interval?: number | 'auto'
  } = {},
): OptionFragment {
  const axisLabel: OptionFragment = {
    fontSize: opts.labelFontSize ?? 11,
    ...withColor(opts.labelColor || theme.textMuted),
  }
  if (opts.interval != null) axisLabel.interval = opts.interval
  return {
    type: 'category',
    data,
    name: opts.name,
    boundaryGap: opts.boundaryGap ?? true,
    inverse: opts.inverse,
    axisLabel,
    axisLine: { lineStyle: { ...withColor(theme.axisLine) } },
    axisTick: { show: false },
    nameTextStyle: {
      fontSize: opts.nameFontSize ?? 11,
      ...withColor(opts.nameColor || theme.textMuted),
    },
  }
}

/**
 * 数值轴。`splitLine:false` 关分隔线，`scale:true` 不强制含 0
 * （高基线上的窄幅波动只有这样才看得出来）。
 * @param theme 当前主题色
 * @param opts 量程、分隔线与轴文本
 */
export function valueAxis(
  theme: ChartTheme,
  opts: AxisTextOptions & {
    min?: number | string
    max?: number | string
    splitLine?: boolean
    scale?: boolean
    axisLabelFormatter?: (value: number) => string
  } = {},
): OptionFragment {
  return {
    type: 'value',
    name: opts.name,
    min: opts.min,
    max: opts.max,
    scale: opts.scale,
    axisLabel: {
      fontSize: opts.labelFontSize ?? 11,
      ...withColor(opts.labelColor || theme.textMuted),
      formatter: opts.axisLabelFormatter,
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine:
      opts.splitLine === false
        ? { show: false }
        : { lineStyle: { ...withColor(theme.splitLine) } },
    nameTextStyle: {
      fontSize: opts.nameFontSize ?? 11,
      ...withColor(opts.nameColor || theme.textMuted),
    },
  }
}

/**
 * 「值是否为 0」。只认数字 0 与能解析成 0 的非空数字串；
 * 缺值不算 0——那该由 formatter 显示「—」，不能被 hideZero 一起吞掉。
 * @param value 数据项的值
 */
function isZeroValue(value: unknown): boolean {
  if (typeof value === 'number') return value === 0
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value) === 0
  }
  return false
}

/** 数值标签的样式与取值口径。 */
export interface DataLabelOptions {
  show?: boolean
  position?: string
  formatter?: (params: { value: unknown }) => string
  color?: string
  fontSize?: number
  /** 已解析的字体栈——canvas 不认 `var(--x)`，别把变量名原样丢进来。 */
  fontFamily?: string
  /** 开了之后 0 值渲染成空串，包在自定义 formatter 外面。 */
  hideZero?: boolean
}

/**
 * series 上的数值标签，缺值显「—」。
 * @param theme 当前主题色
 * @param opts 位置、字体与 0 值处理
 */
export function dataLabel(
  theme: ChartTheme,
  opts: DataLabelOptions = {},
): OptionFragment {
  const base = opts.formatter
  const fallback = (params: { value: unknown }): string =>
    isPresent(params.value) ? String(params.value) : NO_DATA
  const formatter = opts.hideZero
    ? (params: { value: unknown }) =>
        isZeroValue(params.value) ? '' : (base ?? fallback)(params)
    : base
  const fragment: OptionFragment = {
    show: opts.show ?? true,
    position: opts.position ?? 'top',
    fontSize: opts.fontSize ?? 11,
    ...withColor(opts.color || theme.textMuted),
    formatter,
  }
  if (opts.fontFamily) fragment.fontFamily = opts.fontFamily
  return fragment
}

/** 全透明关键字。它没有色相与明度，换肤影响不到它，不算色值字面量。 */
const TRANSPARENT = 'transparent'

/**
 * 线性渐变色值对象，供 `areaStyle.color` / `itemStyle.color` 用。
 * @param stops `[offset, color]` 停靠点，offset 0→1
 * @param dir 'v' 上→下（缺省），'h' 左→右
 */
export function linearGradient(
  stops: [number, string][],
  dir: 'v' | 'h' = 'v',
): OptionFragment {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: dir === 'h' ? 1 : 0,
    y2: dir === 'h' ? 0 : 1,
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
    // 渐变坐标相对图形自身包围盒，不是整块画布
    global: false,
  }
}

/**
 * 由单一主色派生「顶端半透 → 底端全透」的竖向面积渐变。
 * 缺色 → undefined，调用方据此省掉整个 areaStyle。
 * ⚠ 主色若是 withAlpha 解析不了的写法（`hsl()` / 命名色），退回「主色 → 透明」，
 * 否则两端同色会画成一块实心。
 * @param color 已解析的主色
 * @param topAlpha 顶端不透明度
 */
export function areaFade(
  color: string,
  topAlpha = 0.3,
): OptionFragment | undefined {
  const base = (color ?? '').trim()
  if (!base) return undefined
  const top = withAlpha(base, topAlpha)
  const bottom = withAlpha(base, 0)
  const usable = top.startsWith('rgba(') && bottom.startsWith('rgba(')
  const stops: [number, string][] = usable
    ? [
        [0, top],
        [1, bottom],
      ]
    : [
        [0, base],
        [1, TRANSPARENT],
      ]
  return linearGradient(stops, 'v')
}

/** 一条参考线（阈值线 / 目标线 / 基线）。 */
export interface MarkLineRef {
  /** 画在哪个刻度上。 */
  value: number
  /** 线旁文字；留空则不画 label，而不是画一行空字符串。 */
  label?: string
  /** 线与文字的颜色；留空取主题强调色。 */
  color?: string
  lineType?: 'solid' | 'dashed' | 'dotted'
  fontSize?: number
  /** 'y' 水平线（绑值轴，缺省）/ 'x' 垂直线（绑类目轴）。 */
  axis?: 'y' | 'x'
}

/**
 * 整个 `series.markLine` 的值。逐项把 label 与线型写在 data 项上，
 * 顶层只放对所有参考线都成立的两条：不拦鼠标、两端不画箭头。
 * @param theme 当前主题色
 * @param refs 一条或多条参考线
 */
export function markLineRef(
  theme: ChartTheme,
  refs: MarkLineRef | MarkLineRef[],
): OptionFragment {
  const items = Array.isArray(refs) ? refs : [refs]
  return {
    silent: true,
    symbol: 'none',
    data: items.map((ref) => {
      const color = ref.color || theme.accent
      return {
        [ref.axis === 'x' ? 'xAxis' : 'yAxis']: ref.value,
        label: ref.label
          ? {
              formatter: ref.label,
              fontSize: ref.fontSize ?? 10,
              ...withColor(color),
            }
          : { show: false },
        lineStyle: { type: ref.lineType ?? 'dashed', ...withColor(color) },
      }
    }),
  }
}

/**
 * 滑动条 + 内置缩放，成对返回后 spread 进 `dataZoom`。
 * @param theme 当前主题色
 * @param opts 朝向、初始区间与绑定的轴
 */
export function dataZoomSlider(
  theme: ChartTheme,
  opts: {
    orient?: 'horizontal' | 'vertical'
    start?: number
    end?: number
    xAxisIndex?: number | number[]
    yAxisIndex?: number | number[]
  } = {},
): OptionFragment[] {
  const orient = opts.orient ?? 'horizontal'
  const vertical = orient === 'vertical'
  const range = { start: opts.start ?? 0, end: opts.end ?? 100 }
  const axisBind = vertical
    ? { yAxisIndex: opts.yAxisIndex ?? 0 }
    : { xAxisIndex: opts.xAxisIndex ?? 0 }
  // 横竖各写各的几何键，不写对方那一档——两档都写 echarts 会按后解析的那个摆
  const box = vertical ? { width: 14 } : { height: 14, bottom: 4 }
  return [
    {
      type: 'slider',
      orient,
      ...axisBind,
      ...range,
      ...box,
      borderColor: theme.splitLine || undefined,
      textStyle: { fontSize: 10, ...withColor(theme.textMuted) },
    },
    { type: 'inside', orient, ...axisBind, ...range },
  ]
}

/**
 * 连续型 visualMap（热力 / treemap）。色阶从主题派生，`diverging` 取发散色。
 * ⚠ 给了 top 就不再兜底 bottom：两个都写 echarts 只认一个。
 * @param theme 当前主题色
 * @param opts 量程、位置与色阶覆盖
 */
export function visualMapContinuous(
  theme: ChartTheme,
  opts: {
    min: number
    max: number
    diverging?: boolean
    orient?: 'horizontal' | 'vertical'
    left?: string | number
    right?: string | number
    top?: string | number
    bottom?: string | number
    calculable?: boolean
    dimension?: number
    colors?: string[]
  },
): OptionFragment {
  const colors =
    opts.colors ??
    (opts.diverging ? divergingStops(theme) : sequentialStops(theme))
  return {
    type: 'continuous',
    min: opts.min,
    max: opts.max,
    calculable: opts.calculable ?? true,
    dimension: opts.dimension,
    orient: opts.orient ?? 'horizontal',
    left: opts.left ?? 'center',
    right: opts.right,
    bottom: opts.top != null ? opts.bottom : (opts.bottom ?? 0),
    top: opts.top,
    itemWidth: 10,
    itemHeight: 80,
    textStyle: { fontSize: 10, ...withColor(theme.textMuted) },
    inRange: colors.length ? { color: colors } : undefined,
  }
}

/**
 * 动画开关，spread 进 option 顶层。缺省即关：实时刷新不该带滑动与形变。
 * @param config 模块整份配置
 */
export function animationOpts(config: Record<string, unknown>): OptionFragment {
  const duration = readNumber(config.animationDuration, 600)
  return {
    animation: config.animation === true,
    animationDuration: duration >= 0 ? duration : 600,
    animationEasing: 'cubicOut',
  }
}

/** 透明背景：卡片框背景由 host 提供，图表本体不再铺一层。 */
export const TRANSPARENT_BG = { backgroundColor: 'transparent' } as const

/**
 * 自定义色板（`config.palette` 每行一色）→ 解析后的非空色数组；
 * 一行都没有就回退主题色板。
 * @param config 模块整份配置
 * @param theme 当前主题色
 * @param resolve 变量名 → 实际色值
 */
export function resolvePalette(
  config: Record<string, unknown>,
  theme: ChartTheme,
  resolve: ColorResolver,
): string[] {
  const override = readArray(config.palette)
    .map((row) => resolveColor(readText(readRecord(row).color), resolve))
    .filter((color) => !!color)
  return override.length ? override : theme.palette
}

/**
 * 把 `config.unit` 与 `config.precision` 绑进一个取值器，
 * 供 tooltip 与数值标签共用同一套口径。
 * @param config 模块整份配置
 */
export function textFactory(
  config: Record<string, unknown>,
): (value: unknown) => string {
  const unit = readText(config.unit)
  const precision = readNumber(config.precision, 2)
  return (value: unknown) => valueText(value, precision, unit)
}
