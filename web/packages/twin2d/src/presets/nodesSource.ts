/**
 * @fileoverview 四个能源源预置节点样式（余热回收 / 蒸汽锅炉 / 空气能 / 太阳能）的字面量
 * 数据：224×124 的盒 + 图标底板 + 标题 + 能量三件套 + 能量悬浮卡，配 hover / selected /
 * alarm 三档变体、四边中点端口，以及参考项目 `SOURCE_FIELDS` 落成的槽位与两条派生兜底链。
 * 这四份数据与用户自建的样式走同一条渲染路径，渲染件里没有一处按样式 id 的分支。
 * 逐值口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.1–§7.3、§7.7、§7.12。
 */
import { TWIN_2D_DEFAULT_PLACEHOLDER } from '../constants'
import { TWIN_2D_STATUSES } from '../kinds'
import { TWIN_2D_LABEL_NATURAL_WHEN, twin2dWithChrome } from './chrome'
import { TWIN_2D_PALETTE, mixTransparent } from './palette'
import type { Twin2dSpriteId } from '../kinds'
import type { Twin2dNodeStyle, Twin2dPort, Twin2dSlot } from '../types'
import type {
  Twin2dBoxPrim,
  Twin2dCondition,
  Twin2dExpr,
  Twin2dFill,
  Twin2dIcoPrim,
  Twin2dPrim,
  Twin2dPrimBase,
  Twin2dShadow,
  Twin2dStrokePass,
  Twin2dTransition,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../typesPrim'

/** 节点根注入的强调色，四个样式的图元一律引它而不引各自的字面色。 */
const ACCENT = 'var(--t2-accent)'

/** 七处 `0.18s ease` 过渡的时长（§7.2 #8）。 */
const TRANSITION_MS = 180

/** 报警呼吸与状态点脉冲的周期（§7.7 #49 / #53）。 */
const ALARM_MS = 1000

/**
 * 盒 / 图标底板 / 能效药丸共用的四属性过渡。
 * ⚠ 少了它 hover 是硬切：所有取值都对，只是手感不一样，没有一处报错（§7.2 #8）。
 */
const SURFACE_TRANSITION: Twin2dTransition = {
  props: ['border-color', 'background', 'box-shadow', 'transform'],
  durationMs: TRANSITION_MS,
  easing: 'ease',
}

/** 悬浮卡只补间这两项（§7.3 #20）。 */
const TIP_TRANSITION: Twin2dTransition = {
  props: ['opacity', 'transform'],
  durationMs: TRANSITION_MS,
  easing: 'ease',
}

/** 悬浮卡的底与箭头填充：§7.3 #20 把参考项目写死的 `rgba(3, 16, 32, .98)` 换成弹层语义 token。 */
const TIP_SURFACE = 'var(--surface-overlay)'

/** 悬浮卡渐变高端，取自参考项目写死的 `rgba(8, 36, 62, .98)`；本仓没有对应的语义 token。 */
const TIP_SHEEN_TOP = 'rgba(8, 36, 62, 0.98)'

/** 悬浮卡中层投影，取自参考项目的 `0 12px 26px rgba(0, 0, 0, .48)`。 */
const TIP_DROP_COLOR = 'rgba(0, 0, 0, 0.48)'

/** hover 时盒的中层投影，取自参考项目的 `0 8px 18px rgba(0, 0, 0, .24)`。 */
const HOVER_DROP_COLOR = 'rgba(0, 0, 0, 0.24)'

/**
 * 图标底板的底色。
 * ⚠ 逐字照抄参考项目的写死值，不改成 `--t2-accent` 派生：它**不跟节点色**，
 * 换成派生只在换主题或换节点色时才看得出不一致（§7.1 #2）。
 */
const ICON_PLATE_FILL = 'rgba(var(--accent-primary-rgb), 0.06)'

/** hover 时描边掺进正文色，参考项目的 `color-mix(accent 86%, text-primary)`。 */
const HOVER_BORDER = `color-mix(in srgb, ${ACCENT} 86%, var(--text-primary))`

/** 报警描边（§7.7 #49）。 */
const ALARM_BORDER = 'var(--state-danger)'

/** 状态点取节点根注入的状态色；`hidden` 档整点不渲染，故这四个样式一律给 `online`。 */
const STATUS_COLOR = 'var(--t2-status)'

/** `--radius-md` 的取值，盒的圆角（§7.1 #1）。 */
const RADIUS_MD = 8

/** `--radius-sm` 的取值，图标底板与悬浮卡的圆角。 */
const RADIUS_SM = 4

/** 掺进透明底的一档取值。 */
function alpha(percent: number): string {
  return mixTransparent(ACCENT, percent)
}

/** 外发光：只有模糊半径与颜色。 */
function glow(id: string, blur: number, color: string): Twin2dShadow {
  return { id, inset: false, x: 0, y: 0, blur, spread: 0, color }
}

/** 内发光，与外发光只差一个前缀。 */
function innerGlow(id: string, blur: number, color: string): Twin2dShadow {
  return { id, inset: true, x: 0, y: 0, blur, spread: 0, color }
}

/** 下坠投影：纵向偏移 + 模糊。 */
function drop(
  id: string,
  y: number,
  blur: number,
  color: string,
): Twin2dShadow {
  return { id, inset: false, x: 0, y, blur, spread: 0, color }
}

/** 一圈实边（选中态那 2px），靠 `spread` 而不是 `blur` 撑出来。 */
function ring(id: string, spread: number, color: string): Twin2dShadow {
  return { id, inset: false, x: 0, y: 0, blur: 0, spread, color }
}

/** 一层纯色填充。 */
function solid(id: string, color: string): Twin2dFill {
  return { kind: 'solid', id, color, opacity: 1 }
}

/** 一层线性渐变，两个色标。 */
function linear(
  id: string,
  angle: number,
  from: string,
  to: string,
): Twin2dFill {
  return {
    kind: 'linear',
    id,
    angle,
    stops: [
      { id: `${id}-a`, color: from, at: 0 },
      { id: `${id}-b`, color: to, at: 1 },
    ],
    opacity: 1,
  }
}

/**
 * 一层径向光斑，从 `(cx, cy)` 起、到 `fade` 处收干。
 * ⚠ 参考项目写的是 `circle`（缺省 farthest-corner），本模型的径向恒是按盒宽高定尺的
 * ellipse，所以同一个百分比落点不同：光斑的衰减范围会略有出入（§7.2 #9、§7.3 #20）。
 */
function halo(
  id: string,
  cx: number,
  percent: number,
  fade: number,
): Twin2dFill {
  return {
    kind: 'radial',
    id,
    cx,
    cy: 0,
    r: 1,
    stops: [
      { id: `${id}-a`, color: alpha(percent), at: 0 },
      { id: `${id}-b`, color: 'transparent', at: fade },
    ],
    opacity: 1,
  }
}

/** 一遍描边；`nonScaling` 恒开，让线宽不随舞台缩放变粗。 */
function stroke(id: string, width: number, color: string): Twin2dStrokePass {
  return {
    id,
    width,
    color,
    dash: [],
    cap: 'butt',
    join: 'miter',
    opacity: 1,
    nonScaling: true,
  }
}

/** 图元基类十五项的缺省：留在父级的流里、自适应尺寸、无条件、无动画。 */
const PRIM_BASE: Omit<Twin2dPrimBase, 'id'> = {
  at: { kind: 'flow' },
  size: { w: 'auto', h: 'auto' },
  minWidth: null,
  maxWidth: null,
  z: 0,
  opacity: 1,
  hidden: false,
  when: null,
  anim: null,
  transition: null,
  rotate: 0,
  scale: 1,
  transformOrigin: '50% 50%',
  pointerEvents: 'auto',
  keepUpright: false,
}

/** box 独有那九项的缺省：横排、不上色、无边框、无圆角、不裁剪。 */
const BOX_REST: Omit<Twin2dBoxPrim, keyof Twin2dPrimBase | 'kind'> = {
  layout: {
    flow: 'row',
    gap: 0,
    align: 'center',
    justify: 'start',
    wrap: false,
    pad: [0, 0, 0, 0],
  },
  fills: [],
  // ⚠ 无边框那一档的颜色写 `currentColor` 而不是空串：空串是归一化的兜底触发值，
  //   落库再读回来会被改成 `currentColor`，于是「存进去的」与「写下的」不是同一份
  border: {
    width: 0,
    style: 'none',
    color: 'currentColor',
    sides: { top: true, right: true, bottom: true, left: true },
  },
  radius: 0,
  shadows: [],
  backdropBlur: 0,
  clip: false,
  cursor: 'default',
  children: [],
}

/** txt 独有那十项的缺省：空字面量、跟随主题的字体与行高、左对齐、不省略。 */
const TXT_REST: Omit<Twin2dTxtPrim, keyof Twin2dPrimBase | 'kind'> = {
  src: { kind: 'lit', text: '' },
  font: {},
  lineHeight: null,
  align: 'start',
  baseline: 'auto',
  nowrap: false,
  ellipsis: false,
  titleAttr: false,
  shadows: [],
  outline: null,
}

/** 四边全开的实边。 */
function edge(width: number, color: string): Twin2dBoxPrim['border'] {
  return {
    width,
    style: 'solid',
    color,
    sides: { top: true, right: true, bottom: true, left: true },
  }
}

/**
 * 状态点的显示条件：样式的 `defaultStatus` 落在 `hidden` 时整枝摘掉（§7.7 #55）。
 * ⚠ 不能只靠 `--t2-status` 不注入：那一档 `var(--t2-status)` 整条声明报废，
 * 点子还在 DOM 里、只是没了颜色，编辑器的图元树里照样能选中一枚看不见的点。
 */
const STATUS_PRESENT: Twin2dCondition = { kind: 'status', in: TWIN_2D_STATUSES }

/** 能量三件套与悬浮卡的显示条件：三个能量槽任一有值（§7.1 #7）。 */
const ENERGY_WHEN: Twin2dPrimBase['when'] = {
  kind: 'has',
  slots: ['input_kwh', 'output_kwh', 'efficiency_pct'],
  mode: 'any',
}

/** 盒的常态底：150° 的两段渐变，两端取节点根注入的 `--t2-fill-*`（§7.1 #1）。 */
const FRAME_FILLS: readonly Twin2dFill[] = [
  linear('frame-base', 150, 'var(--t2-fill-a)', 'var(--t2-fill-b)'),
]

/** 盒的常态阴影：一层内发光 + 一层外发光。 */
const FRAME_SHADOWS: readonly Twin2dShadow[] = [
  innerGlow('frame-inner', 14, alpha(12)),
  glow('frame-outer', 8, alpha(22)),
]

/** 一个 SOURCE_FIELDS 里的实时槽要填的四项。 */
interface LiveSlotSpec {
  key: string
  label: string
  unit: string
  precision: number | null
}

/** 一个实时数值槽：`live` 档、无映射表、占位符走节点侧的 em dash。 */
function liveSlot(spec: LiveSlotSpec): Twin2dSlot {
  return {
    key: spec.key,
    label: spec.label,
    kind: 'live',
    dataType: 'number',
    unit: spec.unit,
    precision: spec.precision,
    format: 'auto',
    enumMap: {},
    placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
    primary: false,
    expr: null,
  }
}

/** 一个派生槽要填的五项。 */
interface DerivedSlotSpec {
  key: string
  label: string
  unit: string
  precision: number | null
  expr: Twin2dExpr
}

/** 一个派生槽：`derived` 档不成绑定行，值由算式得出。 */
function derivedSlot(spec: DerivedSlotSpec): Twin2dSlot {
  return {
    key: spec.key,
    label: spec.label,
    kind: 'derived',
    dataType: 'number',
    unit: spec.unit,
    precision: spec.precision,
    format: 'auto',
    enumMap: {},
    placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
    primary: false,
    expr: spec.expr,
  }
}

/**
 * 输出能量的兜底链。
 * ⚠ 只有两级而不是参考项目那三级：参考项目的中间一级是 `outputKwh`（`output_kwh` 的
 * 驼峰别名），而它自己的字段选择器只从 `SOURCE_FIELDS` 取键，那一级永远绑不上；
 * 照抄它就是多一个谁也填不了的槽外加一条 `dangling-slot` 诊断（§7.12 #99）。
 */
const OUTPUT_EXPR: Twin2dExpr = {
  kind: 'first',
  of: [
    { kind: 'slot', slot: 'output_kwh' },
    { kind: 'slot', slot: 'today_kwh' },
  ],
}

/**
 * 能效的三级兜底链：显式能效 → COP×100 → 输出 ÷ 投入 ×100。
 * ⚠ 第三级的分子只能是 `output_kwh` 而不是上面那条链的结果：算式递归上限是 3 层，
 * `first` 套在 `ratio.num` 里时它的子项落在第 3 层、整枝求值恒为 null（§9.5）。
 */
const EFFICIENCY_EXPR: Twin2dExpr = {
  kind: 'first',
  of: [
    { kind: 'slot', slot: 'efficiency_pct' },
    { kind: 'scale', of: { kind: 'slot', slot: 'cop' }, by: 100 },
    {
      kind: 'ratio',
      num: { kind: 'slot', slot: 'output_kwh' },
      den: { kind: 'slot', slot: 'input_kwh' },
      scale: 100,
    },
  ],
}

/**
 * 四个源类共用的槽位表：参考项目 `SOURCE_FIELDS` 的八个字段逐字照抄，加一个 `cop`
 * 撑起能效链的第二级，再加三个派生槽。
 * ⚠ 输出能量落成两个派生槽：同一个数在大字上不带单位、在悬浮卡里带 `kWh`，
 * 而单位与精度是**槽位**上的口径，一个槽出不了两种写法（§7.12 #91）。
 */
const SOURCE_SLOTS: readonly Twin2dSlot[] = [
  // ⚠ 悬浮卡那一行要千分位：`grouped` 档走 fmtNumber，与主读数的压缩档并存（§7.12 #94）
  {
    ...liveSlot({
      key: 'input_kwh',
      label: '输入能量',
      unit: 'kWh',
      precision: 0,
    }),
    format: 'grouped',
  },
  {
    ...liveSlot({
      key: 'output_kwh',
      label: '输出能量',
      unit: 'kWh',
      precision: null,
    }),
    primary: true,
  },
  liveSlot({
    key: 'efficiency_pct',
    label: '能效',
    unit: '%',
    precision: null,
  }),
  liveSlot({
    key: 'today_kwh',
    label: '今日产能',
    unit: 'kWh',
    precision: null,
  }),
  liveSlot({ key: 'power_kw', label: '当前功率', unit: 'kW', precision: null }),
  liveSlot({ key: 'temperature_c', label: '温度', unit: '℃', precision: null }),
  liveSlot({ key: 'flow_m3h', label: '流量', unit: 'm³/h', precision: null }),
  {
    key: 'status',
    label: '状态',
    kind: 'live',
    dataType: 'enum',
    unit: '',
    precision: null,
    format: 'auto',
    // ⚠ 键是字符串：JSON 的键永远是字符串，标成数字时拿数值读数去索引会静默查不到
    enumMap: { '0': '离线', '1': '运行', '2': '待机', '3': '报警' },
    placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
    primary: false,
    expr: null,
  },
  liveSlot({ key: 'cop', label: '性能系数', unit: '', precision: null }),
  // ⚠ 主读数走压缩档且**不给 precision**：这一档的缺省位数随值分两支（千位留一位、
  //   万位不留），与参考项目的 `toFixed(abs >= 10_000 ? 0 : 1)` 同源。写死一个位数
  //   只对得上其中一支——写 0 会把 3300 显成「3k」（§7.12 #93）
  {
    ...derivedSlot({
      key: 'output',
      label: '输出（读数行）',
      unit: '',
      precision: null,
      expr: OUTPUT_EXPR,
    }),
    format: 'kwhShort',
  },
  {
    ...derivedSlot({
      key: 'output_total',
      label: '输出（悬浮卡）',
      unit: 'kWh',
      precision: 0,
      expr: OUTPUT_EXPR,
    }),
    format: 'grouped',
  },
  // ⚠ 能效两位小数且去尾随零：参考项目这一处不是 `toFixed(1)`，抄错不报错、只差一位（§7.12 #95）
  {
    ...derivedSlot({
      key: 'efficiency',
      label: '能效（合成）',
      unit: '%',
      precision: null,
      expr: EFFICIENCY_EXPR,
    }),
    format: 'trim2',
  },
]

/** 一个端口要填的三项。 */
interface PortSpec {
  id: string
  side: Twin2dPort['side']
  t: number
}

/**
 * 一个四边中点端口。
 * ⚠ `side` 一律给定死的四档而不是 `'auto'`：`auto` 必须在进路由之前解析掉，
 * 流进正交路由会让这一条线从节点中心横穿出去、其余线全对（§4.4）。
 */
function midPort(spec: PortSpec): Twin2dPort {
  return {
    id: spec.id,
    name: spec.id.toUpperCase(),
    at: { kind: 'perim', t: spec.t },
    dir: 'both',
    side: spec.side,
    showName: false,
    marker: null,
  }
}

/**
 * 四边中点：周长参数顺时针绕一圈、原点在左上角，故上 .125 / 右 .375 / 下 .625 / 左 .875。
 * 文档序与参考项目的 `ANCHORS_LRTB` 一致。
 */
const SOURCE_PORTS: readonly Twin2dPort[] = [
  midPort({ id: 'l', side: 'left', t: 0.875 }),
  midPort({ id: 'r', side: 'right', t: 0.375 }),
  midPort({ id: 't', side: 'top', t: 0.125 }),
  midPort({ id: 'b', side: 'bottom', t: 0.625 }),
]

/** 「输出」与「kWh」两个字面量的排版（§7.3 #18）。 */
const CAPTION_FONT = {
  size: 12,
  letterSpacing: 0,
  color: 'var(--text-secondary)',
}

/** 悬浮卡里三行左侧的说明字。 */
const TIP_LABEL_FONT = { size: 12, color: 'var(--text-secondary)' }

/** 一个字面量说明字。 */
function caption(
  id: string,
  text: string,
  font: Twin2dTxtPrim['font'],
  lineHeight: number | null = null,
): Twin2dTxtPrim {
  return {
    ...PRIM_BASE,
    ...TXT_REST,
    kind: 'txt',
    id,
    src: { kind: 'lit', text },
    font,
    lineHeight,
  }
}

/**
 * 悬浮卡一行的行高：参考项目 `.tnv-energy-tip__row` 的 1.55。
 * ⚠ 行距由行高撑而不是 `gap`：`tip-rows` 的 gap 是 0，改用 gap 会让三行之间等距、
 * 而每一行自己的上下留白消失，整张卡看着挤在一起（§7.3）。
 */
const TIP_ROW_LINE_HEIGHT = 1.55

/** 悬浮卡里一行右侧的读数：digit 字体 15px，带一层字发光。 */
function tipValue(id: string, slot: string): Twin2dTxtPrim {
  return {
    ...PRIM_BASE,
    ...TXT_REST,
    kind: 'txt',
    id,
    src: { kind: 'slot', slot },
    font: {
      family: 'var(--font-digit)',
      size: 15,
      weight: 400,
      color: ACCENT,
    },
    lineHeight: TIP_ROW_LINE_HEIGHT,
    nowrap: true,
    shadows: [glow(`${id}-glow`, 6, alpha(38))],
  }
}

/** 悬浮卡里的一行：说明字靠左、读数靠右，基线对齐、间距 14。 */
function tipRow(id: string, label: string, slot: string): Twin2dBoxPrim {
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: `tip-row-${id}`,
    layout: {
      flow: 'row',
      gap: 14,
      align: 'baseline',
      justify: 'between',
      wrap: false,
      pad: [0, 0, 0, 0],
    },
    children: [
      caption(`tip-${id}-label`, label, TIP_LABEL_FONT, TIP_ROW_LINE_HEIGHT),
      tipValue(`tip-${id}-value`, slot),
    ],
  }
}

