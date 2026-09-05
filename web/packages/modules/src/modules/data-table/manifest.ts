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
    '数据表格：列头 + N 行 × M 列的矩阵，回答「这一批对象的这几项分别是多少」。一台设备只看几个数用 info-card 或 data-card，逐行比高低用 info-list 的进度件，看占比构成用 pie-chart。一个数组绑定槽 `cellValues`，行钉在 `rows` 配置项上、列是八个固定子槽 `c1`…`c8`：第 i 行第 c 列那一格喂 `cellValues[i].c` ——列名、单位、小数位、对齐与列宽都是逐列的配置，不从点位来。⚠ 列的绑定按**列键**认，调列的顺序不动任何绑定；行的绑定按**下标**认，删掉 `rows` 中间一项会让它之后每一行的绑定都改喂前一行。⚠ 没在「列」里挑列键的子槽整列不渲染，重复挑同一个列键的那几列只画先声明的那一条并在表下说明。⚠ 逐格四档各有记号：没配来源画「—」、等首帧画「⋯」、取不到画「✕」并标红、有值才画数，完整原因挂在这一格的悬停提示上。⚠ `maxRows` 截断时表下面有一句说明，不会静默少画几行。点某一行上抛的联动值是这一行配置里写的名称，没起名的点了不上抛。',
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
    'emptyText',
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
      placeholder: '留空则不画标题栏',
      help: '留空时整条标题栏都不出，模块从最上面一行就开始画表。',
    },
    {
      key: 'nameHeader',
      label: '行名列表头',
      type: 'string',
      group: GROUP.data,
      default: NAME_HEADER_DEFAULT,
      span: 'half',
      help: `最左边那一列的列头文案；留空回落「${NAME_HEADER_DEFAULT}」。`,
    },
    {
      key: TABLE_ROWS_KEY,
      label: '行',
      type: 'array',
      group: GROUP.data,
      help: '每一项在绑点面板上是一行。⚠ 删掉中间一项，它之后每一行的绑定都会改喂前一行——删完请核对绑点面板。',
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
          help: '最左列显示的名字；留空时按「第 N 行」称呼它。点这一行上抛的联动值也是它，留空则这一行点了不上抛。',
        },
      ],
    },
    {
      key: TABLE_COLUMNS_KEY,
      label: '列',
      type: 'array',
      group: GROUP.columns,
      help: '一列一项，摆在行名列右边，顺序就是这里的顺序。⚠ 每一列必须挑一个**不同**的列键：列键就是绑定认的那一半，重复挑同一个的那几列读的是同一个子槽，只画先声明的那一条。⚠ 调顺序、改名字、删列都不动任何绑定——绑定按列键认，不按位置认。',
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
          help: '这一列读第几个子槽。⚠ 同一张表里不许重复：重复的那几列读的是同一个数，只有先声明的那一条会画出来。改它等于把这一列的绑定整条换掉。',
        },
        {
          key: 'name',
          label: '列名',
          type: 'string',
          default: '',
          placeholder: '留空则显示列键',
          help: '表头上的文案；留空时显示列键本身，好让人对得上绑点面板。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '跟在读数后面的单位。首尾空格照原样保留。⚠ 没有读数的那三档一律不带单位——「— kV」看着像是有读数的。',
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
          help: '留空跟随整块那一档。',
        },
        {
          key: 'align',
          label: '对齐',
          type: 'enum',
          default: 'right',
          options: [...TABLE_ALIGNS],
          help: '数值列右对齐才逐行对得齐；文本列可以改成左对齐。',
        },
        {
          key: 'width',
          label: '列宽 (px)',
          type: 'number',
          default: 0,
          min: 0,
          max: TABLE_WIDTH_MAX,
          step: 4,
          help: '0 = 不定宽，跟其余不定宽的列平分剩下的地方。',
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
      help: '没有单独配小数位的那几列用这一档。',
    },
    {
      key: 'grouping',
      label: '千分位',
      type: 'boolean',
      group: GROUP.data,
      default: false,
      span: 'half',
      help: '开了整数部分按三位分组。⚠ 一屏里开与不开混着用，同一个量看着像两个精度不同的表。',
    },
    {
      key: 'emptyText',
      label: '空态文案',
      type: 'string',
      group: GROUP.data,
      default: TABLE_EMPTY_TEXT,
      span: 'half',
      help: '一行都没配时画在表区正中的那一句。⚠ 「格子都还没绑」不算空：那时照画整张表，逐格自己交代四档。',
    },
    {
      key: 'density',
      label: '行高',
      type: 'enum',
      group: GROUP.style,
      default: 'normal',
      span: 'half',
      options: [...TABLE_DENSITIES],
      help: '一屏塞得下多少行由它决定。',
    },
    {
      key: 'striped',
      label: '斑马纹',
      type: 'boolean',
      group: GROUP.style,
      default: true,
      span: 'half',
      help: '隔行加一层很淡的底色，列多时更容易横着读一行。',
    },
    {
      key: 'gridLines',
      label: '网格线',
      type: 'enum',
      group: GROUP.style,
      default: 'horizontal',
      span: 'half',
      options: [...TABLE_GRID_LINES],
      help: '竖线在列多时帮着分格，列少时只会显得吵。',
    },
    {
      key: 'showHeader',
      label: '显示表头',
      type: 'boolean',
      group: GROUP.style,
      default: true,
      span: 'half',
      help: '⚠ 关掉之后没有任何一处写着这几列各是什么——只在列名已经画进标题里时才关。',
    },
    {
      key: 'headerSticky',
      label: '钉住表头',
      type: 'boolean',
      group: GROUP.style,
      default: true,
      span: 'half',
      help: '行多要滚时列头留在最上面。表头关着时这一项不起作用。',
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
      help: '0 = 不限。⚠ 截断时表下面会写一句「共 N 行，只显示前 M 行」——那几行的绑定还在，只是屏上不画。',
    },
    {
      key: 'nameTone',
      label: '行名与表头层级',
      type: 'enum',
      group: GROUP.style,
      default: 'secondary',
      span: 'half',
      options: [...TABLE_TONES],
      help: '行名列与表头共用一档文字层级，跟着主题走。',
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
      help: '留空跟随主题正文色。只填 var(--…) 引用，填死色值换肤时不跟着走。⚠ 命中值规则的那几格用规则自己的颜色，压过这一档。',
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
