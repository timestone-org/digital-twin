/**
 * @fileoverview gauge-card —— 仪表卡片：一块摆 1..N 个带量程的读数，五档几何
 * （弧度盘 / 横向条 / 目标轨道 / 储罐 / 温度计）共用「量程 → 百分比 → 填充」同一条链，
 * 排布、几何、刻度、目标、读数、单位、标签、配色八组档位正交可配。参考仓
 * target-progress 与 entity-gauge 两个模块收敛成本模块的六套预设，
 * 见 docs/MODULE_INFO_CARD_DESIGN.md §4.2 与 §5.2。
 *
 * ⚠ 类型 id 是 `gauge-card` 而不是 `gauge`：守「零模块类型字面量」的那道闸按已注册的
 * type 逐个 grep 源码，`gauge` 这种常见词会红在一堆与模块毫不相干的属性上。
 * ⚠ 区间与档位一律取自 `./options` / `./geometry` / `./look` 的常量：属性面板的 min / max 与
 * 取值层的夹取一旦各写一份，面板上拖得到的那一格渲染时会被夹回去——「配了不生效」。
 */
import type { BindingRowLabel } from '@dt/contracts'

import { defineModule } from '../../registry'
import {
  GAUGE_ARC_SPAN_DEFAULT,
  GAUGE_ARC_SPAN_MAX,
  GAUGE_ARC_SPAN_MIN,
  GAUGE_TICK_COUNT_DEFAULT,
  GAUGE_TICK_COUNT_MAX,
  GAUGE_TICK_COUNT_MIN,
} from './geometry'
import type { GaugeItem } from './gauges'
import {
  GAUGE_ITEMS_KEY,
  GAUGE_SLOT_KEY,
  gaugeFieldKey,
  readGaugeItems,
} from './gauges'
import { GAUGE_SIZE_BOUNDS } from './look'
import {
  GAUGE_COLUMNS,
  GAUGE_FILL_STYLES,
  GAUGE_INDICATORS,
  GAUGE_LABEL_PLACES,
  GAUGE_LABEL_TONES,
  GAUGE_LAYOUTS,
  GAUGE_READOUT_PLACES,
  GAUGE_READOUTS,
  GAUGE_SHAPES,
  GAUGE_THICKNESS_MAX,
  GAUGE_THICKNESS_MIN,
  GAUGE_UNIT_PLACES,
} from './options'
import { GAUGE_CARD_PRESETS } from './presets'
import { valueRulesField } from './rules'

/**
 * 绑点面板上每一个仪表叫什么：名字给人看，联动值给人核对。
 * ⚠ 没配名称的仪表在墙上不画标签，但在绑点面板上仍得有个称呼——十几个全靠数行号
 * 认对象，是这套面板最容易接错的地方。
 * @param items 归一化后的仪表列表
 */
function rowLabels(
  items: readonly GaugeItem[],
): Record<string, BindingRowLabel> {
  const labels: Record<string, BindingRowLabel> = {}
  items.forEach((item, index) => {
    labels[gaugeFieldKey(index, 'value')] = {
      title: item.label === '' ? `第 ${index + 1} 个仪表` : item.label,
      id: item.emitValue,
    }
  })
  return labels
}