/**
 * 悬浮卡下沿的小箭头：参考项目那个 8×8、转 45°、只有右下两条边有描边的方块。
 * ⚠ 走开口折线（`closed: false`）而不是闭合三角：闭合会把斜边也描出来，而那条边
 * 在参考项目里正是**没有** border 的那两条之一。
 * ⚠ `stretch` 配 `coord: 'unit'`：vec 的 viewBox 取的是**父级盒**的尺寸，而悬浮卡是
 * 内容撑开的（`size` 为 `auto` 时回落父级盒），不拉伸这枚 8×8 会被按 224×124 的比例压扁。
 */
function tipArrow(): Twin2dVecPrim {
  return {
    ...PRIM_BASE,
    kind: 'vec',
    id: 'tip-arrow',
    at: {
      kind: 'abs',
      left: '50%',
      right: null,
      top: null,
      bottom: -5,
      tx: '-50%',
      ty: '0',
    },
    size: { w: 8, h: 8 },
    // 转的是 `<svg>` 这个 CSS 盒，不是盒里的坐标，故三角尖朝下而内容不被 viewBox 裁掉
    rotate: 45,
    pointerEvents: 'none',
    coord: 'unit',
    // 右边与下边两条：起点右上、拐点右下、终点左下
    shape: {
      kind: 'poly',
      points: [
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      closed: false,
    },
    fill: { kind: 'color', color: TIP_SURFACE },
    strokes: [stroke('tip-arrow-edge', 1, alpha(48))],
    gradients: [],
    stretch: true,
  }
}

/** 卡体的三层底，文档序从下往上：写死的底 → 顶上那圈光斑 → 近乎不透明的两段渐变。 */
const TIP_FILLS: readonly Twin2dFill[] = [
  solid('tip-base', TIP_SURFACE),
  halo('tip-halo', 0.5, 22, 0.58),
  linear('tip-sheen', 180, TIP_SHEEN_TOP, TIP_SURFACE),
]

/** 卡体的三重阴影：内发光 + 下坠投影 + 外发光。 */
const TIP_SHADOWS: readonly Twin2dShadow[] = [
  innerGlow('tip-inner', 18, alpha(14)),
  drop('tip-drop', 12, 26, TIP_DROP_COLOR),
  glow('tip-glow', 18, alpha(30)),
]

/** 卡片抬头：显示名，220 宽上限之外省略号。 */
function tipTitle(): Twin2dTxtPrim {
  return {
    ...PRIM_BASE,
    ...TXT_REST,
    kind: 'txt',
    id: 'tip-title',
    maxWidth: 220,
    src: { kind: 'label' },
    font: { size: 12, weight: 600, color: 'var(--text-title)' },
    nowrap: true,
    ellipsis: true,
    // ⚠ 不挂 title：整张卡是 `pointerEvents: 'none'`，原生提示永远弹不出来
    titleAttr: false,
  }
}

/** 卡片正文：投入 / 产出 / 能效三行一列，行距由各行自己的行高撑。 */
function tipRows(): Twin2dBoxPrim {
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'tip-rows',
    layout: {
      flow: 'col',
      gap: 0,
      align: 'stretch',
      justify: 'start',
      wrap: false,
      pad: [0, 0, 0, 0],
    },
    children: [
      tipRow('input', '输入能量', 'input_kwh'),
      tipRow('output', '输出能量', 'output_total'),
      tipRow('efficiency', '能效', 'efficiency'),
    ],
  }
}

