/**
 * @fileoverview pie-chart —— 构成环图：把几路实时读数按占比画成饼 / 环 / 玫瑰。
 * 占比由前端按当前取到数的那几片归一，扇区名、单位、小数位与固定色留在配置里，
 * 见 docs/MODULE_PIE_CHART_DESIGN.md 与 docs/DASHBOARD_CHART_MODULES_DESIGN.md §3。
 *
 * ⚠ 类型 id 是 `pie-chart` 而不是 `pie`：守「零模块类型字面量」的那道闸按已注册的
 * type 逐个 grep 源码，短词会红在一堆与模块毫不相干的属性上。
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
  PIE_CENTER_TEXTS,
  PIE_INNER_RADIUS_DEFAULT,
  PIE_OUTER_RADIUS_MIN,
  PIE_OUTER_RADIUS_DEFAULT,
  PIE_RADIUS_MAX,
  PIE_RADIUS_MIN,
  PIE_STYLES,
} from './options'
import { PIE_CHART_PRESETS } from './presets'
import {
  PIE_EMPTY_TEXT,
  SLICE_ITEMS_KEY,
  SLICE_SLOT_KEY,
  sliceRowCounts,
  sliceRowLabels,
} from './slices'

/** 环心读数与它的单位只有在有心可写的两档上才摆得出来。 */
const RING_ONLY = { key: 'chartStyle', in: ['donut', 'rose'] }

/** 环心单位只修饰数值，片数模式不需要单位。 */
const CENTER_UNIT_ONLY = { key: 'centerText', in: ['sum', 'max'] }

