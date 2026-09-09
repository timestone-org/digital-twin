/**
 * @fileoverview calendar-heat 的四套外观预设：铺满整年的日历、按月对齐的矩阵、
 * 看正负偏差的发散色，以及格缝为 0 的紧凑年历。
 *
 * ⚠ 每套都把观感键写全，且顺序与 `configSchema` 的书写序一致。应用预设是**浅合并**：
 * 少写一个键，上一套留在 configJson 里的那个值就原样残留，而点亮判定做的是子集
 * 比较、照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `minValue` / `maxValue` 两个键刻意一套都不写：它们摆在「样式」分段里，语义却是
 * 这块屏的数值口径（0–100 的达标率与 0–5000 的能耗不是一回事），一套观感把它们写死
 * 等于替用户定量程；而且它们**刻意没有 default**，预设写进去之后就再也回不到
 * 「留空 = 按数据自动定色阶」那一档。
 * ⚠ `title` / `metrics` / `emptyText` / `timezone` 四个内容键同理一个都不写：
 * 预设换的是观感，写了它们就会把用户配好的指标与时区整片抹掉。
 */
import type { ConfigPreset } from '@dt/contracts'

import { CELL_GAP_DEFAULT } from './options'

export const CALENDAR_HEAT_PRESETS: ConfigPreset[] = [
  {
    id: 'year-calendar',
    label: '整年日历',
    hint: '按周排列日历并使用顺序色阶，便于识别异常日期及其工作日或周末分布。',
    config: {
      chartStyle: 'calendar',
      colorScale: 'sequential',
      cellGap: CELL_GAP_DEFAULT,
      showTooltip: true,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'month-matrix',
    label: '月 × 日矩阵',
    hint: '横轴表示日期，纵轴表示年月，便于比较各月同一日期；仅改变坐标布局，不改变读数。',
    config: {
      chartStyle: 'matrix',
      colorScale: 'sequential',
      cellGap: CELL_GAP_DEFAULT,
      showTooltip: true,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'deviation-scan',
    label: '偏差扫描',
    hint: '使用发散色阶与较宽单元格间距，适合同比增减、偏差等双向指标；不适用于单调递增的能耗数据。',
    config: {
      chartStyle: 'calendar',
      colorScale: 'diverging',
      cellGap: 2,
      showTooltip: true,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'dense-year',
    label: '紧凑年历',
    hint: '将单元格间距设为 0，以便在窄幅模块中展示全年数据；相邻日期边界不明显，需通过提示框确认。',
    config: {
      chartStyle: 'calendar',
      colorScale: 'sequential',
      cellGap: 0,
      showTooltip: true,
      animation: true,
      animationDuration: 600,
    },
  },
]