/**
 * 能量悬浮卡。
 * ⚠ `pointerEvents: 'none'` 不能省：卡片弹出来盖住指针 → 节点失去 hover → 卡片收起 →
 * 指针回到节点 → 再弹出，**每秒抖十几次**，而每一帧的样式都是「对」的（§9.3）。
 * ⚠ `transformOrigin` 是下沿：从上沿放大的话卡片会朝节点里长，看着像「弹反了」。
 */
function energyTip(): Twin2dBoxPrim {
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'energy-tip',
    at: {
      kind: 'abs',
      left: '50%',
      right: null,
      top: -10,
      bottom: null,
      tx: '-50%',
      ty: 'calc(-100% - 4px)',
    },
    minWidth: 188,
    z: 10,
    opacity: 0,
    scale: 0.96,
    transformOrigin: '50% 100%',
    pointerEvents: 'none',
    when: ENERGY_WHEN,
    transition: TIP_TRANSITION,
    layout: {
      flow: 'col',
      gap: 6,
      align: 'stretch',
      justify: 'start',
      wrap: false,
      pad: [8, 10, 8, 10],
    },
    fills: TIP_FILLS,
    border: edge(1, alpha(62)),
    radius: RADIUS_SM,
    shadows: TIP_SHADOWS,
    backdropBlur: 8,
    children: [tipArrow(), tipTitle(), tipRows()],
  }
}

