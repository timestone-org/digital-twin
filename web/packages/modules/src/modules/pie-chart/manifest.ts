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

export default defineModule({
  type: 'pie-chart',
  description:
    '构成环图：把几路实时读数按占比画成饼 / 环 / 玫瑰，回答「这几个量各占多少」。要逐行比高低用 info-list 的进度件，只要几个裸数字用 info-card 或 data-card，要「离满还有多远」用 gauge-card。一个数组绑定槽 `sliceValues`，行钉在 `slices` 配置项上：第 i 行喂第 i 片，唯一的子槽 `value` 收数值；扇区名、单位、小数位与固定颜色是逐片的配置，不从点位来，环心那个读数也是从当前这几片派生的、不占绑定槽。⚠ 占比只按**当前取到数的那几片**归一：取不到的那一片不进分母，配了 6 片先接 2 片时画的就是这 2 片的百分百。⚠ 负值在扇形上没有几何意义，整片剔除并在图例上标注原因，不取绝对值混进去。⚠ 删掉 `slices` 中间一项，它之后每一片的绑定都会改喂前一片。⚠ 图例是逐片状态唯一的承载面，缺省开着；关掉它「等首帧」与「取不到」在屏上就一个字都没有了。点某一片上抛的联动值是这一片配置里写的名称，没起名的点了不上抛。',
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
  contentKeys: ['title', SLICE_ITEMS_KEY, 'emptyText', 'centerUnit'],
  configSchema: [
    ...titleField(),
    {
      key: SLICE_ITEMS_KEY,
      label: '扇区',
      type: 'array',
      group: GROUP.data,
      help: '每一项在绑点面板上是一行。⚠ 删掉中间一项，它之后每一片的绑定都会改喂前一片——删完请核对绑点面板。',
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
          help: '图例与扇区标签上的名字；留空时按「第 N 片」称呼它。点这一片上抛的联动值也是它，留空则这一片点了不上抛。⚠ 两片重名会被加上 #1 这样的后缀，否则 echarts 会把它们并成一条图例；上抛的仍是这里写的原名。',
        },
        {
          key: 'color',
          label: '固定颜色',
          type: 'color',
          default: '',
          help: '填了就固定这一片的颜色，压过色板。只填 var(--…) 引用，填死色值换肤时不跟着走。',
        },
        {
          key: 'unit',
          label: '单位',
          type: 'string',
          default: '',
          placeholder: '留空跟随整块',
          // ⚠ 不去首尾空格：「° C」这类带空格是用户显式的排版意图
          help: '这一片自己的单位，留空跟随整块那一档。首尾空格照原样保留。',
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
      ],
    },
    {
      key: 'emptyText',
      label: '空态文案',
      type: 'string',
      group: GROUP.data,
      default: PIE_EMPTY_TEXT,
      span: 'half',
      help: '一片都画不出来时画在图区正中的那一句。⚠ 只接了一部分片不算空：那时照画接到的那几片。',
    },
    {
      key: 'centerText',
      label: '环心读数',
      type: 'enum',
      group: GROUP.data,
      default: 'none',
      span: 'half',
      help: '从当前画得出来的那几片派生，不占绑定槽。⚠ 实心饼没有心可写，这一项只对环形与玫瑰生效。',
      options: [...PIE_CENTER_TEXTS],
      when: RING_ONLY,
    },
    {
      key: 'centerUnit',
      label: '环心单位',
      type: 'string',
      group: GROUP.data,
      default: '',
      span: 'half',
      placeholder: '留空跟随整块',
      help: '环心那个数后面的单位；留空时合计与最大片跟随整块的单位，片数不带单位。',
      when: RING_ONLY,
    },
    ...chartStyleField([...PIE_STYLES], 'donut'),
    {
      key: 'innerRadius',
      label: '内半径 (%)',
      type: 'range',
      group: GROUP.style,
      default: PIE_INNER_RADIUS_DEFAULT,
      min: PIE_RADIUS_MIN,
      max: PIE_RADIUS_MAX,
      step: 1,
      span: 'half',
      help: '占绘图区短边的百分比。⚠ 填得不小于外半径时会被压回去，否则环带宽度为 0、整块空白且不报错。',
      when: RING_ONLY,
    },
    {
      key: 'outerRadius',
      label: '外半径 (%)',
      type: 'range',
      group: GROUP.style,
      default: PIE_OUTER_RADIUS_DEFAULT,
      min: PIE_RADIUS_MIN,
      max: PIE_RADIUS_MAX,
      step: 1,
      span: 'half',
      help: '占绘图区短边的百分比；开了扇区标签要给引线留出四周的地方。',
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
