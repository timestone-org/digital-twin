/**
 * @fileoverview radar-chart —— 多维雷达：把一组量纲不同的指标按**逐轴量程**归一后
 * 画成一个封闭形状，做本组与对比组的横向比较。轴名、量程、单位、小数位都是配置，
 * 见 docs/MODULE_RADAR_CHART_DESIGN.md 与 docs/DASHBOARD_CHART_MODULES_DESIGN.md §3。
 *
 * ⚠ 类型 id 是 `radar-chart` 而不是 `radar`：守「零模块类型字面量」的那道闸按已注册的
 * type 逐个 grep 源码，短词会红在一堆与模块毫不相干的属性上。
 * ⚠ 图标借的是 `chart-mixed`：本仓的 DtIcon 注册表里没有雷达图标，而加一个要改
 * `@dt/ui`，那不在新模块 PR 的豁免集合内。这是一处有意的妥协。
 * ⚠ 这里绝不静态 import `Component.vue` / `option.ts`：注册用的 glob 是 `eager: true`，
 * 静态引一下就把渲染组件并进注册 chunk，并破坏组件的懒加载语义。
 * ⚠ 区间与档位一律取自 `./options`：面板的 min / max 与渲染侧的夹取一旦各写一份，
 * 面板上拖得到的那一格渲染时会被夹回去——「配了不生效」。
 */
import { defineModule } from '../../registry'
import {
  animationFields,
  chartStyleField,
  dataLabelFields,
  GROUP,
  legendFields,
  paletteOverrideField,
  titleField,
  tooltipFields,
  unitPrecisionFields,
} from '../../shared/chart/chart-config'
import {
  AXIS_ITEMS_KEY,
  AXIS_SLOT_KEY,
  axisRowCounts,
  axisRowLabels,
  validateAxisRanges,
  COMPARE_NAME_DEFAULT,
  RADAR_EMPTY_TEXT,
  SERIES_NAME_DEFAULT,
} from './axes'
import {
  RADAR_AREA_OPACITY_DEFAULT,
  RADAR_AREA_OPACITY_MAX,
  RADAR_AREA_OPACITY_MIN,
  RADAR_AXIS_MAX_DEFAULT,
  RADAR_AXIS_MIN_DEFAULT,
  RADAR_MIN_AXES,
  RADAR_SHAPES,
  RADAR_SPLIT_DEFAULT,
  RADAR_SPLIT_MAX,
  RADAR_SPLIT_MIN,
  RADAR_STYLES,
} from './options'
import { RADAR_CHART_PRESETS } from './presets'

/** 填充不透明度只有铺了面的那一档才调得动。 */
const AREA_ONLY = { key: 'chartStyle', in: ['area'] }