/** 能效药丸：`pill` 圆角 + 半透明底 + 一圈描边 + 一层外发光（§7.3 #19）。 */
function efficiencyPill(): Twin2dBoxPrim {
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'energy-pct',
    layout: {
      flow: 'row',
      gap: 0,
      align: 'center',
      justify: 'center',
      wrap: false,
      pad: [1, 6, 1, 6],
    },
    fills: [solid('pct-bg', alpha(14))],
    border: edge(1, alpha(52)),
    radius: 'pill',
    shadows: [glow('pct-glow', 8, alpha(26))],
    transition: SURFACE_TRANSITION,
    children: [
      {
        ...PRIM_BASE,
        ...TXT_REST,
        kind: 'txt',
        id: 'efficiency-value',
        src: { kind: 'slot', slot: 'efficiency' },
        font: {
          family: 'var(--font-digit)',
          size: 20,
          letterSpacing: 0.4,
          color: ACCENT,
        },
        // ⚠ 参考项目 `.tnv-energy-pct` 的 1.1：缺省行高会把这枚药丸撑高一截，
        //   于是它压不住同一行里 28px 的大字（§7.3 #19）
        lineHeight: 1.1,
      },
    ],
  }
}

/**
 * 「输出 <大字> kWh」这一组：字面量说明字与大字基线对齐、间距 4。
 * ⚠ 大字 28px 而不是通用读数那档 32px：参考项目给能量档单降了一级，
 * 抄错了不会报错，只是同一行里药丸压不住它。
 */
