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
    '仪表卡片：一块摆 1..N 个带量程的读数，五档几何（弧度盘 / 横向条 / 目标轨道 / 储罐 / 温度计）共用「量程 → 百分比 → 填充」同一条链，可画刻度、量程端点与目标标记。读数要表达「离满还有多远」「完成了多少」「液位到哪儿」时用它；只要裸数字加单位用 data-card 或 info-card，要带图标与涨跌对比的卡片网格用 info-card，要一行里带副读数与徽章的清单用 info-list。一个数组绑定槽 `gaugeValues`，行钉在 `items` 配置项上：第 i 行喂第 i 个仪表，子槽 `value` 是主读数、`aux` 是目标值的实时来源（绑了就顶掉行内那个静态「目标值」），都收数值；量程上下限、单位、小数位是逐项的配置，不从点位来。⚠ 每一项的「量程上限」必须大于「量程下限」，否则这一个仪表既不画填充也不伪造 0%；「目标值」留空 = 不画目标标记且完成率退回按量程算。⚠ 删掉 `items` 中间一项，它之后每一个仪表的绑定都会改喂前一个。',
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
      placeholder: '留空则不画标题栏',
    },
    {
      key: GAUGE_ITEMS_KEY,
      label: '仪表',
      type: 'array',
      group: '内容',
      help: '每一项在绑点面板上是一行。⚠ 删掉中间一项，它之后每一个仪表的绑定都会改喂前一个——删完请核对绑点面板。',
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
          placeholder: '留空则这一个不画标签',
          // ⚠ 留空不是「回落一个默认名」：标签整行不渲染，档位类名也跟着不挂
          help: '这一个仪表的名称；留空则不画标签。绑点面板上仍按「第 N 个仪表」称呼它。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '如 ℃ / kWh / m³/h',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '首尾空格照原样保留，「° C」这种写法是有意的排版。',
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
          help: '百分比 =（值 − 下限）÷（上限 − 下限），填充与刻度都按它算。',
        },
        {
          key: 'max',
          label: '量程上限',
          type: 'number',
          default: 100,
          help: '⚠ 上限不大于下限时这一个仪表不画填充，也不伪造 0%——量程错了比空着更难发现。',
        },
        {
          key: 'target',
          label: '目标值',
          // ⚠ 刻意没有 default：留空 = 不画目标标记、完成率退回按量程算。
          //   给个 0 会让完成率一路除零
          type: 'number',
          help: '留空则不画目标标记，完成率也退回按量程算。完成率 = 值 ÷ 目标，可以超过 100%。',
        },
        {
          key: 'color',
          label: '固定颜色',
          type: 'color',
          default: '',
          help: '填了就固定这一个仪表的填充色并压过规则命中色。只填 var(--…) 引用，填死色值换肤时不跟着走。',
        },
        {
          key: 'emitValue',
          label: '联动值',
          type: 'string',
          default: '',
          help: '点这一个仪表时上抛的值，留空则这一个点了不上抛。',
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
      help: '取不到值时画在读数位的那个符号。⚠ 缺值绝不伪造 0，填充也一并不画。',
    },
    {
      key: 'layout',
      label: '排布',
      type: 'enum',
      group: '排布',
      default: 'auto',
      span: 'half',
      help: '自动 = 只有一个时铺满整块，多个时按网格。',
      options: [...GAUGE_LAYOUTS],
    },
    {
      key: 'columns',
      label: '列数',
      type: 'enum',
      group: '排布',
      default: 'auto',
      span: 'half',
      help: '自动 = 按最小列宽自适应铺满；行数一律随仪表个数自适应。',
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
      help: '行列同值：仪表是方的，横竖分两个旋钮只会让网格歪。',
    },
    {
      key: 'padX',
      label: '整块左右内边距 (px)',
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
      label: '整块上下内边距 (px)',
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
      help: '五档共用同一条「量程 → 百分比 → 填充」的链，只在最后一步分叉。',
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
      help: '五个子键按几何档各管一段：弧度盘吃厚度与张角、横向条与目标轨道吃厚度、储罐吃罐宽、温度计吃管宽与球径。',
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
          help: `0 = 随几何档：弧 9 / 条 12 / 轨道 18；非零按 ${GAUGE_THICKNESS_MIN}–${GAUGE_THICKNESS_MAX} 夹取。储罐与温度计不吃这一项。`,
        },
        {
          key: 'arcSpan',
          label: '弧张角 (°)',
          type: 'range',
          default: GAUGE_ARC_SPAN_DEFAULT,
          min: GAUGE_ARC_SPAN_MIN,
          max: GAUGE_ARC_SPAN_MAX,
          step: 5,
          help: '缺口永远在正下方居中。只有弧度盘吃这一项。',
        },
        {
          key: 'tankWidth',
          label: '罐宽 (px)',
          type: 'range',
          default: GAUGE_SIZE_BOUNDS.tankWidth.fallback,
          min: GAUGE_SIZE_BOUNDS.tankWidth.min,
          max: GAUGE_SIZE_BOUNDS.tankWidth.max,
          step: 1,
          help: '同时受「不超过半块宽」约束，窄块里罐会自己收窄。只有储罐吃这一项。',
        },
        {
          key: 'tubeWidth',
          label: '管宽 (px)',
          type: 'range',
          default: GAUGE_SIZE_BOUNDS.tubeWidth.fallback,
          min: GAUGE_SIZE_BOUNDS.tubeWidth.min,
          max: GAUGE_SIZE_BOUNDS.tubeWidth.max,
          step: 1,
          help: '管顶是半圆帽，宽度改了帽子跟着走。只有温度计吃这一项。',
        },
        {
          key: 'bulbSize',
          label: '球径 (px)',
          type: 'range',
          default: GAUGE_SIZE_BOUNDS.bulbSize.fallback,
          min: GAUGE_SIZE_BOUNDS.bulbSize.min,
          max: GAUGE_SIZE_BOUNDS.bulbSize.max,
          step: 1,
          help: '温度计底下那个球的直径。只有温度计吃这一项。',
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
      help: '渐变档由填充色自己调深浅；自定义色标档按下面那张表左右分色（红区→绿区那种彩虹弧）。',
      options: [...GAUGE_FILL_STYLES],
    },
    {
      key: 'indicator',
      label: '读数指示',
      type: 'enum',
      group: '几何',
      default: 'fill',
      span: 'half',
      help: '填充 = 填到读数处；满弧 + 指针 = 整条弧是量程、指针指位置。⚠ 只有弧度盘吃这一项，其余四档摆着不生效。',
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
      help: '只有「填充上色 = 自定义色标」那一档吃它，且至少要两档才生效。⚠ 颜色只填 var(--…) 引用或十六进制；算出来的色值换肤时不跟着走。',
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
          help: '在仪表两端标出下限与上限（弧度盘 / 横向条）。',
        },
        {
          key: 'ticks',
          label: '显示刻度',
          type: 'boolean',
          default: false,
          help: '在轨道下方摆一排等距刻度（横向条 / 目标轨道）。',
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
          help: '首尾各占一个，四个即 0 / 33.3 / 66.7 / 100。',
        },
        {
          key: 'wanFormat',
          label: '按「万」显示',
          type: 'boolean',
          default: false,
          help: '⚠ 量程上限不足 1 万时整卡回落原始格式：小量程走「万」会让刻度全塌成「0.0万」，信息全失。',
        },
        {
          key: 'wanDigits',
          label: '「万」小数位',
          type: 'range',
          default: 2,
          min: 0,
          max: 4,
          step: 1,
          help: '刻度、读数与目标标签共用这一个小数位。',
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
      help: '刻度与量程端点共用这一个字号。',
    },
    {
      key: 'targetMark',
      label: '画目标标记',
      type: 'boolean',
      group: '目标',
      default: true,
      span: 'half',
      help: '⚠ 只在这一个仪表填了目标值时才画：没有目标就连标记位都不占。',
    },
    {
      key: 'targetLabel',
      label: '目标标签',
      type: 'string',
      group: '目标',
      default: '计划',
      span: 'half',
      placeholder: '如 计划 / 目标',
      help: '画在目标标记上方，后面紧接目标值。',
    },
    {
      key: 'showPercent',
      label: '显示完成率',
      type: 'boolean',
      group: '目标',
      default: true,
      span: 'half',
      help: '⚠ 完成率 = 值 ÷ 目标，不夹取、可以超过 100%；与「量程百分比」不是一个数。',
    },
    {
      key: 'readout',
      label: '读数显示',
      type: 'enum',
      group: '读数',
      default: 'value',
      span: 'half',
      help: '⚠ 这里的百分比是**量程**百分比（夹在 0–100），不是完成率。',
      options: [...GAUGE_READOUTS],
    },
    {
      key: 'readoutPlace',
      label: '读数位置',
      type: 'enum',
      group: '读数',
      default: 'center',
      span: 'half',
      help: '⚠ 横向条与目标轨道要吃满整行，「旁边」在这两档上落在轨道上方那一行。',
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
      help: '0 = 跟着块宽自适应。填正数即钉死一个字号，多个并排时字号才对得齐。',
    },
    {
      key: 'valueColor',
      label: '读数颜色',
      type: 'color',
      group: '读数',
      // 命中规则的那一个改用规则自己的颜色，这里是没命中时的颜色
      default: 'var(--accent-primary)',
      span: 'half',
      help: '命中取值规则的那一个改用规则的颜色，这里配的是没有命中时的颜色。',
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
      help: '两档都与读数同基线，差的只是那一道小间隙。',
      options: [...GAUGE_UNIT_PLACES],
    },
    {
      key: 'labelPlace',
      label: '标签位置',
      type: 'enum',
      group: '标签',
      default: 'below',
      span: 'half',
      help: '⚠ 它只管摆在哪儿，不管显不显示：这一个没有名称时整行不渲染。要藏标签就把那一项的「名称」留空。',
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
      placeholder: '留空 = 跟随读数颜色',
      help: '这一项配的是整块的填充色；逐个仪表的固定颜色与规则命中色都压过它。',
    },
    {
      key: 'trackColor',
      label: '轨道底色',
      type: 'color',
      group: '配色',
      default: '',
      span: 'half',
      placeholder: '留空 = 跟随主题的沉底色',
      help: '空轨道那一层的颜色；填满的那一段走填充色。',
    },
    {
      key: 'thousands',
      label: '千分位分隔',
      type: 'boolean',
      group: '格式',
      default: true,
      span: 'half',
      help: '读数、刻度与目标标签一起走这一档。',
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
