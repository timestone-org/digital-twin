/**
 * @fileoverview data-table —— 数据表格：列头 + N 行 × M 列的矩阵。
 * 行钉在 `rows` 配置项上，列是八个固定子槽 `c1`…`c8`，每一列在 `columns` 里配名字、
 * 单位、小数位、对齐与宽度，见 docs/MODULE_DATA_TABLE_DESIGN.md。
 *
 * ⚠ 类型 id 是 `data-table` 而不是 `table`：守「零模块类型字面量」的那道闸按已注册的
 * type 逐个 grep 源码，短词会红在一堆与模块毫不相干的属性上。
 * ⚠ 这里绝不静态 import `Component.vue`：注册用的 glob 是 `eager: true`，
 * 静态引一下就把渲染组件并进注册 chunk，并破坏组件的懒加载语义。
 * ⚠ 区间与档位一律取自 `./options`：面板的 min / max 与渲染侧的夹取一旦各写一份，
 * 面板上拖得到的那一格渲染时会被夹回去——「配了不生效」。
 */
import { defineModule } from '../../registry'
import {
  CELL_SLOT_KEY,
  TABLE_COLUMNS_KEY,
  TABLE_EMPTY_TEXT,
  TABLE_ROWS_KEY,
  TABLE_RULES_KEY,
  tableRowCounts,
  tableRowLabels,
} from './cells'
import { NAME_HEADER_DEFAULT } from './look'
import {
  TABLE_ALIGNS,
  TABLE_COLUMN_KEYS,
  TABLE_DENSITIES,
  TABLE_FONT_MAX,
  TABLE_FONT_MIN,
  TABLE_GRID_LINES,
  TABLE_MAX_ROWS_CAP,
  TABLE_PRECISION_MAX,
  TABLE_TONES,
  TABLE_WIDTH_MAX,
} from './options'
import { DATA_TABLE_PRESETS } from './presets'
import { tableRulesField } from './rules'

/** 属性面板的分段标题。 */
const GROUP = {
  data: '数据',
  columns: '列',
  style: '样式',
  rules: '规则',
} as const

/**
 * 八个固定列键的子槽。
 * ⚠ 列数不能跟着 `columns` 的条数走：`arrayFields` 是清单里的**静态**声明，
 * 读不到某个节点的 config。八个够用，没启用的那几个不渲染也不占地方。
 * ⚠ 一个子槽都不给 `isRequired`：配了 8 列先接 2 列是常态，给了会让整块被判
 * `unbound` 并盖上状态浮层，逐格四档白画。
 */
const CELL_FIELDS = TABLE_COLUMN_KEYS.map((column) => ({
  key: column.value,
  label: column.label,
  // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
  dataType: 'number' as const,
}))

