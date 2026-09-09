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
    '可组合卡片支持在固定数据格中组合名称、读数、状态、附加指标与进度部件，适合复合指标展示；标准 KPI 可选信息卡片，量程图形可选仪表卡片。数据通过 cellValues 数组绑定，第 i 行对应 cells 第 i 项，八个子槽由部件按需读取。删除或调整 cells 顺序会改变后续绑定索引，操作后必须复核绑定。',
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
  contentKeys: [
    'title',
    DATA_CARD_CELLS_KEY,
    DATA_CARD_PARTS_KEY,
    'emptyText',
    'defaultGroup',
    'rules',
    'alarmOn',
  ],
  subEditor: {
    configKey: DATA_CARD_PARTS_KEY,
    routeName: 'card-editor',
    label: '自定义卡片',
    hint: '在专用编辑器中配置数据格、部件与布局，并实时预览。',
  },
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
      key: DATA_CARD_CELLS_KEY,
      label: '格',
      type: 'array',
      group: '内容',
      help: '每项对应一个绑定行。删除中间项会使后续绑定索引前移，操作后请复核绑定。',
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
          placeholder: '留空则隐藏名称',
          help: '数据格名称；是否显示由“名称”部件控制。留空时绑定面板按序号标识。',
        },
        {
          key: 'icon',
          label: '图标',
          type: 'image',
          default: '',
          help: '数据格图标；是否显示由“图标”部件控制。部件级图标仅作为统一回退。',
        },
        {
          key: 'color',
          label: '基色',
          type: 'color',
          default: '',
          help: '设置当前数据格的基色，供进度条及跟色部件使用；留空时跟随卡片。建议填写 var(--…) 主题变量，固定色值不会随主题切换。',
        },
        {
          key: 'group',
          label: '分组',
          type: 'string',
          default: '',
          placeholder: '例如：洗浴 / 空调',
          help: '用于分段或页签归类；留空归入“其他”。未启用分组时不生效。',
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
          help: '点击数据格时发送的联动值；留空则不发送格级事件。',
        },
      ],
    },
    {
      key: DATA_CARD_PARTS_KEY,
      label: '部件',
      type: 'array',
      group: '内容',
      help: '定义数据格的部件组成与排列方式，所有数据格共用此配置。可在部件编辑器中拖拽排序。',
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
      help: '数据缺失时显示在读数位置的占位符；缺失值不会转换为 0。',
    },
    {
      key: 'grouping',
      label: '分组',
      type: 'enum',
      group: '分组',
      default: 'none',
      span: 'half',
      help: '按数据格的「分组」值进行分段或分页签；页签计数使用全部数据格，而非当前页签子集。',
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
      help: '默认选中的页签；留空或名称无效时使用第一个页签。',
    },
    ...scrollConfigFields(),
    valueRulesField(
      'rules',
      '值规则',
      '命中的格按规则的颜色描边并呼吸；按声明顺序取首个命中，高危规则放前面。',
    ),
    {
      key: 'alarmOn',
      label: '规则数据源',
      type: 'enum',
      default: 'value',
      span: 'half',
      options: [
        { value: 'value', label: '主读数' },
        { value: 'aux', label: '副读数' },
        { value: 'aux2', label: '第三读数' },
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
      help: '自动模式按最小列宽自适应排列，行数随数据格数量调整。',
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
      help: '启用后按「小数位」补零对齐（如 42.00 / 3.50），保持读数位数稳定。',
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