function energyMain(): Twin2dBoxPrim {
  const value: Twin2dTxtPrim = {
    ...PRIM_BASE,
    ...TXT_REST,
    kind: 'txt',
    id: 'output-value',
    src: { kind: 'slot', slot: 'output' },
    font: {
      family: 'var(--font-digit)',
      size: 28,
      letterSpacing: 0.5,
      color: ACCENT,
    },
    shadows: [glow('output-glow', 3, alpha(70))],
  }
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'energy-main',
    layout: {
      flow: 'row',
      gap: 4,
      align: 'baseline',
      justify: 'start',
      wrap: false,
      pad: [0, 0, 0, 0],
    },
    children: [
      caption('energy-label', '输出', CAPTION_FONT),
      value,
      caption('energy-unit', 'kWh', CAPTION_FONT),
    ],
  }
}

/** 读数行：「输出 <大字> kWh」靠左、能效药丸靠右，基线对齐、两端分布（§7.1 #7）。 */
function readingsRow(): Twin2dBoxPrim {
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'readings',
    when: ENERGY_WHEN,
    layout: {
      flow: 'row',
      gap: 10,
      align: 'baseline',
      justify: 'between',
      wrap: false,
      pad: [0, 0, 0, 0],
    },
    children: [energyMain(), efficiencyPill()],
  }
}