export default defineModule({
  type: 'pie-chart',
  description:
    '构成环图适合呈现多项非负实时读数的占比关系，支持实心饼、环形和玫瑰样式；需要比较绝对高低时应选择对比柱图。模块使用数组槽 `sliceValues`，每行的 `value` 对应一个扇区，名称、单位、小数位和颜色由配置定义。占比仅基于当前有效扇区归一计算，未绑定、异常或负值数据不进入分母。中心读数由有效扇区派生，片数模式不使用单位。',
  displayName: '构成环图',
  category: '图表',
  icon: 'chart-pie',
  keywords: [
    'pie',
    'donut',
    'rose',
    'bingtu',
    'huantu',
    'zhanbi',
    '饼图',
    '环图',
    '环形图',
    '玫瑰图',
    '占比',
    '构成',
    '比例',
  ],
  defaultSize: { width: 360, height: 280, minWidth: 160, minHeight: 140 },
  configPresets: PIE_CHART_PRESETS,
  contentKeys: [
    'title',
    SLICE_ITEMS_KEY,
    'emptyText',
    'centerText',
    'centerUnit',
    'unit',
    'precision',
  ],
  configSchema: [
    ...titleField(),
    {
      key: SLICE_ITEMS_KEY,
      label: '扇区',
      type: 'array',
      group: GROUP.data,
      help: '每项对应一个绑定行。删除中间项会使后续绑定索引前移；删除后请核对绑定关系。',
      itemLabelKey: 'name',
      minItems: 1,
      // ⚠ 出厂给一项：空列表时模块是一块什么都没有的白板，而属性面板上
      //   「新增一行」不在最显眼的位置，看着像模块坏了
      default: [{ name: '扇区 1', color: '', unit: '' }],
      span: 'full',
      itemSchema: [
        {
          key: 'name',
          label: '名称',
          type: 'string',
          default: '',
          placeholder: '留空则按「第 N 片」称呼',
          help: '用于图例、扇区标签和联动值。留空时显示「第 N 片」且不触发分项联动；重名项在图例中自动追加序号，联动仍使用原名称。',
        },
        {
          key: 'color',
          label: '固定颜色',
          type: 'color',
          default: '',
          help: '设置后覆盖色板。建议使用 var(--…) 主题变量，以支持主题切换。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '留空时使用模块设置',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '该扇区单位；留空时继承模块单位。首尾空格保持不变。',
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
      key: 'emptyText',
      label: '无数据提示',
      type: 'string',
      group: GROUP.data,
      default: PIE_EMPTY_TEXT,
      span: 'half',
      help: '无有效扇区时显示；部分扇区有效时仍正常呈现有效数据。',
    },
    {
      key: 'centerText',
      label: '中心读数',
      type: 'enum',
      group: GROUP.data,
      default: 'none',
      span: 'half',
      help: '由当前有效扇区派生，不增加绑定。仅环形与玫瑰样式可用。',
      options: [...PIE_CENTER_TEXTS],
      when: RING_ONLY,
    },
    {
      key: 'centerUnit',
      label: '中心单位',
      type: 'string',
      group: GROUP.data,
      default: '',
      span: 'half',
      placeholder: '留空时使用模块设置',
      help: '合计和最大值的单位；留空时继承模块单位。片数模式不使用单位。',
      when: CENTER_UNIT_ONLY,
    },
    ...chartStyleField([...PIE_STYLES], 'donut'),
    {
      key: 'innerRadius',
      label: '内半径（%）',
      type: 'range',
      group: GROUP.style,
      default: PIE_INNER_RADIUS_DEFAULT,
      min: PIE_RADIUS_MIN,
      max: PIE_RADIUS_MAX,
      step: 1,
      span: 'half',
      help: '相对于绘图区短边的百分比。若不小于外半径，将自动调整以保留最小环宽。',
      when: RING_ONLY,
    },
    {
      key: 'outerRadius',
      label: '外半径（%）',
      type: 'range',
      group: GROUP.style,
      default: PIE_OUTER_RADIUS_DEFAULT,
      min: PIE_OUTER_RADIUS_MIN,
      max: PIE_RADIUS_MAX,
      step: 1,
      span: 'half',
      help: '相对于绘图区短边的百分比；启用扇区标签时需预留引线空间。',
    },
    ...paletteOverrideField(),
    ...unitPrecisionFields(),
    // ⚠ 缺省开着：图例是逐片四档唯一的承载面（`ownsStatusDisplay` 让整格浮层不出），
    //   关着的话「取不到」与「等首帧」在屏上一个字都没有
    ...legendFields({ default: true }),
    ...tooltipFields(),
    ...dataLabelFields(),
    ...animationFields(),
  ],
  bindings: [
    {
      key: SLICE_SLOT_KEY,
      label: '扇区数值',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
      dataType: 'number',
      isArray: true,
      // 行钉在配置里的扇区上：片数由配置决定，绑一部分是常态，空出来的
      // 不许让其后整体移位（DASHBOARD_DESIGN §4.2）
      isEntityPinned: true,
      // ⚠ 一个子槽都不给 isRequired：配了 6 片先接 2 片是常态，
      //   给了会让整块被判 unbound 并盖上状态浮层，逐片四档白画
      arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
    },
  ],
  // 六片里坏掉一片不该让另外五片一起被浮层盖住，四档由模块自己在图例上交代
  ownsStatusDisplay: true,
  // 点某一片上抛它的名字
  emitsInteractions: true,
  // 饼图没有 dataZoom 滑块，也没有拖拽手势，整块可点可以一起开
  hostClickable: true,
  bindingRowLabels: sliceRowLabels,
  // ⚠ 扇区不是用户在绑点面板上随手加的：行号就是它的文档序。不声明行数的话，
  //   面板会摆出「新增一行」，加出来的那一行永远喂不到任何东西。
  //   ⚠ 一片都没有时也要给 0，别把键漏掉
  bindingRowCounts: sliceRowCounts,
  preview: {
    config: {
      [SLICE_ITEMS_KEY]: [
        { name: '光伏', unit: 'kWh' },
        { name: '市电', unit: 'kWh' },
        { name: '储能', unit: 'kWh' },
      ],
    },
    values: {
      [SLICE_SLOT_KEY]: [{ value: 420 }, { value: 265 }, { value: 118 }],
    },
  },
  component: () => import('./Component.vue'),
})
