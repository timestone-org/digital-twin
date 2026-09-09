/**
 * @fileoverview pie-chart 的四套配置预设：能源构成的粗环、占比实心饼、按大小排的玫瑰，
 * 以及不带图例的紧凑环。
 *
 * ⚠ 每套都把观感键写全，且顺序与 `configSchema` 的书写序一致。应用预设是**浅合并**：
 * 少写一个键，上一套留在 configJson 里的那个值就原样残留，而点亮判定做的是子集
 * 比较、照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `unit` 与 `precision` 两个键刻意一套都不写：它们摆在「样式」分段里，语义却是
 * 这块屏的数值口径（kWh 就是 kWh），一套观感把它们抹成空串等于让用户配好的单位
 * 在换个样子时消失。
 * ⚠ 预设会有意改变环心读数口径，属性面板会在提示中明确说明内容
 * 覆盖风险。`title` / `slices` / `emptyText` / `centerUnit` 不由预设修改。
 * ⚠ 关掉图例的那一套要在 `hint` 里说清代价：图例是逐片四档唯一的承载面，
 * 关掉之后「取不到」的那几片在屏上一个字都没有。
 */
import type { ConfigPreset } from '@dt/contracts'

import { PIE_INNER_RADIUS_DEFAULT, PIE_OUTER_RADIUS_DEFAULT } from './options'

export const PIE_CHART_PRESETS: ConfigPreset[] = [
  {
    id: 'energy-donut',
    label: '能源构成',
    hint: '粗环搭配底部图例与环心合计，扇区不重复显示名称。',
    config: {
      centerText: 'sum',
      chartStyle: 'donut',
      innerRadius: 52,
      outerRadius: 70,
      palette: [],
      showLegend: true,
      showTooltip: true,
      // 图例已经逐条写了名字，扇区外再挂一圈标签只会把圆挤小
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'share-pie',
    label: '占比饼',
    hint: '实心饼搭配扇区外标签，直接显示各项名称与占比；图例说明缺少数据的项目。',
    config: {
      // 实心饼没有心可写，这一档在渲染侧也会被挡掉
      centerText: 'none',
      chartStyle: 'pie',
      innerRadius: PIE_INNER_RADIUS_DEFAULT,
      outerRadius: PIE_OUTER_RADIUS_DEFAULT,
      palette: [],
      // 取不到数的那几片不进扇区、也就没有标签，只有图例说得出它们的原因
      showLegend: true,
      showTooltip: true,
      showValueLabel: true,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'rose-rank',
    label: '玫瑰排名',
    hint: '扇区半径随占比变化，突出最大项目；同时显示图例与环心最大值。',
    config: {
      centerText: 'max',
      chartStyle: 'rose',
      innerRadius: 20,
      outerRadius: 76,
      palette: [],
      showLegend: true,
      showTooltip: true,
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'compact-ring',
    label: '紧凑环',
    hint: '适用于窄幅模块：细环搭配环心合计，并隐藏图例与标签；缺少数据的项目不再显示原因。',
    config: {
      centerText: 'sum',
      chartStyle: 'donut',
      innerRadius: 64,
      outerRadius: 78,
      palette: [],
      // 四套里唯一关掉图例的一套：窄块摆不下，逐片状态因此只剩读屏摘要那一面
      showLegend: false,
      showTooltip: true,
      showValueLabel: false,
      animation: true,
      animationDuration: 600,
    },
  },
]