/** 标题与读数行两行一列；`stretch` 让读数行铺满，两端分布才有得可分。 */
function bodyColumn(): Twin2dBoxPrim {
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'body',
    // ⚠ 宽度给 100% 而不是 auto：本模型出不了 `flex: 1 1 auto`，靠「想要满宽 + 恒定
    //   的 min-width: 0 + 缺省可收缩」挤成剩余宽度，auto 会让读数行缩到内容宽
    size: { w: '100%', h: 'auto' },
    layout: {
      flow: 'col',
      gap: 2,
      align: 'stretch',
      justify: 'start',
      wrap: false,
      pad: [0, 0, 0, 0],
    },
    children: [
      {
        ...PRIM_BASE,
        ...TXT_REST,
        kind: 'txt',
        id: 'label-natural',
        when: TWIN_2D_LABEL_NATURAL_WHEN,
        src: { kind: 'label' },
        font: { size: 18, weight: 600, color: 'var(--text-primary)' },
        nowrap: true,
        ellipsis: true,
        titleAttr: true,
      },
      readingsRow(),
    ],
  }
}

/**
 * 图标底板：34×34 居中摆一枚 26×26 的 sprite。
 * ⚠ 那枚 sprite 的 id 是 `glyph`，与末端 / 方块两族**逐字同名**：图元 id 是节点级
 * patch 与变体补丁的寻址键，一族自己另起一个名字，用户把一条变体补丁从末端抄到这里
 * 就寻不到址——表现是「变体命中了、外观纹丝不动」，零报错。
 */
