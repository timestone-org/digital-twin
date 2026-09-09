/**
 * @fileoverview bar-chart —— 对比柱图：把几路读数摆成共享一条值轴的柱，
 * 实时档比的是「谁高谁低」，历史档比的是「按桶怎么走」。行级可切成折线并挂右轴，
 * 于是同一块里画得出「产量柱 + 达标率线」这种双轴组合。
 * 见 docs/MODULE_BAR_CHART_DESIGN.md 与 docs/DASHBOARD_CHART_MODULES_DESIGN.md §3。
 *
 * ⚠ 类型 id 是 `bar-chart` 而不是 `bar`：守「零模块类型字面量」的那道闸按已注册的
 * type 逐个 grep 源码，短词会红在一堆与模块毫不相干的属性上。
 * ⚠ 这里绝不静态 import `Component.vue` / `option.ts`：注册用的 glob 是 `eager: true`，
 * 静态引一下就把渲染组件并进注册 chunk，并破坏组件的懒加载语义。
 * ⚠ 区间与档位一律取自 `./options`：面板的 min / max 与渲染侧的夹取一旦各写一份，
 * 面板上拖得到的那一格渲染时会被夹回去——「配了不生效」。
 */
import { defineModule } from '../../registry'
import {
  animationFields,
  axisIntervalFields,
  cartesianAxisFields,
  chartFontFields,
  chartStyleField,
  dataLabelFields,
  dataZoomFields,
  gradientFields,
  GROUP,
  legendFields,
  markLineFields,
  paletteOverrideField,
  titleField,
  tooltipFields,
  unitPrecisionFields,
} from '../../shared/chart/chart-config'
import {
  BAR_EMPTY_TEXT,
  BAR_ITEMS_KEY,
  BAR_SERIES_FIELD,
  BAR_SLOT_KEY,
  BAR_VALUE_FIELD,
  barRowCounts,
  barRowLabels,
} from './bars'
import {
  BAR_AXES,
  BAR_PLOTS,
  BAR_RADIUS_DEFAULT,
  BAR_RADIUS_MAX,
  BAR_RADIUS_MIN,
  BAR_STYLES,
  BAR_VALUE_SOURCES,
  BAR_WIDTH_MAX,
  BAR_WIDTH_MIN,
} from './options'
import { BAR_CHART_PRESETS } from './presets'

/** 参考线使用原始量纲，百分比模式不适用。 */
const REF_LINE_STYLES = {
  key: 'chartStyle',
  in: BAR_STYLES.map((option) => option.value).filter(
    (value) => value !== 'percent',
  ),
}

/** 固定百分比或对称量程时，数值轴自适应不生效。 */
const AUTO_SCALE_STYLES = {
  key: 'chartStyle',
  in: BAR_STYLES.map((option) => option.value).filter(
    (value) => value !== 'percent' && value !== 'diverging',
  ),
}

