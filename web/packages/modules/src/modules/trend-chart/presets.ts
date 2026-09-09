/**
 * @fileoverview trend-chart 的三套外观预设：素净的工艺曲线、带渐变的面积，
 * 以及带缩放条的长窗回放。
 *
 * ⚠ 每套都把观感键写全，且顺序与 `configSchema` 的书写序一致。应用预设是**浅合并**：
 * 少写一个键，上一套留在 configJson 里的那个值就原样残留，而点亮判定做的是子集
 * 比较、照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `unit` / `precision` / `xAxisName` / `yAxisName` / `refLines` 五个键刻意一套都不写：
 * 前两个是这块屏的数值口径（℃ 就是 ℃），中间两个轴名多半也带着单位，最后一个是
 * 数据判据（超过 80 报警）。一套观感把它们抹成空串或空表，等于让用户配好的口径与
 * 阈值线在换个样子时消失。
 * ⚠ `title` / `series` / `emptyText` / `rightAxisName` 四个内容键同理一个都不写：
 * 预设换的是观感，写了它们就会把用户配好的系列整片抹掉。
 * ⚠ 关掉图例的那一套要在 `hint` 里说清代价：图例是逐条四档唯一的承载面，
 * 关掉之后「取不到」的那几条在屏上一个字都没有。
 */
import type { ConfigPreset } from '@dt/contracts'

export const TREND_CHART_PRESETS: ConfigPreset[] = [
  {
    id: 'process-line',
    label: '工艺曲线',
    hint: '简洁折线搭配底部图例，数值轴按数据范围自适应，适合呈现工艺温度等窄幅波动。',
    config: {
      chartStyle: 'line',
      palette: [],
      areaGradient: false,
      areaGradientTo: '',
      areaTopAlpha: 0.3,
      areaOpacity: 0.18,
      // 几百个点逐点画圈会连成一条粗带，远看反而不如纯线清楚
      showSymbol: false,
      symbolSize: 6,
      showDataZoom: false,
      yScale: true,
      boundaryGap: false,
      showLegend: true,
      showTooltip: true,
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'filled-area',
    label: '渐变面积',
    hint: '使用由上至下渐隐的面积图，适合单独展示一条主要趋势。',
    config: {
      chartStyle: 'area',
      palette: [],
      areaGradient: true,
      // 留空由主色自动派生同色渐隐，换肤时跟着走
      areaGradientTo: '',
      areaTopAlpha: 0.35,
      areaOpacity: 0.9,
      showSymbol: false,
      symbolSize: 6,
      showDataZoom: false,
      yScale: false,
      boundaryGap: false,
      showLegend: true,
      showTooltip: true,
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'long-window',
    label: '长窗回放',
    hint: '带缩放条，适合查看长时间窗的局部区间。关闭图例后，取不到数据的系列不会显示状态说明。',
    config: {
      chartStyle: 'line',
      palette: [],
      areaGradient: false,
      areaGradientTo: '',
      areaTopAlpha: 0.3,
      areaOpacity: 0.18,
      showSymbol: false,
      symbolSize: 4,
      showDataZoom: true,
      yScale: true,
      boundaryGap: false,
      // 缩放条自己要占掉底部一条，再摆图例就只剩一条缝画曲线
      showLegend: false,
      showTooltip: true,
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
]
