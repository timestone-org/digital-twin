/**
 * @fileoverview trend-chart —— 趋势曲线：把一条或多条点位归档 / 台账列的历史序列
 * 画成带真实时间轴的折线或面积图，见 docs/MODULE_TREND_CHART_DESIGN.md 与
 * docs/DASHBOARD_CHART_MODULES_DESIGN.md §3。
 *
 * ⚠ 类型 id 是 `trend-chart` 而不是 `trend` 或图标名 `chart-line`：守「零模块类型
 * 字面量」的那道闸按已注册的 type 逐个 grep 源码，短词与图标名都会红在一堆与模块
 * 毫不相干的地方（`chart-line` 在导航项与台账详情页各有一处命中）。
 * ⚠ 这里绝不静态 import `Component.vue` / `option.ts`：注册用的 glob 是 `eager: true`，
 * 静态引一下就把渲染组件并进注册 chunk，并破坏组件的懒加载语义。
 * ⚠ 没有「时间范围」这一项：取数窗口住在**每条绑定**的取数说明上，由绑点面板写入，
 * 模块既读不到也改不了，而同一块图里两条系列的窗口还允许不一样。
 */
import { defineModule } from '../../registry'
import {
  animationFields,
  axisIntervalFields,
  cartesianAxisFields,
  chartStyleField,
  dataLabelFields,
  dataZoomFields,
  GROUP,
  gradientFields,
  legendFields,
  markLineFields,
  paletteOverrideField,
  symbolFields,
  titleField,
  tooltipFields,
  unitPrecisionFields,
} from '../../shared/chart/chart-config'
import { TREND_AXES, TREND_LINE_TYPES, TREND_STYLES } from './options'
import { TREND_CHART_PRESETS } from './presets'
import {
  SERIES_ITEMS_KEY,
  SERIES_HISTORY_FIELD,
  SERIES_LATEST_FIELD,
  SERIES_SLOT_KEY,
  seriesRowCounts,
  seriesRowLabels,
  TREND_EMPTY_TEXT,
} from './series'

/** 面积那两档才有填充可调。 */
const AREA_ONLY = { key: 'chartStyle', in: ['area', 'stackedArea'] }

/**
 * 时间轴上没有「每隔 n 个类目显示一个」这回事。
 * ⚠ `axisLabel.interval` 只对类目轴生效，摆出来就是一个配了没反应的旋钮；
 * 同一个工厂产出的另外两项对时间轴都成立，照收。
 */
const CATEGORY_ONLY_AXIS_FIELD = 'xLabelInterval'

