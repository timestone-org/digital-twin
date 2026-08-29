/**
 * @fileoverview data-card —— 可组合卡片：一块摆 1..N 个格，**每格画什么由用户自己拼**。
 * 内容是一张部件列表（名称、读数、进度条、分隔线……），加一种部件是新建一个目录，
 * 这个模块一行不改。见 docs/MODULE_DATA_CARD_DESIGN.md。
 *
 * ⚠ 类型 id 是 `data-card` 而不是 `card`：守「零模块类型字面量」的那道闸按已注册的
 * type 逐个 grep 源码，`card` 这种常见词会红在一堆与模块毫不相干的属性上。
 */
import type { BindingRowLabel, ConfigField } from '@dt/contracts'

import { CARD_PART_KIND_KEY, CARD_PART_PLACE_KEY } from '../../cardParts/define'
import { scrollConfigFields } from '../../shared/scroll'
import { valueRulesField } from '../../shared/valueRules'
import { CARD_SLOT_DOCS } from '../../cardParts/types'
import { defineModule } from '../../registry'
import type { CardCell } from './cells'
import {
  DATA_CARD_CELLS_KEY,
  DATA_CARD_PARTS_KEY,
  DATA_CARD_SLOT_KEY,
  readCells,
} from './cells'
import { BUILTIN_CARD_PARTS } from './parts'

/**
 * 部件档的下拉。取自**静态**的内置清单——运行期登记的第三方部件画得出来，
 * 但进不了构建期导出的目录，故不在这张名单里。
 */
const KIND_FIELD: ConfigField = {
  key: CARD_PART_KIND_KEY,
  label: '部件',
  type: 'enum',
  default: 'value',
  span: 'half',
  options: BUILTIN_CARD_PARTS.map((part) => ({
    value: part.kind,
    label: part.label,
  })),
}

/**
 * 部件表的行字段：档位下拉 + 全部内置部件的字段并集。
 * ⚠ 并集靠 `when: { key: 'kind' }` 各露各的，属性面板与助手因此白拿——
 * 这条路完全落在现有机制内，一行适配代码都不用写（§3.1）。
 */
/**
 * 这一件在格里怎么占位。与 `kind` 一样是内建字段，不属于任何一档，故不前缀化。
 * ⚠ 成行规则在 `cardParts/lines.ts`：整行独占；连续的左件聚成左簇、右件聚成右簇；
 * 右件之后再来左件就起新的一行。
 */
const PLACE_FIELD: ConfigField = {
  key: CARD_PART_PLACE_KEY,
  label: '占位',
  type: 'enum',
  default: 'block',
  span: 'half',
  help: '整行独占，或与相邻的同行件左右分列。',
  options: [
    { value: 'block', label: '整行' },
    { value: 'left', label: '同行·靠左' },
    { value: 'right', label: '同行·靠右' },
  ],
}

const PART_ITEM_SCHEMA: ConfigField[] = [
  KIND_FIELD,
  PLACE_FIELD,
  ...BUILTIN_CARD_PARTS.flatMap((part) => part.fields),
]

/**
 * 绑点面板上每一格叫什么。
 * ⚠ 没配名称的格在墙上不画名字，但在绑点面板上仍得有个称呼——十几格全靠数行号
 * 认对象，是这套面板最容易接错的地方。
 * @param cells 归一化后的格列表
 */
function rowLabels(
  cells: readonly CardCell[],
): Record<string, BindingRowLabel> {
  const labels: Record<string, BindingRowLabel> = {}
  cells.forEach((cell, index) => {
    labels[`${DATA_CARD_SLOT_KEY}[${String(index)}].value`] = {
      title: cell.label === '' ? `第 ${String(index + 1)} 格` : cell.label,
      id: cell.emitValue,
    }
  })
  return labels
}