export default defineModule({
  type: 'gauge-card',
  description:
    '仪表卡片用于表达数值在量程中的位置，支持弧形、横向条、目标轨道、储罐和温度计；仅需标准数字时可选信息卡片。数据通过 gaugeValues 数组绑定，第 i 行对应 items 第 i 项，value 为主值，aux 为动态目标值。每项必须配置有效量程；aux 一旦绑定便优先于静态目标，取值失败时不会回退为静态值。',
  displayName: '仪表卡片',
  category: '数据',
  icon: 'gauge',
  keywords: [
    'gauge',
    'yibiao',
    'jindu',
    'mubiao',
    '仪表',
    '仪表盘',
    '进度',
    '目标',
    '储罐',
    '温度计',
    '液位',
  ],
  defaultSize: { width: 320, height: 220, minWidth: 120, minHeight: 96 },
  configPresets: GAUGE_CARD_PRESETS,
  contentKeys: ['title', GAUGE_ITEMS_KEY, 'emptyText', 'rules'],
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '内容',
      default: '',
      span: 'full',
      placeholder: '留空则隐藏标题栏',
    },
    {
      key: GAUGE_ITEMS_KEY,
      label: '仪表',
      type: 'array',
      group: '内容',
      help: '每项对应一个绑定行。删除中间项会使后续绑定索引前移，操作后请复核绑定。',
      itemLabelKey: 'label',
      minItems: 1,
      // ⚠ 出厂给一项：空列表时模块是一块什么都没有的白板，而属性面板上
      //   「新增一行」不在最显眼的位置，看着像模块坏了
      default: [{ label: '点位 1', unit: '', precision: 0 }],
      span: 'full',
      itemSchema: [
        {
          key: 'label',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空则隐藏标签',
          // ⚠ 留空不是「回落一个默认名」：标签整行不渲染，档位类名也跟着不挂
          help: '仪表名称；留空则隐藏标签，绑定面板仍按序号标识。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '例如：℃ / kWh / m³/h',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '保留首尾空格，可用于控制单位与读数的间距。',
        },
        {
          key: 'precision',
          label: '小数位',
          type: 'range',
          default: 0,
          min: 0,
          max: 6,
          step: 1,
        },
        {
          key: 'min',
          label: '量程下限',
          type: 'number',
          default: 0,
          help: '百分比按“（当前值 − 下限）÷（上限 − 下限）”计算，填充与刻度均使用该结果。',
        },
        {
          key: 'max',
          label: '量程上限',
          type: 'number',
          default: 100,
          help: '上限必须大于下限；量程无效时不显示填充或百分比。',
        },
        {
          key: 'target',
          label: '目标值',
          // ⚠ 刻意没有 default：留空 = 不画目标标记、完成率退回按量程算。
          //   给个 0 会让完成率一路除零
          type: 'number',
          help: '留空时隐藏目标标记，并按量程计算完成率。配置后按“当前值 ÷ 目标值”计算，结果可超过 100%。',
        },
        {
          key: 'color',
          label: '固定颜色',
          type: 'color',
          default: '',
          help: '设置仪表基础色；规则命中色优先。建议使用 var(--…) 主题变量。',
        },
        {
          key: 'emitValue',
          label: '联动值',
          type: 'string',
          default: '',
          help: '点击仪表时发送的联动值；留空则不发送仪表级事件。',
        },
      ],
    },
    {
      key: 'emptyText',
      label: '缺值占位',
      type: 'string',
      group: '内容',
      default: '—',
      span: 'half',
      help: '数据缺失时显示在读数位置的占位符；缺失值不会转换为 0，同时隐藏填充。',
    },
    {
      key: 'layout',
      label: '排布',
      type: 'enum',
      group: '排布',
      default: 'auto',
      span: 'half',
      help: '自动模式下，单个仪表填满模块，多个仪表使用网格排列。',
      options: [...GAUGE_LAYOUTS],
    },
    {
      key: 'columns',
      label: '列数',
      type: 'enum',
      group: '排布',
      default: 'auto',
      span: 'half',
      help: '自动模式按最小列宽自适应排列，行数随仪表数量调整。',
      options: [...GAUGE_COLUMNS],
    },
    {
      key: 'gap',
      label: '仪表间距 (px)',
      type: 'range',
      group: '排布',
      default: 10,
      min: 0,
      max: 40,
      step: 1,
      span: 'half',
      help: '水平与垂直间距使用相同数值，以保持方形仪表网格规整。',
    },
    {
      key: 'padX',
      label: '模块水平内边距 (px)',
      type: 'range',
      group: '排布',
      default: 10,
      min: 0,
      max: 40,
      step: 1,
      span: 'half',
    },
    {
      key: 'padY',
      label: '模块垂直内边距 (px)',
      type: 'range',
      group: '排布',
      default: 6,
      min: 0,
      max: 40,
      step: 1,
      span: 'half',
    },
    {
      key: 'shape',
      label: '几何',
      type: 'enum',
      group: '几何',
      default: 'arc',
      span: 'half',
      help: '五种几何形态共用“量程 → 百分比 → 填充”计算，仅最终绘制方式不同。',
      options: [...GAUGE_SHAPES],
    },
    {
      key: 'geometry',
      label: '尺寸',
      type: 'object',
      group: '几何',
      span: 'full',
      // ⚠ 五个子键一律全摆：簇内子字段的条件显示判的是**簇内**同级取值，
      //   判不到顶层的几何档，摆不出「按几何档只露相关的那几个」（§10.13）
      help: '弧形使用厚度与张角；横向条和目标轨道使用厚度；储罐使用罐宽；温度计使用管宽与球径。',
      default: {
        thickness: 0,
        arcSpan: GAUGE_ARC_SPAN_DEFAULT,
        tankWidth: GAUGE_SIZE_BOUNDS.tankWidth.fallback,
        tubeWidth: GAUGE_SIZE_BOUNDS.tubeWidth.fallback,
        bulbSize: GAUGE_SIZE_BOUNDS.bulbSize.fallback,
      },
      fields: [
        {
          key: 'thickness',
          label: '进度厚度 (px)',
          type: 'range',
          default: 0,
          // ⚠ 下限是 0 而不是 2：0 是「随几何档」的哨兵，取值层据它回落
          min: 0,
          max: GAUGE_THICKNESS_MAX,
          step: 1,
          help: `0 表示使用几何默认值：弧形 9、横向条 12、目标轨道 18；自定义值限制在 ${GAUGE_THICKNESS_MIN}–${GAUGE_THICKNESS_MAX}。储罐与温度计不适用。`,
        },
        {
          key: 'arcSpan',
          label: '弧张角 (°)',
          type: 'range',
          default: GAUGE_ARC_SPAN_DEFAULT,
          min: GAUGE_ARC_SPAN_MIN,
          max: GAUGE_ARC_SPAN_MAX,
          step: 5,
          help: '弧形专用；缺口固定在正下方中央。',
        },
        {
          key: 'tankWidth',
          label: '罐宽 (px)',
          type: 'range',
          default: GAUGE_SIZE_BOUNDS.tankWidth.fallback,
          min: GAUGE_SIZE_BOUNDS.tankWidth.min,
          max: GAUGE_SIZE_BOUNDS.tankWidth.max,
          step: 1,
          help: '储罐专用；实际宽度不超过可用区域的一半。',
        },
        {
          key: 'tubeWidth',
          label: '管宽 (px)',
          type: 'range',
          default: GAUGE_SIZE_BOUNDS.tubeWidth.fallback,
          min: GAUGE_SIZE_BOUNDS.tubeWidth.min,
          max: GAUGE_SIZE_BOUNDS.tubeWidth.max,
          step: 1,
          help: '温度计专用；管顶圆角随管宽同步调整。',
        },
        {
          key: 'bulbSize',
          label: '球径 (px)',
          type: 'range',
          default: GAUGE_SIZE_BOUNDS.bulbSize.fallback,
          min: GAUGE_SIZE_BOUNDS.bulbSize.min,
          max: GAUGE_SIZE_BOUNDS.bulbSize.max,
          step: 1,
          help: '温度计专用；设置底部球体直径。',
        },
      ],
    },
    {
      key: 'fillStyle',
      label: '填充上色',
      type: 'enum',
      group: '几何',
      default: 'solid',
      span: 'half',
      help: '渐变模式根据填充色生成明暗变化；自定义色标模式按下方色标从左至右分配颜色。',
      options: [...GAUGE_FILL_STYLES],
    },
    {
      key: 'indicator',
      label: '读数指示',
      type: 'enum',
      group: '几何',
      default: 'fill',
      span: 'half',
      help: '“填充”按读数裁切弧长；“满弧 + 指针”以完整弧线表示量程，并用指针标示当前位置。',
      when: { key: 'shape', in: ['arc'] },
      options: [...GAUGE_INDICATORS],
    },
    {
      key: 'colorStops',
      label: '色标',
      type: 'array',
      group: '几何',
      span: 'full',
      itemLabelKey: 'color',
      default: [],
      when: { key: 'fillStyle', in: ['stops'] },
      help: '至少配置两个色标。建议使用 var(--…) 主题变量；固定色值不会随主题切换。',
      itemSchema: [
        {
          key: 'at',
          label: '位置 (%)',
          type: 'range',
          default: 0,
          min: 0,
          max: 100,
          step: 1,
          span: 'half',
        },
        {
          key: 'color',
          label: '颜色',
          type: 'color',
          default: '',
          span: 'half',
        },
      ],
    },
    {
      key: 'scale',
      label: '刻度',
      type: 'object',
      group: '刻度',
      span: 'full',
      default: {
        showRange: false,
        ticks: false,
        tickCount: GAUGE_TICK_COUNT_DEFAULT,
        wanFormat: false,
        wanDigits: 2,
      },
      fields: [
        {
          key: 'showRange',
          label: '显示量程端点',
          type: 'boolean',
          default: false,
          help: '在仪表两端显示量程下限与上限，适用于全部几何形态。',
        },
        {
          key: 'ticks',
          label: '显示刻度',
          type: 'boolean',
          default: false,
          help: '在目标轨道下方显示等距刻度。',
        },
        {
          key: 'tickCount',
          label: '刻度个数',
          type: 'range',
          default: GAUGE_TICK_COUNT_DEFAULT,
          // ⚠ 至少两个：一个刻度会让「等分」的分母变 0，整排刻度全是 NaN 而模板照画
          min: GAUGE_TICK_COUNT_MIN,
          max: GAUGE_TICK_COUNT_MAX,
          step: 1,
          when: { key: 'ticks', in: [true] },
          help: '刻度包含量程两端；配置 4 个刻度时对应 0 / 33.3 / 66.7 / 100。',
        },
        {
          key: 'wanFormat',
          label: '按「万」显示',
          type: 'boolean',
          default: false,
          help: '量程上限低于 1 万时使用原始格式，避免「万」格式将小量程刻度显示为相同数值。',
        },
        {
          key: 'wanDigits',
          label: '「万」小数位',
          type: 'range',
          default: 2,
          min: 0,
          max: 4,
          step: 1,
          when: { key: 'wanFormat', in: [true] },
          help: '刻度、读数与目标标签共用此小数位设置。',
        },
      ],
    },
    {
      key: 'tickSize',
      label: '刻度字号 (px)',
      type: 'range',
      group: '刻度',
      default: 10,
      min: 8,
      max: 20,
      step: 1,
      span: 'half',
      help: '刻度与量程端点共用此字号设置。',
    },
    {
      key: 'targetMark',
      label: '显示目标标记',
      type: 'boolean',
      group: '目标',
      default: true,
      span: 'half',
      when: { key: 'shape', in: ['track'] },
      help: '仅在目标值有效时显示，不预留空白位置。',
    },
    {
      key: 'targetLabel',
      label: '目标标签',
      type: 'string',
      group: '目标',
      default: '计划',
      span: 'half',
      when: { key: 'targetMark', in: [true] },
      placeholder: '例如：计划 / 目标',
      help: '显示在目标标记上方，并与目标值相邻。',
    },
    {
      key: 'showPercent',
      label: '显示完成率',
      type: 'boolean',
      group: '目标',
      default: true,
      span: 'half',
      when: { key: 'shape', in: ['track'] },
      help: '完成率按“当前值 ÷ 目标值”计算，不限制在 100% 以内；该值与量程百分比不同。',
    },
    {
      key: 'readout',
      label: '读数显示',
      type: 'enum',
      group: '读数',
      default: 'value',
      span: 'half',
      help: '此处显示量程百分比，并限制在 0–100；不表示完成率。',
      options: [...GAUGE_READOUTS],
    },
    {
      key: 'readoutPlace',
      label: '读数位置',
      type: 'enum',
      group: '读数',
      default: 'center',
      span: 'half',
      help: '横向条与目标轨道使用整行宽度，因此“图形旁边”显示在轨道上方。',
      options: [...GAUGE_READOUT_PLACES],
    },
    {
      key: 'valueSize',
      label: '读数字号 (px)',
      type: 'range',
      group: '读数',
      default: 0,
      min: 0,
      max: 200,
      step: 1,
      span: 'half',
      help: '0 表示根据模块宽度自适应；正数表示固定字号，便于多个仪表保持一致。',
    },
    {
      key: 'valueColor',
      label: '读数颜色',
      type: 'color',
      group: '读数',
      // 命中规则的那一个改用规则自己的颜色，这里是没命中时的颜色
      default: 'var(--accent-primary)',
      span: 'half',
      help: '未命中取值规则时使用此颜色；命中后使用规则颜色。',
    },
    {
      key: 'valueGlow',
      label: '读数辉光 (px)',
      type: 'range',
      group: '读数',
      default: 0,
      min: 0,
      max: 24,
      step: 1,
      span: 'half',
    },
    {
      key: 'unitSize',
      label: '单位字号 (px)',
      type: 'range',
      group: '单位',
      default: 12,
      min: 8,
      max: 32,
      step: 1,
      span: 'half',
    },
    {
      key: 'unitPlace',
      label: '单位位置',
      type: 'enum',
      group: '单位',
      default: 'baseline',
      span: 'half',
      help: '两种位置均与读数保持同一基线，仅间距不同。',
      options: [...GAUGE_UNIT_PLACES],
    },
    {
      key: 'labelPlace',
      label: '标签位置',
      type: 'enum',
      group: '标签',
      default: 'below',
      span: 'half',
      help: '设置标签相对读数的位置；名称留空时不显示标签。',
      options: [...GAUGE_LABEL_PLACES],
    },
    {
      key: 'labelSize',
      label: '标签字号 (px)',
      type: 'range',
      group: '标签',
      default: 12,
      min: 8,
      max: 48,
      step: 1,
      span: 'half',
    },
    {
      key: 'labelTone',
      label: '标签文字色',
      type: 'enum',
      group: '标签',
      default: 'secondary',
      span: 'half',
      options: [...GAUGE_LABEL_TONES],
    },
    {
      key: 'fillColor',
      label: '填充色',
      type: 'color',
      group: '配色',
      default: '',
      span: 'half',
      placeholder: '留空时跟随读数颜色',
      help: '设置模块的默认填充色；单个仪表的固定颜色与规则颜色优先级更高。',
    },
    {
      key: 'trackColor',
      label: '轨道底色',
      type: 'color',
      group: '配色',
      default: '',
      span: 'half',
      placeholder: '留空时使用主题轨道色',
      help: '设置未填充轨道的颜色；已填充区域使用填充色。',
    },
    {
      key: 'thousands',
      label: '千分位分隔',
      type: 'boolean',
      group: '格式',
      default: true,
      span: 'half',
      help: '读数、刻度与目标标签共用此文字颜色。',
    },
    { ...valueRulesField('rules', '取值规则'), group: '告警' },
  ],
  bindings: [
    {
      key: GAUGE_SLOT_KEY,
      label: '仪表读数',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
      dataType: 'number',
      isArray: true,
      // 行钉在配置里的项上：仪表个数由配置决定，绑一部分是常态，空出来的
      // 不许让其后整体移位（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      // ⚠ 一个子槽都不给 isRequired：配了 6 个先接 2 个是常态，
      //   给了会让整块被判 unbound 并盖上状态浮层，逐个四档白画
      arrayFields: [
        { key: 'value', label: '主读数', dataType: 'number' },
        { key: 'aux', label: '目标实际值', dataType: 'number' },
      ],
    },
  ],
  // 六个仪表里坏掉一个不该让另外五个一起被浮层盖住，四档由模块自己逐个交代
  ownsStatusDisplay: true,
  // 点某一个仪表上抛它的联动值（配了联动值的才抛）
  emitsInteractions: true,
  // 整块可点由宿主接管；仪表内点击在模板里 `.stop`，否则同一次点击会被兜底再抛一次
  hostClickable: true,
  bindingRowLabels: (config) =>
    rowLabels(readGaugeItems(config[GAUGE_ITEMS_KEY])),
  // ⚠ 仪表不是用户在绑点面板上随手加的：行号就是它的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行永远喂不到任何东西。
  //   ⚠ 一个都没有时也要给 0，别把键漏掉
  bindingRowCounts: (config) => ({
    [GAUGE_SLOT_KEY]: readGaugeItems(config[GAUGE_ITEMS_KEY]).length,
  }),
  preview: {
    config: {
      [GAUGE_ITEMS_KEY]: [
        { label: '发电功率', unit: 'kW', precision: 0, min: 0, max: 1200 },
      ],
    },
    values: { [GAUGE_SLOT_KEY]: [{ value: 862 }] },
  },
  component: () => import('./Component.vue'),
})
