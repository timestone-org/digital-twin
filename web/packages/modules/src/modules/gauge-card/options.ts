/**
 * @fileoverview gauge-card 的取值表：形状、排布、填充、读数、单位、标签各一组，
 * 外加两张按档取值的映射表（标签层级 → 主题变量、形状 → 缺省厚度）。
 * 每一档都对回参考仓 entity-gauge / target-progress 两份源码，源码画不出来的档单独标注。
 * ⚠ 清单与渲染**共用这一份**。各抄一份的话，加一档必然有一边漏，表现是面板能选、
 * 渲染静默回落默认档——「选了没反应」最常见的来源。
 * ⚠ 表是 `as const` 的只读数组，而 `ConfigField.options` 要的是可变数组：清单里写
 * `options: [...GAUGE_SHAPES]` 摊一次。直接赋值红在 TS4104，且只有 `vue-tsc` 看得见——
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
 * 五档几何。前四档取自参考仓 entity-gauge 的 `VALID_STYLES`（档名逐字相同），
 * `track` 是参考仓 target-progress 那条 18px 粗轨道——它与前四档共用
 * 「量程 → 百分比 → 填充」这条链，所以是同一个模块的第五档而不是第五个模块。
 */
export const GAUGE_SHAPES = [
  { value: 'arc', label: '弧度盘' },
  { value: 'linear', label: '横向条' },
  { value: 'track', label: '目标轨道' },
  { value: 'tank', label: '储罐' },
  { value: 'thermometer', label: '温度计' },
] as const satisfies readonly ConfigOption[]

export type GaugeShape = (typeof GAUGE_SHAPES)[number]['value']
export const GAUGE_SHAPE_VALUES = valuesOf(GAUGE_SHAPES)

/** 三种排布容器。`auto` = 只有一项时铺满、多项时按网格。 */
export const GAUGE_LAYOUTS = [
  { value: 'auto', label: '自动' },
  { value: 'single', label: '单个仪表' },
  { value: 'grid', label: '网格' },
] as const satisfies readonly ConfigOption[]

export type GaugeLayout = (typeof GAUGE_LAYOUTS)[number]['value']
export const GAUGE_LAYOUT_VALUES = valuesOf(GAUGE_LAYOUTS)

/**
 * 网格列数，`auto` = 按最小列宽自适应铺满。
 * ⚠ 档值一律是**字符串**：`readEnum` 只认字面量相等，预设或脏配置里写 `columns: 2`
 * 判不中，静默回落 `'auto'`——墙上少了列数，两边都不报错。
 */
export const GAUGE_COLUMNS = [
  { value: 'auto', label: '自动' },
  { value: '1', label: '1 列' },
  { value: '2', label: '2 列' },
  { value: '3', label: '3 列' },
  { value: '4', label: '4 列' },
  { value: '5', label: '5 列' },
  { value: '6', label: '6 列' },
] as const satisfies readonly ConfigOption[]

export type GaugeColumns = (typeof GAUGE_COLUMNS)[number]['value']
export const GAUGE_COLUMN_VALUES = valuesOf(GAUGE_COLUMNS)

/**
 * 填充怎么上色。两档都有出处：参考仓 entity-gauge 的弧与条是纯色描边/纯色底，
 * 储罐与 target-progress 的轨道是渐变（前者 `0deg` 向上淡出，后者 `90deg` 向右加深）。
 */
export const GAUGE_FILL_STYLES = [
  { value: 'solid', label: '纯色' },
  { value: 'gradient', label: '渐变' },
] as const satisfies readonly ConfigOption[]

export type GaugeFillStyle = (typeof GAUGE_FILL_STYLES)[number]['value']
export const GAUGE_FILL_STYLE_VALUES = valuesOf(GAUGE_FILL_STYLES)

/**
 * 主读数显示什么。
 * ⚠ `percent` 是**量程百分比**（`normalizePercent`，钳在 0–100），不是完成率：
 * 完成率是「值 ÷ 目标」、可以超过 100%，只出现在轨道内那个 pill 上（`showPercent`）。
 * 同一张卡上两个「百分比」不是一个数，混用不报错，墙上只是数字对不上。
 * ⚠ `value` / `percent` 逐字取自参考仓 entity-gauge 的 `display` 两档；`both` 对应
 * target-progress 那个 pill 的「值 + 完成率」文本；`none` 无参考画法，是留给
 * 「一排纯图形」的一档。
 */
export const GAUGE_READOUTS = [
  { value: 'value', label: '原始值' },
  { value: 'percent', label: '量程百分比' },
  { value: 'both', label: '值 + 百分比' },
  { value: 'none', label: '不显示' },
] as const satisfies readonly ConfigOption[]

export type GaugeReadout = (typeof GAUGE_READOUTS)[number]['value']
export const GAUGE_READOUT_VALUES = valuesOf(GAUGE_READOUTS)