export default defineModule({
  type: 'data-card',
  description:
    '可组合卡片：一块摆 1..N 个格，**每格画什么由用户自己拼**——一张部件列表（名称 / 读数 / 进度条 / 分隔线），可增删、可排序，所有格共用这一份。要在卡片里嵌进度条、或要一种兄弟模块摆不出来的段序时用它；只要朴素的数字加单位、不必自己拼段序用 info-card，要量程 / 液位那种图形用 gauge-card，要一行多字段的清单用 info-list，要一条条推来的消息用 info-feed。一个数组绑定槽 `cellValues`，行钉在 `cells` 配置项上：第 i 行喂第 i 格。四个子槽 `value` / `aux` / `ratio` / `state` 是**固定**的，部件从里面挑着读，不会因为加了部件而多出槽。⚠ 部件读哪个槽由它自己声明：读数与进度条读 `value`，进度条接了 `ratio` 就直接用它、不再按量程算。⚠ 单位与小数位是**逐格**的配置，不从点位来，同一格里所有部件共用一份。⚠ 删掉 `cells` 中间一格，它之后每一格的绑定都会改喂前一格。',
  displayName: '可组合卡片',
  category: '数据',
  icon: 'layers',
  keywords: [
    'datacard',
    'zuhe',
    'kapian',
    '可组合',
    '卡片',
    '部件',
    '进度条',
    '自定义',
  ],
  defaultSize: { width: 420, height: 220, minWidth: 120, minHeight: 64 },
  contentKeys: ['title', DATA_CARD_CELLS_KEY, 'emptyText'],
  subEditor: {
    configKey: DATA_CARD_PARTS_KEY,
    routeName: 'card-editor',
    label: '自定义卡片',
    hint: '格、部件与排布都在那里边配边看。',
  },
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
      key: DATA_CARD_CELLS_KEY,
      label: '格',
      type: 'array',
      group: '内容',
      help: '每一项在绑点面板上是一行。⚠ 删掉中间一项，它之后每一格的绑定都会改喂前一格——删完请核对绑点面板。',
      itemLabelKey: 'label',
      minItems: 1,
      // ⚠ 出厂给一项：空列表时模块是一块什么都没有的白板，而「新增一行」不在
      //   最显眼的位置，看着像模块坏了
      default: [{ label: '点位 1', unit: '', precision: 1 }],
      span: 'full',
      itemSchema: [
        {
          key: 'label',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空则这一格不画名称',
          help: '这一格的名称。⚠ 画不画由「名称」部件决定，这里只管叫什么；绑点面板上仍按「第 N 格」称呼它。',
        },
        {
          key: 'icon',
          label: '图标',
          type: 'image',
          default: '',
          help: '素材库里的图标。⚠ 画不画由「图标」部件决定；图标是逐格配的，配在部件上会让整卡十个格画同一个。',
        },
        {
          key: 'group',
          label: '分组',
          type: 'string',
          default: '',
          placeholder: '如 洗浴 / 空调',
          help: '分段与页签按它归堆；留空则归到「其他」。卡片上的「分组」档选了不分组时这一项不起作用。',
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
          default: 1,
          min: 0,
          max: 6,
          step: 1,
        },
        {
          key: 'emitValue',
          label: '联动值',
          type: 'string',
          default: '',
          help: '点这一格时上抛的值，留空则这一格点了不上抛。',
        },
      ],
    },
    {
      key: DATA_CARD_PARTS_KEY,
      label: '部件',
      type: 'array',
      group: '内容',
      help: '每一格画成什么样。所有格共用这一份——它是观感不是数据。整页编辑器里拖着排更顺手。',
      itemLabelKey: CARD_PART_KIND_KEY,
      minItems: 1,
      default: [{ kind: 'label' }, { kind: 'value' }],
      span: 'full',
      itemSchema: PART_ITEM_SCHEMA,
    },
    {
      key: 'emptyText',
      label: '缺值占位',
      type: 'string',
      group: '内容',
      default: '—',
      span: 'half',
      help: '取不到值时画在读数位的那个符号。⚠ 缺值绝不伪造 0。',
    },
    {
      key: 'grouping',
      label: '分组',
      type: 'enum',
      group: '分组',
      default: 'none',
      span: 'half',
      help: '按格上的「分组」字符串分段或分页签。⚠ 页签的计数用全量格数，不是当前页签的子集。',
      options: [
        { value: 'none', label: '不分组' },
        { value: 'section', label: '分段组头' },
        { value: 'tabs', label: '分类页签' },
      ],
    },
    {
      key: 'defaultGroup',
      label: '初始页签',
      type: 'string',
      group: '分组',
      default: '',
      span: 'half',
      when: { key: 'grouping', in: ['tabs'] },
      help: '进来时停在哪一页；留空或写错则停在第一页。',
    },
    ...scrollConfigFields(),
    valueRulesField(
      'rules',
      '值规则',
      '命中的格按规则的颜色描边并呼吸；按声明顺序取首个命中，高危规则放前面。',
    ),
    {
      key: 'alarmOn',
      label: '规则判哪个槽',
      type: 'enum',
      default: 'value',
      span: 'half',
      options: [
        { value: 'value', label: '主读数' },
        { value: 'aux', label: '副读数' },
        { value: 'aux2', label: '第三个数' },
        { value: 'ratio', label: '占比' },
        { value: 'state', label: '状态码' },
        { value: 'extra1', label: '附加字段一' },
        { value: 'extra2', label: '附加字段二' },
        { value: 'extra3', label: '附加字段三' },
      ],
    },
    {
      key: 'columns',
      label: '列数',
      type: 'enum',
      group: '排布',
      default: 'auto',
      span: 'half',
      help: '自动 = 按最小列宽自适应铺满；行数一律随格数自适应。',
      options: [
        { value: 'auto', label: '自动' },
        { value: '1', label: '1 列' },
        { value: '2', label: '2 列' },
        { value: '3', label: '3 列' },
        { value: '4', label: '4 列' },
      ],
    },
    {
      key: 'align',
      label: '格内对齐',
      type: 'enum',
      group: '排布',
      default: 'center',
      span: 'half',
      options: [
        { value: 'start', label: '左对齐' },
        { value: 'center', label: '居中' },
        { value: 'end', label: '右对齐' },
      ],
    },
    {
      key: 'gapX',
      label: '列间距 (px)',
      type: 'range',
      group: '排布',
      default: 10,
      min: 0,
      max: 40,
      step: 1,
      span: 'half',
    },
    {
      key: 'gapY',
      label: '行间距 (px)',
      type: 'range',
      group: '排布',
      default: 10,
      min: 0,
      max: 40,
      step: 1,
      span: 'half',
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
      key: 'cellShell',
      label: '格外壳',
      type: 'enum',
      group: '外壳',
      default: 'plain',
      span: 'half',
      options: [
        { value: 'plain', label: '无' },
        { value: 'card', label: '描边小卡' },
        { value: 'accent', label: '描边 + 左侧竖条' },
      ],
    },
    {
      key: 'cellPadX',
      label: '格左右内边距 (px)',
      type: 'range',
      group: '外壳',
      default: 12,
      min: 0,
      max: 40,
      step: 1,
      span: 'half',
    },
    {
      key: 'cellPadY',
      label: '格上下内边距 (px)',
      type: 'range',
      group: '外壳',
      default: 8,
      min: 0,
      max: 40,
      step: 1,
      span: 'half',
    },
    {
      key: 'partGap',
      label: '部件间距 (px)',
      type: 'range',
      group: '外壳',
      default: 4,
      min: 0,
      max: 24,
      step: 1,
      span: 'half',
    },
    {
      key: 'thousands',
      label: '千分位分隔',
      type: 'boolean',
      group: '格式',
      default: false,
      span: 'half',
    },
    {
      key: 'fixedDecimals',
      label: '固定小数位',
      type: 'boolean',
      group: '格式',
      default: false,
      span: 'half',
      help: '开着时按「小数位」补零对齐（42.00 / 3.50），读数跳动时位数不变。',
    },
  ],
  bindings: [
    {
      key: DATA_CARD_SLOT_KEY,
      label: '格读数',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
      dataType: 'number',
      isArray: true,
      // 格钉在配置里的项上：格数由配置决定，绑一部分格是常态（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      // ⚠ 一个子槽都不给 isRequired：摆了四个部件先接一个槽是常态，
      //   给了会让整块被判 unbound 并盖上状态浮层
      arrayFields: [
        { key: 'value', label: '主读数', dataType: 'number' },
        { key: 'aux', label: '对比值 / 目标', dataType: 'number' },
        { key: 'aux2', label: '第三个数', dataType: 'number' },
        { key: 'ratio', label: '占比（0–100）', dataType: 'number' },
        { key: 'state', label: '状态码', dataType: 'number' },
        { key: 'extra1', label: '附加字段一', dataType: 'number' },
        { key: 'extra2', label: '附加字段二', dataType: 'number' },
        { key: 'extra3', label: '附加字段三', dataType: 'number' },
      ],
    },
  ],
  // 十格里坏掉一格不该让另外九格一起被浮层盖住，四档由模块自己逐格交代
  ownsStatusDisplay: true,
  // 点某一格上抛这一格的联动值（配了联动值的格才抛）
  emitsInteractions: true,
  // 整块可点由宿主接管；格内点击在模板里 `.stop`，否则同一次点击会被兜底再抛一次
  hostClickable: true,
  bindingRowLabels: (config) =>
    rowLabels(readCells(config[DATA_CARD_CELLS_KEY])),
  // ⚠ 格不是用户在绑点面板上随手加的：行号就是格的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行永远喂不到任何东西。
  bindingRowCounts: (config) => ({
    [DATA_CARD_SLOT_KEY]: readCells(config[DATA_CARD_CELLS_KEY]).length,
  }),
  preview: {
    config: {
      [DATA_CARD_CELLS_KEY]: [
        { label: '进水温度', unit: '℃', precision: 1 },
        { label: '回水温度', unit: '℃', precision: 1 },
        { label: '水箱液位', unit: '%', precision: 0 },
      ],
      [DATA_CARD_PARTS_KEY]: [
        { kind: 'label' },
        { kind: 'value' },
        { kind: 'meter', 'meter-caption': '占比' },
      ],
    },
    values: {
      [DATA_CARD_SLOT_KEY]: [
        { value: 12.4, ratio: 62 },
        { value: 18.1, ratio: 78 },
        { value: 46, ratio: 46 },
      ],
    },
  },
  component: () => import('./Component.vue'),
})

/** 子槽的意思，随清单一起给人与模型看。 */
export const CARD_SLOT_HELP = CARD_SLOT_DOCS
