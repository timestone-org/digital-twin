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

/** 右轴的名字只在双轴开着时摆得出来。 */
const DUAL_ONLY = { key: 'dualAxis', in: [true] }

/**
 * 时间轴上没有「每隔 n 个类目显示一个」这回事。
 * ⚠ `axisLabel.interval` 只对类目轴生效，摆出来就是一个配了没反应的旋钮；
 * 同一个工厂产出的另外两项对时间轴都成立，照收。
 */
const CATEGORY_ONLY_AXIS_FIELD = 'xLabelInterval'

export default defineModule({
  type: 'trend-chart',
  description:
    '趋势曲线：把一条或多条点位归档 / 台账列的历史序列画成带真实时间轴的折线、面积或阶梯图，回答「这个数过去几小时怎么走的」。只要当前值用 info-card 或 data-card，要比几个量的高低用 bar-chart，要看占比构成用 pie-chart。一个数组绑定槽 `seriesValues`，行钉在 `series` 配置项上：第 i 行喂第 i 条曲线，行内 `series` 收历史序列（只有点位归档与数据台账两支给得出）、`latest` 收可选的实时末值。⚠ 取数窗口不在这份配置里——它住在每条绑定自己的取数说明上，由绑点面板写入；同一块图里两条系列的窗口可以不一样，时间轴按取回来的点铺。⚠ 实时末值只在它的采样时刻严格晚于序列末点时才接上去，时刻缺席一律不接：否则曲线尾巴上会凭空长出一个位置不明的点。⚠ 图例是逐条状态唯一的承载面，缺省开着；关掉它「等首帧」「取不到」「早段未取全」在屏上就一个字都没有。⚠ 公开屏不装历史取数，这块图在那里画不出曲线，空态会照实说明。',
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
  contentKeys: ['title', SERIES_ITEMS_KEY, 'emptyText', 'rightAxisName'],
  configSchema: [
    ...titleField(),
    {
      key: SERIES_ITEMS_KEY,
      label: '系列',
      type: 'array',
      group: GROUP.data,
      help: '每一项在绑点面板上是一行，行内两个槽：历史序列与可选的实时末值。⚠ 删掉中间一项，它之后每一条的绑定都会改喂前一条——删完请核对绑点面板。',
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
          help: '图例与提示框上的名字；留空时按「第 N 条」称呼它。点这条线上抛的联动值也是它，留空则这一条点了不上抛。⚠ 两条重名会被加上 #1 这样的后缀，否则 echarts 会把它们并成一条图例；上抛的仍是这里写的原名。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '留空跟随整块',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '这一条自己的单位，提示框与数值标签用它。留空跟随整块那一档，首尾空格照原样保留。',
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
          help: '留空跟随整块那一档。',
        },
        {
          key: 'color',
          label: '固定颜色',
          type: 'color',
          default: '',
          help: '填了就固定这一条的颜色，压过色板。只填 var(--…) 引用，填死色值换肤时不跟着走。',
        },
        {
          key: 'axis',
          label: '挂在哪根轴',
          type: 'enum',
          default: 'left',
          options: [...TREND_AXES],
          help: '⚠ 只有开了「双 Y 轴」才分得出两根轴；没开时右轴根本不存在，这一档静默等同左轴。',
        },
        {
          key: 'lineType',
          label: '线型',
          type: 'enum',
          default: 'solid',
          options: [...TREND_LINE_TYPES],
          help: '两条颜色相近的曲线叠在一起时，换一种线型比换颜色更认得出。',
        },
      ],
    },
    {
      key: 'emptyText',
      label: '空态文案',
      type: 'string',
      group: GROUP.data,
      default: TREND_EMPTY_TEXT,
      span: 'half',
      help: '一条都画不出来时画在图区正中的那一句。⚠ 「这一页没有历史取数」与「窗口里确实没有点」两种情况另有专门的文案，不走这里。',
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
      key: 'dualAxis',
      label: '双 Y 轴',
      type: 'boolean',
      group: GROUP.axis,
      default: false,
      span: 'half',
      help: '量纲差得远的两组量（功率与温度）叠在一根轴上，小的那条会被压成一条平线。⚠ 参考线跟着左轴走。',
    },
    {
      key: 'rightAxisName',
      label: '右轴名称',
      type: 'string',
      group: GROUP.axis,
      default: '',
      span: 'half',
      placeholder: '留空不显示',
      help: '双轴时右边那根轴的名字；刻度上不写单位，单位写在这里。',
      when: DUAL_ONLY,
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