function iconPlate(sprite: Twin2dSpriteId): Twin2dBoxPrim {
  const glyph: Twin2dIcoPrim = {
    ...PRIM_BASE,
    kind: 'ico',
    id: 'glyph',
    size: { w: 26, h: 26 },
    src: { kind: 'sprite', id: sprite },
    // ⚠ 这四枚 sprite 的颜色是插画的一部分、写死在 symbol 里，`color` 对它们无效；
    //   照写参考项目那一处 `color: var(--accent)` 只为口径一致（§5）
    color: ACCENT,
  }
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'icon',
    size: { w: 34, h: 34 },
    layout: {
      flow: 'none',
      gap: 0,
      align: 'center',
      justify: 'center',
      wrap: false,
      pad: [0, 0, 0, 0],
    },
    fills: [solid('icon-plate', ICON_PLATE_FILL)],
    border: edge(1, alpha(40)),
    radius: RADIUS_SM,
    transition: SURFACE_TRANSITION,
    children: [glyph],
  }
}

/**
 * 节点的外框。
 * ⚠ `cursor: 'help'` 落在这一层：参考项目挂在根上，而本模型的节点根不吃图元字段，
 * 悬浮卡自己是 `pointerEvents: 'none'`，所以能吃指针的只有这块可见面（§7.3 #24）。
 */
function frameBox(sprite: Twin2dSpriteId): Twin2dBoxPrim {
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'frame',
    at: { kind: 'fill', inset: [0, 0, 0, 0] },
    layout: {
      flow: 'row',
      gap: 8,
      align: 'center',
      justify: 'start',
      wrap: false,
      pad: [6, 10, 6, 10],
    },
    fills: FRAME_FILLS,
    border: edge(1.5, ACCENT),
    radius: RADIUS_MD,
    shadows: FRAME_SHADOWS,
    cursor: 'help',
    transition: SURFACE_TRANSITION,
    children: [iconPlate(sprite), bodyColumn()],
  }
}

/** 右下角的状态点：7×7 的圆，取节点根注入的状态色（§7.7 #53）。id 同上，四族共用 `status-dot`。 */
function statusDot(): Twin2dBoxPrim {
  return {
    ...PRIM_BASE,
    ...BOX_REST,
    kind: 'box',
    id: 'status-dot',
    at: {
      kind: 'abs',
      left: null,
      right: 5,
      top: null,
      bottom: 5,
      tx: '0',
      ty: '0',
    },
    size: { w: 7, h: 7 },
    z: 5,
    when: STATUS_PRESENT,
    fills: [solid('dot-bg', STATUS_COLOR)],
    radius: 'pill',
    shadows: [glow('dot-glow', 6, STATUS_COLOR)],
  }
}

/** 一个源类样式的全部图元：外框（含图标、标题、读数行）+ 能量悬浮卡 + 状态点。 */
function sourcePrims(sprite: Twin2dSpriteId): readonly Twin2dPrim[] {
  return [frameBox(sprite), energyTip(), statusDot()]
}

/**
 * hover 一档。
 * ⚠ `lift` 与 `scale` 是同一条根 transform 上的两段，两样都要给：只给 `lift` 就是
 * 「抬起来了但没变大」（§7.2 #9）。
 * ⚠ `z` 必须一起抬：不抬的话能量悬浮卡被右邻节点整块盖住，而它只在两个节点靠得近时
 * 才看得出来（§7.2 #14）。
 */
