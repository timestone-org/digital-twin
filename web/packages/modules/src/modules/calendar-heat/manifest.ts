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
import type { BindingView } from '@dt/contracts'

import { defineModule } from '../../registry'
import { readTrimmedText } from '../../shared/config'
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
  dayFormatterOf,
  metricRowCounts,
  metricRowLabels,
  validateTimezoneConfig,
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

function archiveTimezone(binding: BindingView): string {
  const detail = binding.detailJson
  if (
    binding.sourceKind !== 'archive' ||
    detail === null ||
    !('timezone' in detail)
  ) {
    return ''
  }
  return readTrimmedText(detail.timezone)
}

/** 显式历史分桶与日历日界必须使用同一 IANA 时区。 */
function validateBindingTimezones(
  config: Record<string, unknown>,
  bindings: readonly BindingView[],
): readonly string[] {
  // 非法时区由全模块绑定校验单独报告，不能再伪装成一条“不一致”。
  const zones = [
    ...new Set(
      bindings
        .map(archiveTimezone)
        .filter((zone) => zone !== '' && dayFormatterOf(zone) !== null),
    ),
  ]
  if (zones.length === 0) return []
  const moduleZone = readTrimmedText(config.timezone)
  if (moduleZone === '') {
    return [`模块时区必须显式设为点位历史分桶时区 ${zones.join('、')}`]
  }
  const mismatched = zones.filter((zone) => zone !== moduleZone)
  return mismatched.length === 0
    ? []
    : [
        `点位历史分桶时区 ${mismatched.join('、')} 必须与模块时区 ${moduleZone} 一致`,
      ]
}

export default defineModule({
  type: 'calendar-heat',
  description:
    '日历热力适合分析每日能耗、达标率或产量等长周期指标，支持日历与月日矩阵两种布局；日内趋势应选择趋势曲线。模块使用数组槽 `dayValues`，每行的 `series` 接收历史序列，并按配置的时区和逐日归并方式生成每日数值。多项指标共用色阶，因此应保持相同量纲；色阶上下限可自动计算或固定。历史取数触顶时会标明实际覆盖区间，避免将未返回日期误判为停机。',
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
  validateConfig: validateTimezoneConfig,
  validateBindings: validateBindingTimezones,
  contentKeys: [
    'title',
    METRIC_ITEMS_KEY,
    'emptyText',
    'timezone',
    'minValue',
    'maxValue',
  ],
  configSchema: [
    ...titleField(),
    {
      key: METRIC_ITEMS_KEY,
      label: '指标',
      type: 'array',
      group: GROUP.data,
      help: '每项对应一个绑定行和一张日历。删除中间项会使后续绑定索引前移；多项指标共用色阶，应保持相同量纲。',
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
          help: '用于日历标题和联动值。留空时不触发分项联动；重名项在标题中自动追加序号，联动仍使用原名称。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '例如：kWh',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '用于标题和提示框；首尾空格保持不变。',
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
          help: '留空时自动保留最多 2 位小数。',
        },
        {
          key: 'dayAggregate',
          label: '日聚合方式',
          type: 'enum',
          default: DAY_AGGREGATE_DEFAULT,
          options: [...DAY_AGGREGATES],
          help: '将同一自然日内的采样合成为一个值。增量数据通常选求和，累计表底选末值或最大值，瞬时量选平均；应与绑定侧的取点间隔及聚合方式保持一致。',
        },
      ],
    },
    {
      key: 'emptyText',
      label: '无数据提示',
      type: 'string',
      group: GROUP.data,
      default: CALENDAR_EMPTY_TEXT,
      span: 'half',
      help: '未配置任何数据来源时显示；已配置但取数失败时显示逐项原因。',
    },
    {
      key: 'timezone',
      label: '时区',
      type: 'string',
      group: GROUP.data,
      default: '',
      span: 'half',
      placeholder: '留空跟随浏览器本地时区',
      help: '用于确定自然日边界的 IANA 时区，例如 Asia/Shanghai。点位历史设置分桶时区时，两处必须一致；无效值会阻止渲染。',
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
      help: '顺序色阶适用于单向数值；发散色阶仅适用于具有正负方向的偏差类数据。',
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
      help: '留空时按当前数据自动计算。若需跨日期比较颜色深浅，请固定上下限。',
    },
    {
      key: 'maxValue',
      label: '色阶上限',
      type: 'number',
      group: GROUP.style,
      step: 1,
      span: 'half',
      help: '留空时按当前数据自动计算；上下限颠倒时按数值顺序归一。',
    },
    {
      key: 'cellGap',
      label: '单元格间距（px）',
      type: 'number',
      group: GROUP.style,
      default: CELL_GAP_DEFAULT,
      min: CELL_GAP_MIN,
      max: CELL_GAP_MAX,
      step: 1,
      span: 'half',
      help: '使用分隔线色绘制单元格间距；设为 0 时需通过提示框识别日期边界。',
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
