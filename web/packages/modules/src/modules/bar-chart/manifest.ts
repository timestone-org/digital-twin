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

export default defineModule({
  type: 'bar-chart',
  description:
    '对比柱图：把几路读数摆成共享同一条值轴的柱，回答「谁高谁低」与「按时间怎么走」。要看占比构成用 pie-chart，要逐行摆一串数字用 info-list 或 info-card，要「离满还有多远」用 gauge-card。一个数组绑定槽 `barValues`，行钉在 `items` 配置项上：第 i 行喂第 i 组。行内两个子槽——`value` 是实时档，一行画一根柱；`series` 是历史档（时序），一行画一条按时间桶铺开的系列。读哪一路由「取数来源」这一档决定，两路都绑了也只读它指定的那一路，另一路在图例后缀上标出来。⚠ 两档的类目轴不是一回事：实时档的类目是各行的名字，历史档的类目是各行时刻的并集，两行的取数窗口本来就可以不同。⚠ 百分比档的分母由前端按列现算，一整列全缺时整列留空而不是画成 0%；负值是真读数（回馈电量、温差），一律照实向下画，不取绝对值。⚠ 行级切成折线的那几行不参与堆叠——把达标率堆到产量上去，画出来的线不对应任何一个真实的量。⚠ 图例是逐行状态唯一的承载面，缺省开着；关掉它「等首帧」与「取不到」在屏上就一个字都没有。点某一根柱上抛的联动值是这一行配置里写的名称，没起名的点了不上抛。',
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
  contentKeys: ['title', BAR_ITEMS_KEY, 'emptyText'],
  configSchema: [
    ...titleField(),
    {
      key: BAR_ITEMS_KEY,
      label: '数据组',
      type: 'array',
      group: GROUP.data,
      help: '每一项在绑点面板上是一行。⚠ 删掉中间一项，它之后每一组的绑定都会改喂前一组——删完请核对绑点面板。',
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
          help: '图例与实时档类目轴上的名字；留空时按「第 N 行」称呼它。点这一组上抛的联动值也是它，留空则这一组点了不上抛。⚠ 两组重名会被加上 #1 这样的后缀，否则 echarts 会把它们并成一条图例；上抛的仍是这里写的原名。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '留空跟随整块',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '这一组自己的单位，留空跟随整块那一档。首尾空格照原样保留。',
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
          help: '留空跟随整块那一档。',
        },
        {
          key: 'color',
          label: '固定颜色',
          type: 'color',
          default: '',
          help: '填了就固定这一组的颜色，压过色板。只填 var(--…) 引用，填死色值换肤时不跟着走。',
        },
        {
          key: 'stack',
          label: '堆叠分组',
          type: 'string',
          default: '',
          placeholder: '留空不堆叠',
          help: '同名的几组堆成一根柱。⚠ 只在历史档生效：实时档一行就是一个类目，堆无可堆。⚠ 切成折线的那几组一律不参与堆叠。',
        },
        {
          key: 'plot',
          label: '画法',
          type: 'enum',
          default: 'bar',
          options: [...BAR_PLOTS],
          help: '这一组画成柱还是折线。达标率、单耗这类与柱不同量纲的量，切成折线再挂右轴才读得出来。',
        },
        {
          key: 'axis',
          label: '挂轴',
          type: 'enum',
          default: 'left',
          options: [...BAR_AXES],
          help: '挂左轴还是右轴。⚠ 只要有一组挂了右轴就会多出一条值轴；两条轴的量程互不相干，别拿两边的柱高直接比。',
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
      help: '实时档读每一组的「数值」子槽（一组 = 一根柱），历史档读「历史序列」子槽（一组 = 一条按时间桶铺开的系列）。⚠ 两路都绑了也只读这一档指定的那一路，被忽略的那一路会在图例后缀上标出来。',
    },
    {
      key: 'emptyText',
      label: '空态文案',
      type: 'string',
      group: GROUP.data,
      default: BAR_EMPTY_TEXT,
      span: 'half',
      help: '一根柱都画不出来时画在图区正中的那一句。⚠ 留空时历史档另说一句——公开大屏根本不提供历史数据，那不是现场没数。',
    },
    ...chartStyleField([...BAR_STYLES], 'grouped'),
    {
      key: 'barWidth',
      label: '柱宽上限 (px)',
      type: 'number',
      group: GROUP.style,
      // ⚠ 刻意没有 default：留空 = 交给 echarts 按类目数自适应；给个 0 会让
      //   「没填」与「真的填了 0」再也分不开
      min: BAR_WIDTH_MIN,
      max: BAR_WIDTH_MAX,
      step: 1,
      span: 'half',
      help: '留空自动。只封上限，类目多时仍会自己变窄。',
    },
    {
      key: 'barRadius',
      label: '柱角圆角 (px)',
      type: 'range',
      group: GROUP.style,
      default: BAR_RADIUS_DEFAULT,
      min: BAR_RADIUS_MIN,
      max: BAR_RADIUS_MAX,
      step: 1,
      span: 'half',
      help: '⚠ 堆叠档里每一段都会被圆角切一刀，堆高的那几段之间会露出缝——堆叠时建议调回 0。',
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
    ...axisIntervalFields(),
    ...dataZoomFields(),
    // ⚠ 缺省开着：图例是逐行四档唯一的承载面（`ownsStatusDisplay` 让整格浮层不出），
    //   关着的话「取不到」与「等首帧」在屏上一个字都没有
    ...legendFields({ default: true }),
    ...tooltipFields(),
    ...dataLabelFields({ default: false }),
    ...markLineFields(),
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
