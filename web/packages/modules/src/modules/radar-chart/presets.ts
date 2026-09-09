/**
 * @fileoverview radar-chart 的四套外观预设：绿色工厂评价的粗面、双组对比的淡面、
 * 只描边的净版，以及不带图例的紧凑轮。
 *
 * ⚠ 每套都把观感键写全，且顺序与 `configSchema` 的书写序一致。应用预设是**浅合并**：
 * 少写一个键，上一套留在 configJson 里的那个值就原样残留，而点亮判定做的是子集
 * 比较、照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `unit` 与 `precision` 两个键刻意一套都不写：它们摆在「样式」分段里，语义却是
 * 这块屏的数值口径（分就是分），一套观感把它们抹成空串等于让用户配好的单位
 * 在换个样子时消失。
 * ⚠ `title` / `indicators` / `emptyText` / `seriesName` / `compareName` 五个内容键
 * 同理一个都不写：预设换的是观感，写了它们就会把用户配好的指标整片抹掉。
 * ⚠ 关掉图例的那一套要在 `hint` 里说清代价：图例是「哪根轴画不出来、为什么」唯一的
 * 承载面，关掉之后被剔出轮子的那几根轴在屏上一个字都没有。
 */
import type { ConfigPreset } from '@dt/contracts'

import { RADAR_AREA_OPACITY_DEFAULT, RADAR_SPLIT_DEFAULT } from './options'

export const RADAR_CHART_PRESETS: ConfigPreset[] = [
  {
    id: 'green-factory',
    label: '绿色工厂',
    hint: '多边形网格搭配单层填充，便于识别单组评价短板；底部图例说明无法渲染的轴。',
    config: {
      chartStyle: 'area',
      shape: 'polygon',
      splitCount: RADAR_SPLIT_DEFAULT,
      areaOpacity: 32,
      palette: [],
      showLegend: true,
      showTooltip: true,
      // 六根轴的读数糊在轮子上比看提示框更费劲
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'group-compare',
    label: '双组对比',
    hint: '降低填充透明度以区分两组数据，并增加网格环数以辅助判断差异区间。',
    config: {
      chartStyle: 'area',
      shape: 'polygon',
      splitCount: 5,
      // 两组叠着时浓度越低越分得清谁压着谁
      areaOpacity: 18,
      palette: [],
      showLegend: true,
      showTooltip: true,
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'outline-clean',
    label: '净描边',
    hint: '使用无填充的圆形网格，适合轴数较多的场景；顶点直接显示读数。',
    config: {
      // 描边档不吃 areaOpacity，但预设仍要写全它，否则残留上一套的浓度
      chartStyle: 'line',
      shape: 'circle',
      splitCount: RADAR_SPLIT_DEFAULT,
      areaOpacity: RADAR_AREA_OPACITY_DEFAULT,
      palette: [],
      showLegend: true,
      showTooltip: true,
      // 不铺面时顶点旁边还摆得下数字
      showValueLabel: true,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'compact-radar',
    label: '紧凑轮',
    hint: '适用于窄幅模块：三环、细描边，并隐藏图例与标签；无法渲染的轴不再显示原因。',
    config: {
      chartStyle: 'line',
      shape: 'polygon',
      splitCount: 3,
      areaOpacity: RADAR_AREA_OPACITY_DEFAULT,
      palette: [],
      // 四套里唯一关掉图例的一套：窄块摆不下，逐轴原因因此只剩读屏摘要那一面
      showLegend: false,
      showTooltip: true,
      showValueLabel: false,
      animation: true,
      animationDuration: 600,
    },
  },
]
