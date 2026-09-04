/**
 * @fileoverview trend-chart 的四套外观预设：素净的工艺曲线、带渐变的面积、
 * 双轴对比，以及带缩放条的长窗回放。
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
    hint: '素净折线 + 底部图例，数值轴按数据范围自适应；工艺温度这类窄幅波动看得出起伏。',
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
      dualAxis: false,
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
    hint: '面积 + 上浓下透的竖向渐变，一条主曲线单独占一块时最好看。',
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
      dualAxis: false,
      showLegend: true,
      showTooltip: true,
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
  {
    id: 'dual-axis',
    label: '双轴对比',
    hint: '开双 Y 轴：量纲差得远的两组量各挂一根轴，逐条在「系列」里选左右。⚠ 参考线跟着左轴走。',
    config: {
      chartStyle: 'line',
      palette: [],
      areaGradient: false,
      areaGradientTo: '',
      areaTopAlpha: 0.3,
      areaOpacity: 0.18,
      showSymbol: false,
      symbolSize: 6,
      showDataZoom: false,
      yScale: true,
      boundaryGap: false,
      dualAxis: true,
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
    hint: '带缩放条：一天以上的窗口拖着看局部。四套里唯一关掉图例的一套，代价是取不到数的那几条在屏上没有说明。',
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
      dualAxis: false,
      // 缩放条自己要占掉底部一条，再摆图例就只剩一条缝画曲线
      showLegend: false,
      showTooltip: true,
      showValueLabel: false,
      animation: false,
      animationDuration: 600,
    },
  },
]