export default defineModule({
  type: 'radar-chart',
  description:
    '多维雷达适合将不同量纲的指标按各自量程归一为综合轮廓，并支持主系列与对比系列横向比较；占比分析应选择构成环图。模块使用数组槽 `axisValues`，每行通过 `value` 和 `compare` 提供读数，轴名称、量程、单位与精度由配置定义。无效量程或缺失读数对应的轴会从轮廓中移除并在图例说明，避免以零值形成误导性凹陷。有效轴少于三根时进入空态。',
  displayName: '多维雷达',
  category: '图表',
  icon: 'chart-mixed',
  keywords: [
    'radar',
    'spider',
    'leida',
    'duowei',
    '雷达',
    '雷达图',
    '蜘蛛图',
    '多维',
    '评价',
    '画像',
    '对比',
  ],
  defaultSize: { width: 360, height: 300, minWidth: 200, minHeight: 180 },
  configPresets: RADAR_CHART_PRESETS,
  validateConfig: validateAxisRanges,
  contentKeys: [
    'title',
    AXIS_ITEMS_KEY,
    'emptyText',
    'seriesName',
    'compareName',
    'unit',
    'precision',
  ],
  configSchema: [
    ...titleField(),
    {
      key: AXIS_ITEMS_KEY,
      label: '指标',
      type: 'array',
      group: GROUP.data,
      help: '每项对应一根雷达轴和一个绑定行。至少三根有效轴才能形成轮廓；删除中间项会使后续绑定索引前移，请核对绑定关系。',
      itemLabelKey: 'name',
      minItems: RADAR_MIN_AXES,
      // ⚠ 出厂给三项：雷达少于三根轴退化成线段，只给一项时新拖出来的一块必然是空态，
      //   看着像模块坏了
      default: [
        {
          name: '指标 1',
          min: RADAR_AXIS_MIN_DEFAULT,
          max: RADAR_AXIS_MAX_DEFAULT,
        },
        {
          name: '指标 2',
          min: RADAR_AXIS_MIN_DEFAULT,
          max: RADAR_AXIS_MAX_DEFAULT,
        },
        {
          name: '指标 3',
          min: RADAR_AXIS_MIN_DEFAULT,
          max: RADAR_AXIS_MAX_DEFAULT,
        },
      ],
      span: 'full',
      itemSchema: [
        {
          key: 'name',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空则按「第 N 轴」称呼',
          help: '雷达轴名称；重名项在状态图例中自动追加序号。',
        },
        {
          key: 'min',
          label: '量程下限',
          // ⚠ 是数字框不是滑杆：量纲不同的指标量程差着几个数量级，滑杆表达不了
          type: 'number',
          default: RADAR_AXIS_MIN_DEFAULT,
          help: '该轴圆心对应的数值。',
        },
        {
          key: 'max',
          label: '量程上限',
          type: 'number',
          default: RADAR_AXIS_MAX_DEFAULT,
          help: '该轴外圈对应的数值。上限不大于下限时，该轴不参与渲染并在图例标记「量程配错」。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '留空时使用模块设置',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '该轴单位；留空时继承模块单位。首尾空格保持不变。',
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
      ],
    },
    {
      key: 'seriesName',
      label: '主系列名称',
      type: 'string',
      group: GROUP.data,
      default: SERIES_NAME_DEFAULT,
      span: 'half',
      help: '主系列的图例名称和联动值；留空时使用默认名称。',
    },
    {
      key: 'compareName',
      label: '对比组名称',
      type: 'string',
      group: GROUP.data,
      default: COMPARE_NAME_DEFAULT,
      span: 'half',
      help: '对比系列的图例名称。未配置任何对比绑定时不显示该系列。',
    },
    {
      key: 'emptyText',
      label: '无数据提示',
      type: 'string',
      group: GROUP.data,
      default: RADAR_EMPTY_TEXT,
      span: 'half',
      help: '未配置任何有效轴时显示；有效轴不足三根时显示逐轴原因。',
    },
    ...chartStyleField([...RADAR_STYLES], 'area'),
    {
      key: 'shape',
      label: '网格形状',
      type: 'enum',
      group: GROUP.style,
      default: 'polygon',
      span: 'half',
      help: '多边形可直观呈现轴数量；圆形更适合强调整体轮廓。',
      options: [...RADAR_SHAPES],
    },
    {
      key: 'splitCount',
      label: '网格环数',
      type: 'number',
      group: GROUP.style,
      default: RADAR_SPLIT_DEFAULT,
      min: RADAR_SPLIT_MIN,
      max: RADAR_SPLIT_MAX,
      step: 1,
      span: 'half',
      help: '从圆心到外圈的网格分段数；分段越多，数值参照越细密。',
    },
    {
      key: 'areaOpacity',
      label: '填充不透明度（%）',
      type: 'range',
      group: GROUP.style,
      default: RADAR_AREA_OPACITY_DEFAULT,
      min: RADAR_AREA_OPACITY_MIN,
      max: RADAR_AREA_OPACITY_MAX,
      step: 1,
      span: 'half',
      help: '控制重叠区域的可辨识度；上限为 80%，避免后绘制系列完全遮挡前序系列。',
      when: AREA_ONLY,
    },
    ...paletteOverrideField({ maxItems: 2 }),
    ...unitPrecisionFields(),
    // ⚠ 缺省开着：图例是「哪根轴画不出来、为什么」唯一的承载面
    //   （`ownsStatusDisplay` 让整格浮层不出），关着的话那几条在屏上一个字都没有
    ...legendFields({ default: true }),
    ...tooltipFields(),
    // ⚠ 缺省关着：两组 × 六根轴就是十二个数糊在轮子上，读数看提示框更清楚
    ...dataLabelFields({ default: false }),
    ...animationFields(),
  ],
  bindings: [
    {
      key: AXIS_SLOT_KEY,
      label: '逐轴读数',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
      dataType: 'number',
      isArray: true,
      // 行钉在配置里的指标上：轴数由配置决定，绑一部分是常态，空出来的
      // 不许让其后整体移位（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      // ⚠ 一个子槽都不给 isRequired：配了 6 根先接 3 根、对比组整条留空都是常态，
      //   给了会让整块被判 unbound 并盖上状态浮层，逐轴四档白画
      arrayFields: [
        { key: 'value', label: '本组', dataType: 'number' },
        { key: 'compare', label: '对比组', dataType: 'number' },
      ],
    },
  ],
  // 六根轴里坏掉一根不该让另外五根一起被浮层盖住，原因由模块自己在图例上交代
  ownsStatusDisplay: true,
  // 点某一组上抛它的名称
  emitsInteractions: true,
  // 雷达没有 dataZoom 滑块，也没有拖拽手势，整块可点可以一起开
  hostClickable: true,
  bindingRowLabels: axisRowLabels,
  // ⚠ 轴不是用户在绑点面板上随手加的：行号就是它的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行永远喂不到东西。
  //   ⚠ 一根轴都没有时也要给 0，别把键漏掉
  bindingRowCounts: axisRowCounts,
  preview: {
    config: {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 0, max: 100, unit: '分' },
        { name: '达标率', min: 0, max: 100, unit: '分' },
        { name: '健康度', min: 0, max: 100, unit: '分' },
        { name: '清洁度', min: 0, max: 100, unit: '分' },
        { name: '稳定性', min: 0, max: 100, unit: '分' },
      ],
    },
    values: {
      [AXIS_SLOT_KEY]: [
        { value: 82, compare: 70 },
        { value: 91, compare: 88 },
        { value: 64, compare: 76 },
        { value: 78, compare: 61 },
        { value: 86, compare: 80 },
      ],
    },
  },
  component: () => import('./Component.vue'),
})
