/**
 * @fileoverview calendar-heat —— 日历热力：把一条历史序列按天折成一格，铺成日历或
 * 月 × 日矩阵，一眼找出异常那几天。指标名、单位、小数位与逐日归并算法留在配置里，
 * 见 docs/MODULE_CALENDAR_HEAT_DESIGN.md 与 docs/DASHBOARD_CHART_MODULES_DESIGN.md §3。
 *
 * ⚠ 这里绝不静态 import `Component.vue` / `option.ts`：注册用的 glob 是 `eager: true`，
 * 静态引一下就把渲染组件并进注册 chunk，并破坏组件的懒加载语义。
 * ⚠ 没有「时间范围」这一项：取数窗口住在**每条绑定**的 `detailJson.range` 上（绑点
 * 面板里那个「最近多久」），模块既读不到也改不了，只能按取回的点算日历跨度。
 * ⚠ 区间与档位一律取自 `./options`：面板的 min / max 与渲染侧的夹取一旦各写一份，
 * 面板上拖得到的那一格渲染时会被夹回去——「配了不生效」。
 */
import { defineModule } from '../../registry'
import {
  animationFields,
  chartStyleField,
  GROUP,
  titleField,
  tooltipFields,
} from '../../shared/chart/chart-config'
import {
  CALENDAR_EMPTY_TEXT,
  DAY_SERIES_FIELD,
  DAY_SLOT_KEY,
  METRIC_ITEMS_KEY,
  metricRowCounts,
  metricRowLabels,
} from './days'
import {
  CALENDAR_STYLES,
  CELL_GAP_DEFAULT,
  CELL_GAP_MAX,
  CELL_GAP_MIN,
  COLOR_SCALES,
  DAY_AGGREGATE_DEFAULT,
  DAY_AGGREGATES,
  MAX_METRICS,
} from './options'
import { CALENDAR_HEAT_PRESETS } from './presets'

/**
 * 演示序列：采样时刻是 UTC 毫秒，读数故意有高有低，缩略图上才看得出色阶。
 * ⚠ 逐点写死而不是从两个数组拼：拼的话每个下标都得兜一次底，而那几个兜底分支
 * 永远走不到，白白把这份清单的分支覆盖压下去。
 */
const PREVIEW_POINTS = [
  { t: 1767499200000, v: 820 },
  { t: 1767844800000, v: 1180 },
  { t: 1768276800000, v: 640 },
  { t: 1768795200000, v: 1460 },
  { t: 1769313600000, v: 990 },
  { t: 1770004800000, v: 1320 },
  { t: 1770609600000, v: 460 },
  { t: 1771300800000, v: 1510 },
  { t: 1771905600000, v: 880 },
  { t: 1772510400000, v: 1240 },
]

/** 演示序列的末值，与上面最后一个点同值。 */
const PREVIEW_LAST = 1240

