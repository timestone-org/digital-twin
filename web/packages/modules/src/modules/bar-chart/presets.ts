/**
 * @fileoverview bar-chart 的五套外观预设：竖排名、横排名、分时堆叠、构成占比、正负对比。
 *
 * ⚠ 每套都把观感键写全，且顺序与 `configSchema` 的书写序一致。应用预设是**浅合并**：
 * 少写一个键，上一套留在 configJson 里的那个值就原样残留，而点亮判定做的是子集
 * 比较、照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `valueSource` 一套都不写：它决定这一块读哪一路绑定，是接线不是观感；
 * 一套「换个样子」把它从历史档翻回实时档，整屏曲线会当场变成一排单值柱。
 * ⚠ `unit` / `precision` / `xAxisName` / `yAxisName` / `refLines` 同理一套都不写：
 * 它们摆在样式与坐标轴分段里，语义却是这块屏的数值口径与用户写死的阈值，
 * 一套观感把它们抹成空串等于让配好的东西凭空消失。
 * ⚠ `title` / `items` / `emptyText` 三个内容键由 `contentKeys` 挡着，写了会把
 * 用户配好的数据组整片抹掉。
 * ⚠ 堆叠那两套把圆角调回 0：堆叠时每一段都被圆角切一刀，堆高的几段之间会露出缝。
 */
import type { ConfigPreset } from '@dt/contracts'

import { BAR_RADIUS_DEFAULT } from './options'

/** 五套共用的字号与标签色：预设换的是版式，不是字号体系。 */
const FONTS = {
  axisLabelFontSize: 11,
  axisNameFontSize: 11,
  legendFontSize: 11,
  tooltipFontSize: 12,
  labelFontSize: 11,
  labelColor: '',
}

/** 五套共用的渐变口径：缺省纯色，末端色留空由主色派生。 */
const FILL = {
  palette: [],
  barGradient: false,
  barGradientTo: '',
  barTopAlpha: 0.45,
  barOpacity: 1,
}

export const BAR_CHART_PRESETS: ConfigPreset[] = [
  {
    id: 'rank-bars',
    label: '竖排名',
    hint: '并排竖柱 + 柱顶读数，一眼看出谁高谁低；实时档最常用的一套。',
    config: {
      chartStyle: 'grouped',
      barWidth: null,
      barRadius: BAR_RADIUS_DEFAULT,
      ...FILL,
      xLabelInterval: '',
      yScale: false,
      boundaryGap: true,
      showDataZoom: false,
      showLegend: true,
      showTooltip: true,
      showValueLabel: true,
      animation: false,
      animationDuration: 600,
      ...FONTS,
    },
  },
  {
    id: 'rank-horizontal',
    label: '横排名',
    hint: '类目转到左边，名字长也排得开；条右侧写读数。窄高的块里用这一套。',
    config: {
      chartStyle: 'horizontal',
      barWidth: 18,
      barRadius: BAR_RADIUS_DEFAULT,
      ...FILL,
      xLabelInterval: '0',
      yScale: false,
      boundaryGap: true,
      showDataZoom: false,
      showLegend: false,
      showTooltip: true,
      showValueLabel: true,
      animation: false,
      animationDuration: 600,
      ...FONTS,
    },
  },
  {
    id: 'stacked-hours',
    label: '分时堆叠',
    hint: '按时间桶堆起来看总量与构成，配缩放条拖着看；桶多时标签自动抽稀。',
    config: {
      chartStyle: 'stacked',
      barWidth: null,
      // 堆叠时圆角会在段与段之间切出缝
      barRadius: 0,
      ...FILL,
      xLabelInterval: '',
      yScale: false,
      boundaryGap: true,
      showDataZoom: true,
      showLegend: true,
      showTooltip: true,
      // 堆叠段里每一段都写数会糊成一片，读数交给提示框
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
      ...FONTS,
    },
  },
  {
    id: 'share-percent',
    label: '构成占比',
    hint: '每一列归一到 100%，只看构成不看总量。⚠ 一整列全缺时那一列整列留空，不画成 0%。',
    config: {
      chartStyle: 'percent',
      barWidth: null,
      barRadius: 0,
      ...FILL,
      xLabelInterval: '',
      yScale: false,
      boundaryGap: true,
      showDataZoom: false,
      showLegend: true,
      showTooltip: true,
      showValueLabel: true,
      animation: false,
      animationDuration: 600,
      ...FONTS,
    },
  },
  {
    id: 'balance-diverging',
    label: '正负对比',
    hint: '值轴按最大绝对值向两侧对称铺开，回馈与用电各占一半；负值照实向下画。',
    config: {
      chartStyle: 'diverging',
      barWidth: null,
      barRadius: BAR_RADIUS_DEFAULT,
      ...FILL,
      xLabelInterval: '',
      // 对称量程已经把 0 摆在正中，再开「不强制含 0」会把两侧一起推走
      yScale: false,
      boundaryGap: true,
      showDataZoom: false,
      showLegend: true,
      showTooltip: true,
      showValueLabel: true,
      animation: false,
      animationDuration: 600,
      ...FONTS,
    },
  },
]
