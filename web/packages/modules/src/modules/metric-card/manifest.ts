/**
 * @fileoverview metric-card —— 实时数值：一块摆 1..N 个点位读数，带单位、
 * 四段带阈值与逐格状态。大屏上「看一眼现场此刻是什么数」的主力模块。
 *
 * 为什么是「一块 N 个指标」而不是「一块一个点位」：一屏二十个读数时，后者要拖
 * 二十个模块、配二十遍标题字号与卡片外观，而它们本该长得一模一样。行与指标
 * 一一对应，绑点面板因此与孪生同一套口径（`bindingRowCounts` 的注释）。
 */
import { defineModule } from '../../registry'
import {
  METRIC_ITEMS_KEY,
  METRIC_SLOT_KEY,
  metricRowCounts,
  metricRowLabels,
  readMetricItems,
} from './metrics'

export default defineModule({
  type: 'metric-card',
  displayName: '实时数值',
  category: '数据',
  icon: 'gauge',
  keywords: ['metric', 'shuzhi', '数值', '指标', '读数', '实时', 'kpi'],
  defaultSize: { width: 420, height: 180, minWidth: 120, minHeight: 64 },
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '内容',
      default: '',
      span: 'full',
      placeholder: '留空则不画标题栏',
    },
    {
      key: METRIC_ITEMS_KEY,
      label: '指标',
      type: 'array',
      group: '内容',
      help: '每一项在绑点面板上是一行。⚠ 删掉中间一项，它之后每一行的绑定都会改喂前一个指标——删完请核对绑点面板。',
      itemLabelKey: 'label',
      minItems: 1,
      // ⚠ 出厂给一项：空列表时模块是一块什么都没有的白板，而属性面板上
      //   「新增一行」不在最显眼的位置，看着像模块坏了
      default: [{ label: '指标 1', unit: '', kind: 'number', precision: 1 }],
      itemSchema: [
        {
          key: 'label',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空显示「指标 N」',
        },
        {
          key: 'kind',
          label: '值的类型',
          type: 'enum',
          default: 'number',
          options: [
            { value: 'number', label: '数值' },
            { value: 'boolean', label: '开关量' },
            { value: 'text', label: '文本' },
          ],
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '如 °C / kV / MW',
        },
        {
          key: 'precision',
          label: '小数位',
          type: 'range',
          default: 1,
          min: 0,
          max: 6,
          step: 1,
          when: { key: 'kind', in: ['number'] },
        },
        {
          key: 'trueText',
          label: '真值文案',
          type: 'string',
          default: '运行',
          when: { key: 'kind', in: ['boolean'] },
          // 0/1 的数值点位也走这一档，见 metrics.ts 的 toBool
          help: '点位值非 0 时显示它；点位是 0/1 数值也算开关量。',
        },
        {
          key: 'falseText',
          label: '假值文案',
          type: 'string',
          default: '停止',
          when: { key: 'kind', in: ['boolean'] },
        },
        {
          key: 'dangerBelow',
          label: '危险下限',
          type: 'number',
          help: '低于它标红。留空 = 这一侧不判。',
        },
        {
          key: 'warnBelow',
          label: '预警下限',
          type: 'number',
          help: '低于它标黄。留空 = 这一侧不判。',
        },
        {
          key: 'warnAbove',
          label: '预警上限',
          type: 'number',
          help: '高于它标黄。留空 = 这一侧不判。',
        },
        {
          key: 'dangerAbove',
          label: '危险上限',
          type: 'number',
          help: '高于它标红。留空 = 这一侧不判。',
        },
        {
          key: 'key',
          label: '联动值',
          type: 'string',
          default: '',
          help: '点这一格时上抛的值，留空则这一格点了不上抛。',
        },
      ],
    },
    {
      key: 'layout',
      label: '排布',
      type: 'enum',
      group: '排布',
      default: 'auto',
      span: 'half',
      help: '自动：只有一项时大字居中，多项时按网格。',
      options: [
        { value: 'auto', label: '自动' },
        { value: 'grid', label: '网格' },
        { value: 'list', label: '列表行' },
      ],
    },
    {
      key: 'columns',
      label: '列数',
      type: 'range',
      group: '排布',
      default: 2,
      min: 1,
      max: 6,
      step: 1,
      span: 'half',
      when: { key: 'layout', in: ['grid'] },
    },
    {
      key: 'density',
      label: '疏密',
      type: 'enum',
      group: '排布',
      default: 'normal',
      span: 'half',
      options: [
        { value: 'compact', label: '紧凑' },
        { value: 'normal', label: '标准' },
        { value: 'loose', label: '宽松' },
      ],
    },
    {
      key: 'align',
      label: '格内对齐',
      type: 'enum',
      group: '排布',
      default: 'left',
      span: 'half',
      when: { key: 'layout', in: ['auto', 'grid'] },
      options: [
        { value: 'left', label: '左' },
        { value: 'center', label: '中' },
      ],
    },
    {
      key: 'valueSize',
      label: '读数字号 (px)',
      type: 'range',
      group: '文字',
      // 0 是哨兵：跟着格子大小走，而不是钉死一个字号
      default: 0,
      min: 0,
      max: 96,
      step: 1,
      span: 'half',
      help: '0 = 跟着格子大小自动缩放。',
    },
    {
      key: 'labelSize',
      label: '名称字号 (px)',
      type: 'range',
      group: '文字',
      default: 12,
      min: 8,
      max: 32,
      step: 1,
      span: 'half',
    },
    {
      key: 'valueColor',
      label: '读数颜色',
      type: 'color',
      group: '文字',
      // 命中阈值时由严重度色覆盖，见 MetricCell.vue
      default: 'var(--card-text, var(--text-primary))',
      span: 'half',
      help: '命中阈值的那一格改用严重度颜色，这里配的是没有告警时的颜色。',
    },
    {
      key: 'grouping',
      label: '千分位',
      type: 'boolean',
      group: '文字',
      default: false,
      span: 'half',
    },
    {
      key: 'emptyText',
      label: '无数据占位',
      type: 'string',
      group: '文字',
      default: '—',
      span: 'half',
      help: '⚠ 别填 0：墙上的「0」与「没有数据」长得一样时，停机与归零就再也分不出来。',
    },
    {
      key: 'showStatusDot',
      label: '状态点',
      type: 'boolean',
      group: '状态',
      default: true,
      span: 'half',
      help: '配了阈值边界的指标才有状态点：没有判据就连「正常」都不该说。',
    },
    {
      key: 'showUpdatedAt',
      label: '更新时刻',
      type: 'boolean',
      group: '状态',
      default: false,
      span: 'half',
      help: '显示这一格读数的采样时刻（时:分:秒），用来看现场还动不动。',
    },
  ],
  bindings: [
    {
      key: METRIC_SLOT_KEY,
      label: '指标读数',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位：开关量与文本
      //   指标照样绑得上 opcua 点位（BindingSourceEditor.vue）
      dataType: 'number',
      isArray: true,
      // 行钉在指标上：行数由配置决定，绑一部分指标是常态，空出来的行不许让
      // 其后整体移位（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      arrayFields: [{ key: 'value', label: '读数', dataType: 'number' }],
    },
  ],
  // 十个指标里坏掉一个不该让另外九个一起被浮层盖住，四档由模块自己逐格交代
  ownsStatusDisplay: true,
  // 点某一格上抛这一格的联动值（配了联动值的格子才抛）
  emitsInteractions: true,
  // 整块可点由宿主接管；格内点击在模板里 `.stop`，否则同一次点击会被兜底再抛一次
  hostClickable: true,
  bindingRowLabels: (config) =>
    metricRowLabels(readMetricItems(config[METRIC_ITEMS_KEY])),
  // ⚠ 行不是用户在绑点面板上随手加的：行号就是指标的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行没有对应指标、永远喂不到任何东西
  bindingRowCounts: (config) =>
    metricRowCounts(readMetricItems(config[METRIC_ITEMS_KEY])),
  preview: {
    config: {
      [METRIC_ITEMS_KEY]: [
        { label: '主变温度', unit: '°C', kind: 'number', precision: 1 },
        { label: '母线电压', unit: 'kV', kind: 'number', precision: 2 },
        { label: '有功功率', unit: 'MW', kind: 'number', precision: 2 },
        { label: '运行状态', unit: '', kind: 'boolean' },
      ],
    },
  },
  component: () => import('./Component.vue'),
})