export default defineModule({
  type: 'calendar-heat',
  description:
    '日历热力：把一条历史序列按天折成一格，铺成日历（横轴周、纵轴星期）或月 × 日矩阵（横轴几号、纵轴年月），回答「哪几天异常、哪几天停机」。每日能耗、每日达标率、每日产量这类以天为粒度的长周期观察归它；要看一天之内怎么走用趋势曲线，要逐项比高低用对比柱图。一个数组绑定槽 `dayValues`，行钉在 `metrics` 配置项上：一行 = 一张日历，唯一的子槽 `series` 收一条历史序列（点位归档或数据台账）。⚠ 日界按配置里的时区串算，留空即浏览器本地——跨零点的读数落在哪一天完全取决于它。⚠ 一天之内那几百个采样怎么并成一个数是逐张可配的：电量这类累积量要求和或最大，温度这类瞬时量要平均，选错了每一个数都合法而整张图是假的。⚠ 一块里的几张日历共用一条色阶，所以同一块只该摆同量纲的指标。⚠ 取数触顶时只画得出最近那一段，标题上会写清取回的是哪一段——早期那一段空白与「那几天真停机」在日历上长得一模一样。⚠ 删掉 `metrics` 中间一项，它之后每一张的绑定都会改喂前一张。',
  displayName: '日历热力',
  category: '图表',
  icon: 'calendar',
  keywords: [
    'calendar',
    'heatmap',
    'heat',
    'rili',
    'relitu',
    '日历',
    '热力',
    '热力图',
    '日历图',
    '每日',
    '长周期',
    '分布',
    '打卡',
  ],
  defaultSize: { width: 480, height: 300, minWidth: 240, minHeight: 160 },
  configPresets: CALENDAR_HEAT_PRESETS,
  contentKeys: ['title', METRIC_ITEMS_KEY, 'emptyText', 'timezone'],
  configSchema: [
    ...titleField(),
    {
      key: METRIC_ITEMS_KEY,
      label: '指标',
      type: 'array',
      group: GROUP.data,
      help: '每一项在绑点面板上是一行，也是屏上的一张日历。⚠ 删掉中间一项，它之后每一张的绑定都会改喂前一张——删完请核对绑点面板。⚠ 几张共用一条色阶，同一块里只摆同量纲的指标。',
      itemLabelKey: 'name',
      minItems: 1,
      maxItems: MAX_METRICS,
      // ⚠ 出厂给一项：空列表时模块是一块什么都没有的白板，而属性面板上
      //   「新增一行」不在最显眼的位置，看着像模块坏了
      default: [
        { name: '指标 1', unit: '', dayAggregate: DAY_AGGREGATE_DEFAULT },
      ],
      span: 'full',
      itemSchema: [
        {
          key: 'name',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空则按「第 N 张」称呼',
          help: '这张日历标题上的名字。点这张日历上抛的联动值也是它，留空则点了不上抛。⚠ 两张重名会被加上 #1 这样的后缀，否则标题栏上分不出谁是谁；上抛的仍是这里写的原名。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '如 kWh',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '写在标题与提示框里的单位。首尾空格照原样保留。',
        },
        {
          key: 'precision',
          label: '小数位',
          // ⚠ 是数字框不是滑杆：滑杆没有空态，没配时面板上显示 0 而渲染按缺省
          //   那一档走，两边对不上；而且拖过一次就再也回不到「跟随缺省」
          type: 'number',
          // ⚠ 刻意没有 default：留空 = 跟随缺省小数位
          min: 0,
          max: 6,
          step: 1,
          help: '留空跟随缺省（最多 2 位）。',
        },
        {
          key: 'dayAggregate',
          label: '逐日归并',
          type: 'enum',
          default: DAY_AGGREGATE_DEFAULT,
          options: [...DAY_AGGREGATES],
          help: '一天之内那几百个采样怎么并成一个数。⚠ 电量这类累积量要求和或最大，温度这类瞬时量要平均——选错了每一个数都合法，而整张图是假的。',
        },
      ],
    },
    {
      key: 'emptyText',
      label: '空态文案',
      type: 'string',
      group: GROUP.data,
      default: CALENDAR_EMPTY_TEXT,
      span: 'half',
      help: '一张都没配来源时画在图区正中的那一句。⚠ 配了却取不到数时画的是逐张的原因，不是这一句。',
    },
    {
      key: 'timezone',
      label: '时区',
      type: 'string',
      group: GROUP.data,
      default: '',
      span: 'half',
      placeholder: '留空跟随浏览器本地时区',
      help: 'IANA 时区串，如 Asia/Shanghai。日界按它算——跨零点的读数落在哪一天完全取决于它。⚠ 填了认不出的串不会静默按本地算：整块画不出来并把那个串说出来。',
    },
    ...chartStyleField([...CALENDAR_STYLES], 'calendar'),
    {
      key: 'colorScale',
      label: '色阶',
      type: 'enum',
      group: GROUP.style,
      default: 'sequential',
      span: 'half',
      options: [...COLOR_SCALES],
      help: '⚠ 发散色阶只在读数本身有正负两个方向时才对；拿它画单调递增的能耗，中间那一档颜色会把中位数误读成基准线。',
    },
    {
      key: 'minValue',
      label: '色阶下限',
      // ⚠ 是数字框不是滑杆：滑杆表达不出「留空」，缺席会被显示成 min，
      //   于是「按数据自动」与「真的填了 0」再也分不开
      type: 'number',
      group: GROUP.style,
      // ⚠ 刻意没有 default，理由同上
      step: 1,
      span: 'half',
      help: '留空按取回的数据自动定。两个端点都留空 = 每次刷新都跟着数据走，跨天比色深就没有意义了；要横向比就把它填死。',
    },
    {
      key: 'maxValue',
      label: '色阶上限',
      type: 'number',
      group: GROUP.style,
      step: 1,
      span: 'half',
      help: '留空按取回的数据自动定。⚠ 与下限填反了按小的那个当下限，不报错。',
    },
    {
      key: 'cellGap',
      label: '格缝(px)',
      type: 'number',
      group: GROUP.style,
      default: CELL_GAP_DEFAULT,
      min: CELL_GAP_MIN,
      max: CELL_GAP_MAX,
      step: 1,
      span: 'half',
      help: '格与格之间那道缝，画成分隔线色。填 0 时相邻两天连成一片，得靠提示框认日期。',
    },
    ...tooltipFields(),
    ...animationFields(),
  ],
  bindings: [
    {
      key: DAY_SLOT_KEY,
      label: '逐日序列',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
      dataType: 'number',
      isArray: true,
      // 行钉在配置里的指标上：张数由配置决定，绑一部分是常态，空出来的
      // 不许让其后整体移位（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      // ⚠ 一个子槽都不给 isRequired：配了 4 张先接 1 张是常态，
      //   给了会让整块被判 unbound 并盖上状态浮层，逐张状态白画
      arrayFields: [
        {
          key: DAY_SERIES_FIELD,
          label: '历史序列',
          dataType: 'number',
          // 只有点位归档与数据台账给得出序列；绑实时点位 / 常量 / 派生的那一档
          // 会落成「这一档来源给不出历史序列」，而不是一张看不出问题的空日历
          isTimeSeries: true,
        },
      ],
    },
  ],
  // 四张里坏掉一张不该让另外三张一起被浮层盖住，逐张状态由模块自己写在标题上
  ownsStatusDisplay: true,
  // 点某一格上抛那张日历的名字
  emitsInteractions: true,
  // 日历没有 dataZoom 滑块，也没有拖拽手势，整块可点可以一起开
  hostClickable: true,
  bindingRowLabels: metricRowLabels,
  // ⚠ 指标不是用户在绑点面板上随手加的：行号就是它的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行永远喂不到任何东西。
  //   ⚠ 一张都没有时也要给 0，别把键漏掉
  bindingRowCounts: metricRowCounts,
  preview: {
    config: {
      [METRIC_ITEMS_KEY]: [{ name: '每日能耗', unit: 'kWh' }],
    },
    values: {
      [DAY_SLOT_KEY]: [
        { [DAY_SERIES_FIELD]: PREVIEW_LAST, seriesPoints: PREVIEW_POINTS },
      ],
    },
  },
  component: () => import('./Component.vue'),
})