export default defineModule({
  type: 'trend-chart',
  description:
    '趋势曲线适合分析多个指标随真实时间变化的过程；仅比较当前值时应选择数据卡片或对比柱图。模块使用数组槽 `seriesValues`，每行以 `series` 接收历史序列，并可通过 `latest` 补充实时末值。取数窗口不在这份配置里，而由各绑定独立定义，因此同图系列可具有不同时间范围。实时末值仅在采样时刻严格晚于历史末点时追加，缺少时间戳时不参与曲线。',
  displayName: '趋势曲线',
  category: '图表',
  icon: 'chart-line',
  keywords: [
    'trend',
    'line',
    'area',
    'history',
    'quxian',
    'zhexiantu',
    'qushi',
    '趋势',
    '曲线',
    '折线',
    '折线图',
    '面积图',
    '历史',
    '时序',
  ],
  defaultSize: { width: 520, height: 300, minWidth: 220, minHeight: 160 },
  configPresets: TREND_CHART_PRESETS,
  contentKeys: [
    'title',
    SERIES_ITEMS_KEY,
    'emptyText',
    'rightAxisName',
    'unit',
    'precision',
    'xAxisName',
    'yAxisName',
    'refLines',
  ],
  configSchema: [
    ...titleField(),
    {
      key: SERIES_ITEMS_KEY,
      label: '系列',
      type: 'array',
      group: GROUP.data,
      help: '每项对应一个绑定行，包含历史序列和可选实时末值。删除中间项会使后续绑定索引前移；删除后请核对绑定关系。',
      itemLabelKey: 'name',
      minItems: 1,
      // ⚠ 出厂给一项：空列表时模块是一块什么都没有的白板，而属性面板上
      //   「新增一行」不在最显眼的位置，看着像模块坏了
      default: [{ name: '系列 1', unit: '', color: '', axis: 'left' }],
      span: 'full',
      itemSchema: [
        {
          key: 'name',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空则按「第 N 条」称呼',
          help: '用于图例、提示框和联动值。留空时显示「第 N 条」且不触发分项联动；重名项在图例中自动追加序号，联动仍使用原名称。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '留空时使用模块设置',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '该系列单位，用于提示框和数值标签；留空时继承模块单位。首尾空格保持不变。',
        },
        {
          key: 'precision',
          label: '小数位',
          // ⚠ 是数字框不是滑杆：滑杆没有空态，没配时面板上显示 0 而渲染按整块
          //   那一档走，两边对不上；而且拖过一次就再也回不到「跟随整块」
          type: 'number',
          // ⚠ 刻意没有 default：留空 = 跟随整块的小数位
          min: 0,
          max: 6,
          step: 1,
          help: '留空时继承模块小数位。',
        },
        {
          key: 'color',
          label: '固定颜色',
          type: 'color',
          default: '',
          help: '设置后覆盖色板。建议使用 var(--…) 主题变量，以支持主题切换。',
        },
        {
          key: 'axis',
          label: '所属 Y 轴',
          type: 'enum',
          default: 'left',
          options: [...TREND_AXES],
          help: '选择左轴或右轴；存在右轴系列时自动创建右侧 Y 轴。',
        },
        {
          key: 'lineType',
          label: '线型',
          type: 'enum',
          default: 'solid',
          options: [...TREND_LINE_TYPES],
          help: '用于区分颜色接近或重叠的系列。',
        },
      ],
    },
    {
      key: 'emptyText',
      label: '无数据提示',
      type: 'string',
      group: GROUP.data,
      default: TREND_EMPTY_TEXT,
      span: 'half',
      help: '无有效序列时显示；历史能力不可用或时间窗内无数据时显示对应专用说明。',
    },
    ...chartStyleField([...TREND_STYLES], 'line'),
    ...paletteOverrideField(),
    ...gradientFields({ when: AREA_ONLY }),
    ...symbolFields({ showSymbol: false }),
    ...unitPrecisionFields(),
    ...dataZoomFields(),
    ...cartesianAxisFields(),
    // ⚠ 数值轴缺省不强制含 0：工艺温度这类高基线上的窄幅波动，含 0 的轴上是一条直线
    ...axisIntervalFields({ yScale: true, boundaryGap: false }).filter(
      (field) => field.key !== CATEGORY_ONLY_AXIS_FIELD,
    ),
    {
      key: 'rightAxisName',
      label: '右轴名称',
      type: 'string',
      group: GROUP.axis,
      default: '',
      span: 'half',
      placeholder: '留空不显示',
      help: '存在右轴系列时生效。刻度不附加单位，建议在名称中标明单位。',
    },
    // ⚠ 缺省开着：图例是逐条四档唯一的承载面（`ownsStatusDisplay` 让整格浮层不出），
    //   关着的话「取不到」与「等首帧」在屏上一个字都没有
    ...legendFields({ default: true }),
    ...tooltipFields(),
    // ⚠ 缺省关：一条曲线动辄几百个点，逐点挂标签会把整块糊成一片
    ...dataLabelFields({ default: false }),
    ...animationFields(),
    ...markLineFields(),
  ],
  bindings: [
    {
      key: SERIES_SLOT_KEY,
      label: '曲线数据',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
      dataType: 'number',
      isArray: true,
      // 行钉在配置里的系列上：条数由配置决定，绑一部分是常态，空出来的
      // 不许让其后整体移位（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      // ⚠ 一个子槽都不给 isRequired：配了 6 条先接 2 条是常态，
      //   给了会让整块被判 unbound 并盖上状态浮层，逐条四档白画
      arrayFields: [
        {
          key: SERIES_HISTORY_FIELD,
          label: '历史序列',
          dataType: 'number',
          // 只有点位归档与数据台账两支给得出序列；接了别的来源这一条会落取不到
          isTimeSeries: true,
        },
        {
          key: SERIES_LATEST_FIELD,
          label: '实时末值',
          dataType: 'number',
        },
      ],
    },
  ],
  // 六条里坏掉一条不该让另外五条一起被浮层盖住，四档由模块自己在图例上交代
  ownsStatusDisplay: true,
  // 点某一条线上抛它的名字
  emitsInteractions: true,
  // ⚠ 不开 hostClickable：缩放条与内置缩放都是拖拽手势，松手也会派发一次 click
  bindingRowLabels: seriesRowLabels,
  // ⚠ 系列不是用户在绑点面板上随手加的：行号就是它的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行永远喂不到任何东西。
  //   ⚠ 一条都没有时也要给 0，别把键漏掉
  bindingRowCounts: seriesRowCounts,
  preview: {
    config: {
      [SERIES_ITEMS_KEY]: [
        { name: '进水温度', unit: '℃' },
        { name: '回水温度', unit: '℃' },
      ],
    },
    values: {
      [SERIES_SLOT_KEY]: [
        {
          // ⚠ 两个键都要给：设计态把演示值摊成逐行常量绑定，只给序列的话
          //   `series` 那一槽在 `meta.slots` 里没有键，整条会被判成「还没绑」
          series: 46.8,
          seriesPoints: [
            { t: 1_756_000_000_000, v: 42.1 },
            { t: 1_756_001_800_000, v: 43.6 },
            { t: 1_756_003_600_000, v: 45.2 },
            { t: 1_756_005_400_000, v: 44.4 },
            { t: 1_756_007_200_000, v: 46.8 },
          ],
        },
        {
          series: 38.0,
          seriesPoints: [
            { t: 1_756_000_000_000, v: 35.4 },
            { t: 1_756_001_800_000, v: 36.2 },
            { t: 1_756_003_600_000, v: 35.9 },
            { t: 1_756_005_400_000, v: 37.1 },
            { t: 1_756_007_200_000, v: 38.0 },
          ],
        },
      ],
    },
  },
  component: () => import('./Component.vue'),
})
