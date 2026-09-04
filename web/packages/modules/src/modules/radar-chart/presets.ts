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
    hint: '多边形网格 + 一层实面，单组评价一眼看出短板；底部图例交代画不出来的那几根轴。',
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
    hint: '面调淡，两组叠着也分得出前后；网格加一环，读得出差在哪一档。',
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
    hint: '不铺面、圆形网格，轴多时最清爽；顶点上直接写读数。',
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
    hint: '窄块里用：三环、细描边、图例与标签都不占地方——代价是画不出来的那几根轴在屏上没有说明。',
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