export default defineModule({
  type: 'data-table',
  description:
    '数据表格用于呈现固定对象与多项指标构成的二维矩阵；单对象指标可选信息卡片，单指标纵向比较可选信息列表。数据通过 cellValues 数组绑定，行按 rows 下标对应，列按 c1 至 c8 的列键对应，并分别配置名称、单位、精度和宽度。列顺序调整不影响绑定，删除中间行会移动后续下标；每个单元格独立呈现四档取值状态。',
  displayName: '数据表格',
  category: '数据',
  icon: 'table',
  keywords: [
    'table',
    'grid',
    'matrix',
    'biaoge',
    'liebiao',
    '表格',
    '数据表',
    '列表',
    '矩阵',
    '台账',
    '清单',
  ],
  defaultSize: { width: 480, height: 320, minWidth: 200, minHeight: 120 },
  configPresets: DATA_TABLE_PRESETS,
  contentKeys: [
    'title',
    'nameHeader',
    TABLE_COLUMNS_KEY,
    TABLE_ROWS_KEY,
    'precision',
    'emptyText',
    'maxRows',
    TABLE_RULES_KEY,
  ],
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: GROUP.data,
      default: '',
      span: 'half',
      placeholder: '留空则隐藏标题栏',
      help: '留空时隐藏标题栏，表格从模块顶部开始显示。',
    },
    {
      key: 'nameHeader',
      label: '行名列表头',
      type: 'string',
      group: GROUP.data,
      default: NAME_HEADER_DEFAULT,
      span: 'half',
      when: { key: 'showHeader', in: [true] },
      help: `最左侧行名列的表头；留空时使用「${NAME_HEADER_DEFAULT}」。`,
    },
    {
      key: TABLE_ROWS_KEY,
      label: '行',
      type: 'array',
      group: GROUP.data,
      help: '每项对应一个绑定行。删除中间项会使后续绑定索引前移，操作后请复核绑定。',
      itemLabelKey: 'name',
      minItems: 1,
      // ⚠ 出厂给一行：空列表时模块是一块什么都没有的白板，而属性面板上
      //   「新增一行」不在最显眼的位置，看着像模块坏了
      default: [{ name: '第 1 行' }],
      itemSchema: [
        {
          key: 'name',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空则按「第 N 行」称呼',
          help: '最左列显示名称，同时作为行级联动值；留空时仅按序号显示且不发送行级事件。',
        },
      ],
    },
    {
      key: TABLE_COLUMNS_KEY,
      label: '列',
      type: 'array',
      group: GROUP.columns,
      help: '每项定义一列，顺序即显示顺序。列键必须唯一；绑定按列键识别，不受列顺序、名称或单位调整影响。',
      itemLabelKey: 'name',
      minItems: 1,
      default: [{ key: 'c1', name: '数值', align: 'right' }],
      itemSchema: [
        {
          key: 'key',
          label: '列键',
          type: 'enum',
          default: 'c1',
          options: [...TABLE_COLUMN_KEYS],
          help: '指定该列对应的绑定子槽。同一表格内必须唯一；修改列键会切换整列的数据绑定。',
        },
        {
          key: 'name',
          label: '列名',
          type: 'string',
          default: '',
          placeholder: '留空则显示列键',
          help: '表头显示的名称；留空时显示列键，便于核对数据绑定。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '显示在读数后的单位，并保留首尾空格。无读数状态不显示单位，避免将占位符误认为有效读数。',
        },
        {
          key: 'precision',
          label: '小数位',
          // ⚠ 是数字框不是滑杆：滑杆没有空态，没配时面板上显示 0 而渲染按整块那一档
          //   走，两边对不上；而且拖过一次就再也回不到「跟随整块」
          type: 'number',
          // ⚠ 刻意没有 default：留空 = 跟随整块的小数位
          min: 0,
          max: TABLE_PRECISION_MAX,
          step: 1,
          help: '留空时使用模块的小数位设置。',
        },
        {
          key: 'align',
          label: '对齐',
          type: 'enum',
          default: 'right',
          options: [...TABLE_ALIGNS],
          help: '数值列建议右对齐以便逐行比较；文本列可使用左对齐。',
        },
        {
          key: 'width',
          label: '列宽 (px)',
          type: 'number',
          default: 0,
          min: 0,
          max: TABLE_WIDTH_MAX,
          step: 4,
          help: '0 表示不固定宽度，与其他自适应列均分剩余空间。',
        },
      ],
    },
    {
      key: 'precision',
      label: '小数位',
      type: 'number',
      group: GROUP.data,
      default: 2,
      min: 0,
      max: TABLE_PRECISION_MAX,
      step: 1,
      span: 'half',
      help: '未单独配置小数位的列使用此设置。',
    },
    {
      key: 'grouping',
      label: '千分位',
      type: 'boolean',
      group: GROUP.data,
      default: false,
      span: 'half',
      help: '启用后按三位分隔整数部分。同类指标宜保持一致，避免产生精度不一致的视觉误判。',
    },
    {
      key: 'emptyText',
      label: '空态文案',
      type: 'string',
      group: GROUP.data,
      default: TABLE_EMPTY_TEXT,
      span: 'half',
      help: '未配置任何行时显示在表格区域中央。已配置但未绑定的数据格不属于空态，仍按各自状态显示。',
    },
    {
      key: 'density',
      label: '行高',
      type: 'enum',
      group: GROUP.style,
      default: 'normal',
      span: 'half',
      options: [...TABLE_DENSITIES],
      help: '决定可视区域内的行密度。',
    },
    {
      key: 'striped',
      label: '斑马纹',
      type: 'boolean',
      group: GROUP.style,
      default: true,
      span: 'half',
      help: '为相邻行使用交替底色，便于横向识别数据。',
    },
    {
      key: 'gridLines',
      label: '网格线',
      type: 'enum',
      group: GROUP.style,
      default: 'horizontal',
      span: 'half',
      options: [...TABLE_GRID_LINES],
      help: '列数较多时可启用纵向网格线，以增强单元格边界。',
    },
    {
      key: 'showHeader',
      label: '显示表头',
      type: 'boolean',
      group: GROUP.style,
      default: true,
      span: 'half',
      help: '关闭后不再显示列名；仅在其他位置已明确标注列含义时关闭。',
    },
    {
      key: 'headerSticky',
      label: '钉住表头',
      type: 'boolean',
      group: GROUP.style,
      default: true,
      span: 'half',
      help: '滚动时将表头固定在顶部。关闭表头后此设置不生效。',
      when: { key: 'showHeader', in: [true] },
    },
    {
      key: 'maxRows',
      label: '最多显示行数',
      type: 'number',
      group: GROUP.style,
      default: 0,
      min: 0,
      max: TABLE_MAX_ROWS_CAP,
      step: 1,
      span: 'half',
      help: '0 表示不限制。截断时显示总行数与当前行数，其余行保留绑定但不参与渲染。',
    },
    {
      key: 'nameTone',
      label: '行名与表头层级',
      type: 'enum',
      group: GROUP.style,
      default: 'secondary',
      span: 'half',
      options: [...TABLE_TONES],
      help: '行名列与表头共用文字层级，并随主题更新。',
    },
    {
      key: 'headSize',
      label: '表头字号',
      type: 'number',
      group: GROUP.style,
      default: 12,
      min: TABLE_FONT_MIN,
      max: TABLE_FONT_MAX,
      step: 1,
      span: 'half',
      when: { key: 'showHeader', in: [true] },
      help: '设计坐标系像素。',
    },
    {
      key: 'nameSize',
      label: '行名字号',
      type: 'number',
      group: GROUP.style,
      default: 13,
      min: TABLE_FONT_MIN,
      max: TABLE_FONT_MAX,
      step: 1,
      span: 'half',
      help: '设计坐标系像素。',
    },
    {
      key: 'valueSize',
      label: '读数字号',
      type: 'number',
      group: GROUP.style,
      default: 14,
      min: TABLE_FONT_MIN,
      max: TABLE_FONT_MAX,
      step: 1,
      span: 'half',
      help: '设计坐标系像素。',
    },
    {
      key: 'valueColor',
      label: '读数颜色',
      type: 'color',
      group: GROUP.style,
      default: '',
      span: 'half',
      help: '留空时使用主题正文色。建议填写 var(--…) 主题变量；固定色值不会随主题切换。值规则命中时优先使用规则颜色。',
    },
    { ...tableRulesField(), group: GROUP.rules },
  ],
  bindings: [
    {
      key: CELL_SLOT_KEY,
      label: '单元格读数',
      dataType: 'number',
      isArray: true,
      // 行钉在配置里的行上：行数由配置决定，绑一部分是常态，空出来的
      // 不许让其后整体移位（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      arrayFields: CELL_FIELDS,
    },
  ],
  // 一格坏掉不该让整张表被浮层盖住，四档由模块自己逐格交代
  ownsStatusDisplay: true,
  // 点某一行上抛它的名字
  emitsInteractions: true,
  // 表格没有缩放滑块，也没有拖拽手势，整块可点可以一起开
  hostClickable: true,
  bindingRowLabels: tableRowLabels,
  // ⚠ 行不是用户在绑点面板上随手加的：行号就是它的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行永远喂不到任何东西。
  //   ⚠ 一行都没有时也要给 0，别把键漏掉
  bindingRowCounts: tableRowCounts,
  preview: {
    config: {
      [TABLE_ROWS_KEY]: [
        { name: '1# 逆变器' },
        { name: '2# 逆变器' },
        { name: '3# 逆变器' },
      ],
      [TABLE_COLUMNS_KEY]: [
        { key: 'c1', name: '功率', unit: 'kW', precision: 1 },
        { key: 'c2', name: '电压', unit: 'V', precision: 0 },
        { key: 'c3', name: '效率', unit: '%', precision: 1 },
      ],
    },
    values: {
      [CELL_SLOT_KEY]: [
        { c1: 412.6, c2: 683, c3: 98.2 },
        { c1: 398.1, c2: 679, c3: 97.6 },
        { c1: 405.4, c2: 681, c3: 98 },
      ],
    },
  },
  component: () => import('./Component.vue'),
})