const HOVER_VARIANT: Twin2dNodeStyle['variants'][number] = {
  id: 'hover',
  when: { kind: 'state', state: 'hover' },
  rootPatch: { lift: 3, scale: 1.025, z: 30 },
  patch: {
    frame: {
      border: edge(1.5, HOVER_BORDER),
      // 常态那层渐变照旧，顶上**追加**一层左上角的光斑
      fills: [...FRAME_FILLS, halo('frame-halo', 0.25, 18, 0.54)],
      shadows: [
        innerGlow('frame-inner', 18, alpha(18)),
        drop('frame-drop', 8, 18, HOVER_DROP_COLOR),
        glow('frame-outer', 18, alpha(42)),
      ],
    },
    icon: {
      scale: 1.08,
      border: edge(1, alpha(62)),
      fills: [solid('icon-plate', alpha(16))],
      shadows: [glow('icon-glow', 12, alpha(34))],
    },
    'energy-tip': {
      opacity: 1,
      scale: 1,
      at: {
        kind: 'abs',
        left: '50%',
        right: null,
        top: -10,
        bottom: null,
        tx: '-50%',
        ty: 'calc(-100% - 8px)',
      },
    },
  },
}

/**
 * 选中一档。
 * ⚠ 补丁落在 `frame` 而不是 `rootPatch.shadows`：节点根没有圆角，那 2px 的实边会画成
 * 直角框套在圆角盒外面（§7.7 #48）。
 * ⚠ 整组替换而不是追加：参考项目那条 `box-shadow` 是一个属性，选中时它把常态的
 * 内外发光整条顶掉。
 */
const SELECTED_VARIANT: Twin2dNodeStyle['variants'][number] = {
  id: 'selected',
  when: { kind: 'state', state: 'selected' },
  rootPatch: {},
  patch: {
    frame: {
      shadows: [ring('sel-ring', 2, ACCENT), glow('sel-glow', 16, alpha(45))],
    },
  },
}

/**
 * 报警一档：描边转危险色，盒呼吸、状态点脉冲。
 * ⚠ 新模型里没有 `!important`——变体补丁本来就是最后一层（§7.7 #49）。
 * ⚠ 命中的是**状态**不是交互态：参考项目的 `is-alarm` 由 `node.status` 推出来，
 * 而交互态那一档只从外部 props 进（舞台一个都不传），写成 `state` 是一条永不命中的
 * 变体——报警节点照常画成常态，且没有任何一处报错（§10.1）。
 */
const ALARM_VARIANT: Twin2dNodeStyle['variants'][number] = {
  id: 'alarm',
  when: { kind: 'status', in: ['alarm'] },
  rootPatch: {},
  patch: {
    frame: {
      border: edge(1.5, ALARM_BORDER),
      anim: { kind: 'breathe', durationMs: ALARM_MS },
    },
    'status-dot': { anim: { kind: 'pulse', durationMs: ALARM_MS } },
  },
}

/** 三档变体的文档序即覆盖序：后者盖前者（§4.5）。 */
const SOURCE_VARIANTS: Twin2dNodeStyle['variants'] = [
  HOVER_VARIANT,
  SELECTED_VARIANT,
  ALARM_VARIANT,
]

/** 一个源类样式的身份四项。 */
interface SourceStyleSpec {
  id: string
  name: string
  accent: string
  sprite: Twin2dSpriteId
}

/**
 * 一个源类预置样式。
 * ⚠ `category` 只用于调色板分栏，一处渲染判断都不参与：参考项目按
 * `category === 'source'` 决定能量三件套画不画，本模型把那件事交给了图元的 `when`（§7 #55）。
 */
function sourceStyle(spec: SourceStyleSpec): Twin2dNodeStyle {
  return twin2dWithChrome({
    id: spec.id,
    name: spec.name,
    category: 'source',
    accent: spec.accent,
    defaultStatus: 'online',
    size: { w: 224, h: 124 },
    prims: sourcePrims(spec.sprite),
    ports: SOURCE_PORTS,
    slots: SOURCE_SLOTS,
    variants: SOURCE_VARIANTS,
  })
}

/** 四个能源源样式的 id，与参考项目的节点类型 id 逐字相同。 */
export const TWIN_2D_SOURCE_STYLE_IDS = [
  'waste-heat-source',
  'steam-source',
  'air-source',
  'solar-source',
] as const

/** 四个能源源预置样式，文档序与参考项目的内置库一致。 */
export const TWIN_2D_SOURCE_STYLES: readonly Twin2dNodeStyle[] = [
  sourceStyle({
    id: 'waste-heat-source',
    name: '余热回收',
    accent: TWIN_2D_PALETTE.wasteHeat,
    sprite: 'ico-src-waste-heat',
  }),
  sourceStyle({
    id: 'steam-source',
    name: '蒸汽锅炉',
    accent: TWIN_2D_PALETTE.steam,
    sprite: 'ico-src-steam',
  }),
  sourceStyle({
    id: 'air-source',
    name: '空气能',
    accent: TWIN_2D_PALETTE.airEnergy,
    sprite: 'ico-src-air-source',
  }),
  sourceStyle({
    id: 'solar-source',
    name: '太阳能',
    accent: TWIN_2D_PALETTE.solar,
    sprite: 'ico-src-solar',
  }),
]
