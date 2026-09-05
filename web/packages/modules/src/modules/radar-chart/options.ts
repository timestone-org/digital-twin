/**
 * @fileoverview radar-chart 的取值表：描边/填充两档画法与多边形/圆形两档网格形状，
 * 外加填充不透明度、环数与「几根轴才画得成一个面」这几档区间常量。
 * 清单的下拉与取值层、渲染层的白名单共用这一份。
 * ⚠ 各抄一份的话，加一档必然有一边漏，表现是面板能选、渲染静默回落缺省档——
 * 「选了没反应」最常见的来源。
 * ⚠ 表是 `as const` 只读数组，而 `ConfigField.options` 要的是可变数组：清单里写
 * `options: [...RADAR_STYLES]` 摊一次。直接赋值红在 TS4104，且只有 `vue-tsc` 看得见——
 * `vitest` 的 esbuild 不做类型检查，整包测试会在它红着的时候全绿。
 */
import type { ConfigOption } from '@dt/contracts'

/** 取值数组：`readEnum` 的白名单直接从选项表推，不再手抄一遍。 */
function valuesOf<T extends string>(
  options: readonly { value: T; label: string }[],
): readonly T[] {
  return options.map((option) => option.value)
}

/**
 * 两档画法：只描边，或再铺一层半透明的面。
 * ⚠ 两组叠在一起时填充档会互相盖住，靠 `areaOpacity` 调；调到 100 时后画的那一组
 * 会把先画的整个盖掉，故区间上限留在 `RADAR_AREA_OPACITY_MAX`。
 */
export const RADAR_STYLES = [
  { value: 'line', label: '描边' },
  { value: 'area', label: '填充' },
] as const satisfies readonly ConfigOption[]

export type RadarStyle = (typeof RADAR_STYLES)[number]['value']
export const RADAR_STYLE_VALUES = valuesOf(RADAR_STYLES)

/**
 * 网格形状：逐轴连成的多边形，或一圈同心圆。
 * ⚠ 圆形网格读不出「一共几根轴」——轴数本身是这块图的信息量之一，故缺省是多边形。
 */
export const RADAR_SHAPES = [
  { value: 'polygon', label: '多边形' },
  { value: 'circle', label: '圆形' },
] as const satisfies readonly ConfigOption[]

export type RadarShape = (typeof RADAR_SHAPES)[number]['value']
export const RADAR_SHAPE_VALUES = valuesOf(RADAR_SHAPES)

/** 填充不透明度按百分比配，渲染时除以 100 交给 echarts。 */
export const RADAR_AREA_OPACITY_MIN = 0
export const RADAR_AREA_OPACITY_MAX = 80
export const RADAR_AREA_OPACITY_DEFAULT = 25

/** 百分比 → echarts 的 0–1 不透明度，除的就是这个数。 */
export const PERCENT_FULL = 100

/** 网格环数（`radar.splitNumber`）。 */
export const RADAR_SPLIT_MIN = 1
export const RADAR_SPLIT_MAX = 10
export const RADAR_SPLIT_DEFAULT = 4

/**
 * 画得成一个面至少要几根轴。
 * ⚠ 两根轴的雷达是一条线段、一根轴是一个点：几何上都还在，但「多维形状」这件事
 * 已经没有了，看图的人会把那条线读成一条趋势线。少于这一档一律走空态文案。
 */
export const RADAR_MIN_AXES = 3

/** 逐轴量程的出厂值：0–100 的百分制，绝大多数评价表直接可用。 */
export const RADAR_AXIS_MIN_DEFAULT = 0
export const RADAR_AXIS_MAX_DEFAULT = 100