export default defineModule({
  type: 'bar-chart',
  description:
    '对比柱图适合比较多组实时读数，或按时间桶呈现分组、堆叠、百分比和双轴组合；连续趋势应选择趋势曲线。模块使用数组槽 `barValues`，每行包含实时 `value` 与历史 `series`，由“取数来源”确定生效路径。实时模式的类目轴为组名，历史模式为时间戳并集，百分比的分母按有效列计算。负值在普通模式保留方向；百分比模式遇到负值时整列不计算占比。',
  displayName: '对比柱图',
  category: '图表',
  icon: 'chart-column',
  keywords: [
    'bar',
    'column',
    'histogram',
    'zhuzhuangtu',
    'duibi',
    'duidie',
    '柱状图',
    '柱图',
    '条形图',
    '对比',
    '堆叠',
    '双轴',
  ],
  defaultSize: { width: 420, height: 300, minWidth: 200, minHeight: 160 },
  configPresets: BAR_CHART_PRESETS,
  // ⚠ `valueSource` 是内容键：它决定这一块读哪一路绑定，一套「换个样子」把它从
  //   历史档翻回实时档，整屏曲线会当场变成一排单值柱
  contentKeys: [
    'title',
    BAR_ITEMS_KEY,
    'emptyText',
    'valueSource',
    'unit',
    'precision',
    'xAxisName',
    'yAxisName',
    'refLines',
  ],
  configSchema: [
    ...titleField(),
    {
      key: BAR_ITEMS_KEY,
      label: '数据组',
      type: 'array',
      group: GROUP.data,
      help: '每项对应一个绑定行。删除中间项会使后续绑定索引前移；删除后请核对绑定关系。',
      itemLabelKey: 'name',
      minItems: 1,
      // ⚠ 出厂给一项：空列表时模块是一块什么都没有的白板，而属性面板上
      //   「新增一行」不在最显眼的位置，看着像模块坏了
      default: [{ name: '数据组 1', color: '', unit: '', stack: '' }],
      span: 'full',
      itemSchema: [
        {
          key: 'name',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空则按「第 N 行」称呼',
          help: '用于图例、实时类目轴和联动值。留空时显示「第 N 行」且不触发分项联动；重名项在图例中自动追加序号，联动仍使用原名称。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '留空时使用模块设置',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '该组单位；留空时继承模块单位。首尾空格保持不变。',
        },
        {
          key: 'precision',
          label: '小数位',
          // ⚠ 是数字框不是滑杆：滑杆没有空态，没配时面板上显示 0 而渲染按整块那一档
          //   走，两边对不上；而且拖过一次就再也回不到「跟随整块」
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
          key: 'stack',
          label: '堆叠分组',
          type: 'string',
          default: '',
          placeholder: '留空不堆叠',
          help: '同名组归入同一堆叠。仅在历史档生效；折线组不参与堆叠。',
        },
        {
          key: 'plot',
          label: '系列类型',
          type: 'enum',
          default: 'bar',
          options: [...BAR_PLOTS],
          help: '选择柱形或折线。不同量纲的指标可设为折线并使用副轴。',
        },
        {
          key: 'axis',
          label: '所属数值轴',
          type: 'enum',
          default: 'left',
          options: [...BAR_AXES],
          help: '选择主轴或副轴。启用副轴后，两轴量程独立，不应按图形高度直接比较。',
        },
      ],
    },
    {
      key: 'valueSource',
      label: '取数来源',
      type: 'enum',
      group: GROUP.data,
      default: 'live',
      span: 'half',
      options: [...BAR_VALUE_SOURCES],
      help: '实时模式读取「数值」子槽，历史模式读取「历史序列」子槽。仅选定来源参与渲染，其他已绑定来源会在图例中标记为未使用。',
    },
    {
      key: 'emptyText',
      label: '无数据提示',
      type: 'string',
      group: GROUP.data,
      default: BAR_EMPTY_TEXT,
      span: 'half',
      help: '无有效柱形时显示；若当前页面不支持历史数据，将优先显示专用说明。',
    },
    ...chartStyleField(
      [...BAR_STYLES],
      'grouped',
      '百分比堆叠仅对非负值计算；含负值的整列不显示占比。',
    ),
    {
      key: 'barWidth',
      label: '柱宽上限（px）',
      type: 'number',
      group: GROUP.style,
      // ⚠ 刻意没有 default：留空 = 交给 echarts 按类目数自适应；给个 0 会让
      //   「没填」与「真的填了 0」再也分不开
      min: BAR_WIDTH_MIN,
      max: BAR_WIDTH_MAX,
      step: 1,
      span: 'half',
      help: '留空时自适应，仅限制最大宽度。',
    },
    {
      key: 'barRadius',
      label: '柱体圆角（px）',
      type: 'range',
      group: GROUP.style,
      default: BAR_RADIUS_DEFAULT,
      min: BAR_RADIUS_MIN,
      max: BAR_RADIUS_MAX,
      step: 1,
      span: 'half',
      help: '堆叠模式会对每段应用圆角，可能产生段间缝隙；建议设为 0。',
    },
    ...paletteOverrideField(),
    // 柱体的渐变缺省整体不透明：那批工厂给的是折线面积的口径，0.18 摊在柱上几乎看不见
    ...gradientFields({
      prefix: 'bar',
      label: '柱体',
      topAlpha: 0.45,
      opacity: 1,
    }),
    ...unitPrecisionFields(),
    ...cartesianAxisFields(),
    ...axisIntervalFields({ yScaleWhen: AUTO_SCALE_STYLES }),
    ...dataZoomFields(),
    // ⚠ 缺省开着：图例是逐行四档唯一的承载面（`ownsStatusDisplay` 让整格浮层不出），
    //   关着的话「取不到」与「等首帧」在屏上一个字都没有
    ...legendFields({ default: true }),
    ...tooltipFields(),
    ...dataLabelFields({ default: false }),
    ...markLineFields({ when: REF_LINE_STYLES }),
    ...animationFields(),
    ...chartFontFields({
      include: [
        'axisLabelFontSize',
        'axisNameFontSize',
        'legendFontSize',
        'tooltipFontSize',
        'labelFontSize',
        'labelColor',
      ],
    }),
  ],
  bindings: [
    {
      key: BAR_SLOT_KEY,
      label: '数据组读数',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
      dataType: 'number',
      isArray: true,
      // 行钉在配置里的数据组上：组数由配置决定，绑一部分是常态，空出来的
      // 不许让其后整体移位（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      // ⚠ 一个子槽都不给 isRequired：配了 6 组先接 2 组是常态，
      //   给了会让整块被判 unbound 并盖上状态浮层，逐行四档白画
      arrayFields: [
        { key: BAR_VALUE_FIELD, label: '数值', dataType: 'number' },
        {
          key: BAR_SERIES_FIELD,
          label: '历史序列',
          dataType: 'number',
          // 取数窗口与桶宽住在绑定上，模块既读不到也改不了
          isTimeSeries: true,
        },
      ],
    },
  ],
  // 六组里坏掉一组不该让另外五组一起被浮层盖住，四档由模块自己在图例上交代
  ownsStatusDisplay: true,
  // 点某一根柱上抛它那一组的名字
  emitsInteractions: true,
  // ⚠ 不开 hostClickable：这一族摆得出缩放条，整块可点会把拖动滑块吞成一次点击
  bindingRowLabels: barRowLabels,
  // ⚠ 数据组不是用户在绑点面板上随手加的：行号就是它的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行永远喂不到任何东西。
  //   ⚠ 一组都没有时也要给 0，别把键漏掉
  bindingRowCounts: barRowCounts,
  preview: {
    config: {
      [BAR_ITEMS_KEY]: [
        { name: '1# 线', unit: 't' },
        { name: '2# 线', unit: 't' },
        { name: '3# 线', unit: 't' },
        { name: '4# 线', unit: 't' },
      ],
    },
    values: {
      [BAR_SLOT_KEY]: [
        { value: 62 },
        { value: 48 },
        { value: 75 },
        { value: 31 },
      ],
    },
  },
  component: () => import('./Component.vue'),
})