/**
 * 读数摆在图形的哪儿。
 * ⚠ `beside` 在五档形状上落点不同，这是参考源码本身的形态而不是取值层能收敛的：
 * 温度计是读数列在管的右侧（`.eg-thermo-wrap` 横向 flex），而横向条与粗轨道的轨道
 * 要吃满整行，读数只能落在轨道**上方**那一行（`.eg-linear-main` 与 `.tp-head` 都是这样）。
 * ⚠ `center` 取自弧度盘与储罐的居中读数（两处都是 `position:absolute; inset:0` 居中）；
 * `below` 无参考画法，是 `beside` 的竖排对偶。
 */
export const GAUGE_READOUT_PLACES = [
  { value: 'center', label: '图形中央' },
  { value: 'beside', label: '图形旁边' },
  { value: 'below', label: '图形下方' },
] as const satisfies readonly ConfigOption[]

export type GaugeReadoutPlace = (typeof GAUGE_READOUT_PLACES)[number]['value']
export const GAUGE_READOUT_PLACE_VALUES = valuesOf(GAUGE_READOUT_PLACES)

/**
 * 单位摆在哪儿：两档都与读数同基线，差的只是那一道小间隙。
 * ⚠ 参考仓 entity-gauge 根本没有独立的单位节点——它把单位**拼进读数字符串**里
 * （`${num}${unit}`），所以那四档在参考仓里没有自己的单位字号与颜色，等于恒 `attached`。
 * 独立单位只有 target-progress 有（`.tp-unit`：13px、次要色、与读数隔 5px），那是 `baseline`。
 */
export const GAUGE_UNIT_PLACES = [
  { value: 'baseline', label: '读数右侧' },
  { value: 'attached', label: '紧跟读数' },
] as const satisfies readonly ConfigOption[]

export type GaugeUnitPlace = (typeof GAUGE_UNIT_PLACES)[number]['value']
export const GAUGE_UNIT_PLACE_VALUES = valuesOf(GAUGE_UNIT_PLACES)

/**
 * 标签相对读数的位置。
 * ⚠ 这一档只管摆在哪儿，不管显不显示：没有标签文字时整行不渲染，档位类名也不挂。
 * ⚠ 没有「隐藏」这一档：要藏就把这一项的 `label` 留空，代价是绑点面板上这一行
 * 也跟着没了名字（与 info-card 同一处收敛）。
 * ⚠ 四档里 `right` 是参考仓 entity-gauge 横向条那一档的画法（`.eg-label--inline`：
 * 与读数同基线、左边距 6px、11px），`left` 是 target-progress 头行的标题位，
 * `below` 是弧度盘/储罐/温度计的副标题位；`above` 无参考画法。
 */
export const GAUGE_LABEL_PLACES = [
  { value: 'above', label: '读数上方' },
  { value: 'below', label: '读数下方' },
  { value: 'left', label: '读数左侧' },
  { value: 'right', label: '读数右侧' },
] as const satisfies readonly ConfigOption[]

export type GaugeLabelPlace = (typeof GAUGE_LABEL_PLACES)[number]['value']
export const GAUGE_LABEL_PLACE_VALUES = valuesOf(GAUGE_LABEL_PLACES)

/** 标签的文字层级。 */
export const GAUGE_LABEL_TONES = [
  { value: 'secondary', label: '次要' },
  { value: 'primary', label: '正文' },
  { value: 'title', label: '标题' },
  { value: 'muted', label: '弱化' },
] as const satisfies readonly ConfigOption[]

export type GaugeLabelTone = (typeof GAUGE_LABEL_TONES)[number]['value']
export const GAUGE_LABEL_TONE_VALUES = valuesOf(GAUGE_LABEL_TONES)

/** 文字层级 → 主题变量。 */
export const GAUGE_LABEL_TONE_COLORS: Record<GaugeLabelTone, string> = {
  secondary: 'var(--text-secondary)',
  primary: 'var(--text-primary)',
  title: 'var(--text-title)',
  muted: 'var(--text-disabled)',
}

/** 进度厚度的可配区间，与参考仓 entity-gauge 那个数字输入框的 `min`/`max` 同值。 */
export const GAUGE_THICKNESS_MIN = 2
export const GAUGE_THICKNESS_MAX = 24

/**
 * 形状 → 缺省厚度（`geometry.thickness` 配 0 时取这里的值）。
 * ⚠ 弧 9 / 条 12 逐字取自参考仓 entity-gauge 的 `style === 'linear' ? 12 : 9`，
 * 轨道 18 取自 target-progress 的 `.tp-track { height: 18px }`。
 * ⚠ 储罐与温度计记 0 = **这两档不吃厚度**：它们的粗细由 `geometry.tankWidth` /
 * `tubeWidth` 管，参考仓那个厚度字段也只对弧与条可见。照抄「非 linear 即 9」会给
 * 这两档算出一个谁也用不上的 9，读起来像是漏配了。
 */
export const GAUGE_SHAPE_THICKNESS: Record<GaugeShape, number> = {
  arc: 9,
  linear: 12,
  track: 18,
  tank: 0,
  thermometer: 0,
}
