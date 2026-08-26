/**
 * @fileoverview 两个储能容器预置节点样式：水箱（`tank`——横向胶囊 + 左图标 + 居中的
 * 标题与读数 + 底沿管接头）与分集水器（`manifold`，`cylinder`——矩形体身 + 两枚椭圆
 * 端盖 + 暖冷双集管线，本体全走 SVG）。取值出自参考项目 topology-view 的 `.tnv-tank`
 * 与 `.tnv-cyl__*` 两段样式块、`TopologyNodeView.vue` 的 `cyl` computed，以及
 * `builtinLibrary` 的 `VESSEL_FIELDS`；口径见
 * docs/MODULE_TWIN_2D_DESIGN.md §7.4、§7.5、§7.7。
 */
import { TWIN_2D_DEFAULT_PLACEHOLDER } from '../constants'
import { TWIN_2D_PALETTE_RGB, mixTransparent } from './palette'
import {
  ACCENT,
  ALARM_MS,
  AUTO_SIZE,
  FILL_A,
  FILL_B,
  FILL_PARENT,
  FLOW_NONE,
  HOVER_BORDER,
  IN_FLOW,
  NAME_SIZE,
  TRANSITION_MS,
  accentShadow,
  borderOf,
  boxOf,
  layoutOf,
  primBase,
  spriteOf,
  statusDot,
  txtOf,
} from './primKit'
import type {
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dSlot,
  Twin2dVariant,
} from '../types'
import type {
  Twin2dBoxPrim,
  Twin2dExpr,
  Twin2dFill,
  Twin2dIcoPrim,
  Twin2dPaint,
  Twin2dPlacement,
  Twin2dShadow,
  Twin2dShape,
  Twin2dStrokePass,
  Twin2dTransition,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../typesPrim'

/** 两形读数同为 30px */
const VALUE_SIZE = 30
/** 危险色，报警档两形都用它 */
const DANGER = 'var(--state-danger)'

/**
 * 罐形 hover 那一层落影的底色。
 * ⚠ 这一档是 `.22`（与方块同值），`box` 一形是 `.24`——参考项目逐值不同，不许统一。
 */
const HOVER_SCRIM = 'rgba(0, 0, 0, 0.22)'

/** 一条不掺色的实心发光；选中与报警那两圈用它。 */
function glowShadow(id: string, blur: number, color: string): Twin2dShadow {
  return { id, inset: false, x: 0, y: 0, blur, spread: 0, color }
}

/** 一个实时数值槽：`live` 档、无映射表、占位符走节点侧的 em dash。 */
function liveSlot(spec: {
  key: string
  label: string
  unit: string
  primary: boolean
}): Twin2dSlot {
  return {
    key: spec.key,
    label: spec.label,
    kind: 'live',
    dataType: 'number',
    unit: spec.unit,
    precision: null,
    enumMap: {},
    placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
    primary: spec.primary,
    expr: null,
  }
}

/**
 * 读数行的算式：温度与液位拼成一串（§7.4 #29、§7.12 #98）。
 * ⚠ 参考项目那一版逐段带单位与定点（`toFixed(1)℃` / `Math.round()%`），而 `join`
 * 是把每一项 `String()` 之后拼串、逐项不过槽位口径，故拼出来的是两个裸数。
 * 单位与精度是**槽位**上的口径，要带单位就得让每一段各是一个槽——那是另一件事。
 */
const READING_EXPR: Twin2dExpr = {
  kind: 'join',
  of: [
    { kind: 'slot', slot: 'temperature_c' },
    { kind: 'slot', slot: 'level_pct' },
  ],
  sep: ' · ',
}

/**
 * 两形共用的槽位表：参考项目 `VESSEL_FIELDS` 的五个字段逐字照抄，再加一个派生读数槽。
 * ⚠ `status` 一档**不给 `enumMap`**：状态归一走 `toDeviceStatus`，在这里再写一张
 * 数值→文案的表就是给同一件事开第二份真源（§10.2）。
 */
function vesselSlots(): readonly Twin2dSlot[] {
  return [
    liveSlot({
      key: 'temperature_c',
      label: '当前温度',
      unit: '℃',
      primary: true,
    }),
    liveSlot({ key: 'target_c', label: '目标温度', unit: '℃', primary: false }),
    liveSlot({ key: 'level_pct', label: '液位', unit: '%', primary: false }),
    liveSlot({ key: 'stored_kwh', label: '储能', unit: 'kWh', primary: false }),
    {
      key: 'status',
      label: '状态',
      kind: 'live',
      dataType: 'enum',
      unit: '',
      precision: null,
      enumMap: {},
      placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
      primary: false,
      expr: null,
    },
    {
      key: 'reading',
      label: '读数行（温度 · 液位）',
      kind: 'derived',
      dataType: 'string',
      unit: '',
      precision: null,
      enumMap: {},
      placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
      primary: false,
      expr: READING_EXPR,
    },
  ]
}

/**
 * 一个四边中点端口。
 * ⚠ `side` 一律给定死的四档而不是 `'auto'`：`auto` 必须在进路由之前解析掉，
 * 流进正交路由会让这一条线从节点中心横穿出去、其余线全对（§4.4）。
 */
function midPort(spec: {
  id: string
  side: Twin2dPort['side']
  t: number
}): Twin2dPort {
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
const VESSEL_PORTS: readonly Twin2dPort[] = [
  midPort({ id: 'l', side: 'left', t: 0.875 }),
  midPort({ id: 'r', side: 'right', t: 0.375 }),
  midPort({ id: 't', side: 'top', t: 0.125 }),
  midPort({ id: 'b', side: 'bottom', t: 0.625 }),
]

/** 读数那一段字：数字字体、30px、强调色加一层 3px 发光。 */
function readingText(letterSpacing: number | null): Twin2dTxtPrim {
  return {
    ...txtOf(primBase('reading', IN_FLOW, AUTO_SIZE), {
      kind: 'slot',
      slot: 'reading',
    }),
    font: {
      family: 'var(--font-digit)',
      size: VALUE_SIZE,
      ...(letterSpacing === null ? {} : { letterSpacing }),
      color: ACCENT,
    },
    align: 'center',
    shadows: [
      accentShadow({ id: 'reading-glow', inset: false, blur: 3, percent: 70 }),
    ],
  }
}

/** 标题那一段字：18/600、单行省略、完整文本挂 `title`。 */
function titleText(shadows: readonly Twin2dShadow[]): Twin2dTxtPrim {
  return {
    ...txtOf(primBase('label-natural', IN_FLOW, AUTO_SIZE), { kind: 'label' }),
    maxWidth: '100%',
    font: { size: NAME_SIZE, weight: 600, color: 'var(--text-primary)' },
    align: 'center',
    nowrap: true,
    ellipsis: true,
    titleAttr: true,
    shadows,
  }
}

// 水箱（tank）

/** 参考项目 `.tnv-tank` 那三属性的过渡——**没有** `background`，与 `box` 一形不同。 */
const TANK_TRANSITION: Twin2dTransition = {
  props: ['border-color', 'box-shadow', 'transform'],
  durationMs: TRANSITION_MS,
  easing: 'ease',
}

/** 图标边长；`.tnv-tank__icon` 是 30×30，比 `box` 一形的 26 大 */
const TANK_ICON_SIZE = 30

/**
 * 胶囊底的线性渐变。
 * ⚠ 角度是 **180°**，`box` 与方块两形是 150°——参考项目逐值不同，抄串了整块底色会斜。
 */
function tankGradient(): Twin2dFill {
  return {
    kind: 'linear',
    id: 'fill-base',
    angle: 180,
    stops: [
      { id: 'stop-a', color: FILL_A, at: 0 },
      { id: 'stop-b', color: FILL_B, at: 1 },
    ],
    opacity: 1,
  }
}

/**
 * 底沿那排管接头（§7.4 #30）。
 * ⚠ 透明度落在图元上而不是填充层上：参考项目那条 `opacity: .45` 也在元素上，
 * 挪进填充层会让「整枝变淡」变成「只有色带变淡」。
 */
function tankStubs(): Twin2dBoxPrim {
  const at: Twin2dPlacement = {
    kind: 'abs',
    left: '24%',
    right: '24%',
    top: null,
    bottom: -5,
    tx: '0',
    ty: '0',
  }
  return {
    ...boxOf(
      primBase('stubs', at, { w: 'auto', h: 5 }),
      layoutOf(FLOW_NONE),
      [],
    ),
    opacity: 0.45,
    pointerEvents: 'none',
    fills: [
      {
        kind: 'repeat',
        id: 'stubs',
        angle: 90,
        color: ACCENT,
        width: 2,
        gap: 18,
        opacity: 1,
      },
    ],
  }
}

/**
 * 标题 + 读数那一列（§7.4 #27、#28、#29）。
 * ⚠ 宽度给 `'100%'` 是参考项目 `flex: 1 1 auto` 的表达：不给的话这一列缩到内容宽、
 * 贴着图标站，而它的两行都是**居中**排的——差别只在「居中于谁」，一处都不报错。
 */
function tankBody(): Twin2dBoxPrim {
  return boxOf(
    primBase('body', IN_FLOW, { w: '100%', h: 'auto' }),
    layoutOf({
      flow: 'col',
      gap: 2,
      align: 'center',
      justify: 'center',
      pad: [0, 0, 0, 0],
    }),
    [titleText([]), readingText(0.5)],
  )
}

/**
 * 罐形图标。
 * ⚠ `minWidth` 与边长同值，是参考项目 `flex: 0 0 auto` 的表达：flex 子项缺省会收缩，
 * 少了它长标题会把图标挤扁，而图标本身的 `size` 看着仍然是 30。
 */
function tankIcon(): Twin2dIcoPrim {
  const size = { w: TANK_ICON_SIZE, h: TANK_ICON_SIZE }
  return {
    ...spriteOf(primBase('icon', IN_FLOW, size), 'ico-vsl-tank'),
    minWidth: TANK_ICON_SIZE,
  }
}

/** 胶囊外壳：1.5px 强调色描边、药丸圆角、180° 渐变底、内发光加外发光（§7.4 #25）。 */
function tankFrame(): Twin2dBoxPrim {
  return {
    ...boxOf(
      primBase('frame', FILL_PARENT, AUTO_SIZE),
      layoutOf({
        flow: 'row',
        gap: 8,
        align: 'center',
        justify: 'start',
        pad: [4, 14, 4, 14],
      }),
      [tankIcon(), tankBody()],
    ),
    transition: TANK_TRANSITION,
    fills: [tankGradient()],
    border: borderOf(1.5, ACCENT),
    radius: 'pill',
    shadows: [
      accentShadow({ id: 'inner', inset: true, blur: 16, percent: 12 }),
      accentShadow({ id: 'glow', inset: false, blur: 9, percent: 26 }),
    ],
  }
}

/**
 * 罐形 hover：根上抬 3px 并放大到 **1.02**（`box` 一形是 1.025、方块是 1.04），
 * 外壳换描边色与三重阴影（§7.4 #25）。
 * ⚠ 参考项目的罐形 hover **不换底色**：`box` 那一档会追加一层径向高光，这里没有。
 */
function tankHoverVariant(): Twin2dVariant {
  return {
    id: 'hover',
    when: { kind: 'state', state: 'hover' },
    patch: {
      frame: {
        border: borderOf(1.5, HOVER_BORDER),
        shadows: [
          accentShadow({ id: 'inner', inset: true, blur: 20, percent: 18 }),
          {
            id: 'scrim',
            inset: false,
            x: 0,
            y: 8,
            blur: 18,
            spread: 0,
            color: HOVER_SCRIM,
          },
          accentShadow({ id: 'glow', inset: false, blur: 18, percent: 40 }),
        ],
      },
    },
    rootPatch: { lift: 3, scale: 1.02, z: 30 },
  }
}

/** 罐形选中：一圈 2px 实色 + 一层外发光（§7.7 #48）。 */
function tankSelectedVariant(): Twin2dVariant {
  return {
    id: 'selected',
    when: { kind: 'state', state: 'selected' },
    patch: {},
    rootPatch: {
      shadows: [
        {
          id: 'ring',
          inset: false,
          x: 0,
          y: 0,
          blur: 0,
          spread: 2,
          color: ACCENT,
        },
        accentShadow({ id: 'halo', inset: false, blur: 16, percent: 45 }),
      ],
    },
  }
}

/**
 * 罐形报警：描边转危险色，外壳呼吸、状态点脉冲（§7.7 #49、#53）。
 * ⚠ 参考项目动的是 box-shadow 的浓度，本模型的 keyframes 是固定四档，`breathe` 动的是
 * 整枝不透明度——观感同族但不逐帧相同。
 */
function tankAlarmVariant(): Twin2dVariant {
  return {
    id: 'alarm',
    when: { kind: 'status', in: ['alarm'] },
    patch: {
      frame: {
        border: borderOf(1.5, DANGER),
        anim: { kind: 'breathe', durationMs: ALARM_MS },
      },
      'status-dot': { anim: { kind: 'pulse', durationMs: ALARM_MS } },
    },
    rootPatch: {},
  }
}

// 分集水器（cylinder）

/** 圆柱的设计宽，SVG 几何按它落成设计像素 */
const CYL_W = 224
/** 圆柱的设计高 */
const CYL_H = 126
/** 体身矩形左右各内缩多少，也是端盖圆心的横坐标 */
const CYL_BODY_INSET = 10
/** 双集管线左右各内缩多少 */
const CYL_LINE_INSET = 14
/** 端盖的横半径；**固定 10**，不随高度走 */
const CYL_CAP_RX = 10
/** 圆柱竖向中线 */
const CYL_CY = CYL_H / 2
/** 暖管相对中线的偏移 */
const CYL_WARM_DY = -3
/** 冷管相对中线的偏移；⚠ 与暖管的 -3 **不对称**，照抄 */
const CYL_COOL_DY = 6
/** 图标边长；`.tnv-cyl__icon` 是 26×26，比罐形的 30 小 */
const CYL_ICON_SIZE = 26

/** 本体描边线宽 */
const CYL_INK_WIDTH = 1.2
/** hover 档的本体线宽 */
const CYL_HOVER_WIDTH = 1.8
/** 选中档的本体线宽 */
const CYL_SELECTED_WIDTH = 2.5
/** 选中与报警那一圈发光的模糊半径，取自参考项目的 `drop-shadow(0 0 8px …)` */
const CYL_GLOW_BLUR = 8

/**
 * 体身填充：`--topo-cyl-fill` 指向的语义层。
 * ⚠ 不写 `var(--t2-fill-a)`：那是节点渐变的低端，与体身色在参考项目里是**两个**
 * 局部变量，今天恰好同指 `--surface-panel`。合成一个，往后调渐变就会连体身一起变。
 */
const CYL_BODY_FILL: Twin2dPaint = {
  kind: 'color',
  color: 'var(--surface-panel)',
}
/**
 * 端盖填充：`--topo-cap-fill` 指向的语义层。
 * ⚠ **端盖与体身不同色**，圆柱的立体感全在这一处：抄成同色就变成一个平的矩形加两个
 * 椭圆边，而每一项数值都「对」（§7.5 #33）。
 */
const CYL_CAP_FILL: Twin2dPaint = {
  kind: 'color',
  color: 'var(--surface-overlay)',
}

/** 体身描边色：水色 62% */
const CYL_BODY_STROKE = `rgba(${TWIN_2D_PALETTE_RGB.water}, 0.62)`
/** 端盖描边色：水色 70%，比体身更实一档 */
const CYL_CAP_STROKE = `rgba(${TWIN_2D_PALETTE_RGB.water}, 0.7)`
/** 暖管描边色：蒸汽色 60% */
const CYL_WARM_STROKE = `rgba(${TWIN_2D_PALETTE_RGB.steam}, 0.6)`
/** 冷管描边色：太阳能色 60% */
const CYL_COOL_STROKE = `rgba(${TWIN_2D_PALETTE_RGB.solar}, 0.6)`

/** 不上色 */
const NO_PAINT: Twin2dPaint = { kind: 'none' }

/**
 * 一遍圆柱描边。
 * ⚠ `nonScaling` 必须为真：参考项目那四条都带 `vector-effect: non-scaling-stroke`，
 * 少了它节点一放大线就跟着变粗，而每一项数值仍然是「对」的。
 * @param spec 这一遍的 id、线宽、颜色与线端
 */
function cylStroke(spec: {
  id: string
  width: number
  color: string
  round: boolean
}): Twin2dStrokePass {
  return {
    id: spec.id,
    width: spec.width,
    color: spec.color,
    dash: [],
    cap: spec.round ? 'round' : 'butt',
    join: 'miter',
    opacity: 1,
    nonScaling: true,
  }
}

/**
 * 一枚圆柱本体的 vec：铺满节点盒、按设计像素直写几何、两轴各自拉伸。
 * ⚠ `stretch` 即 `preserveAspectRatio="none"`，参考项目的圆柱就是拉伸的（§7.5 #31）。
 * ⚠ 照旧吃指针事件：参考项目的 `.tnv-cyl__svg` 没有 `pointer-events` 规则，整个圆柱
 * 本体是可点的，只有压在它上面的文字层显式让开。这五枚摘成 `none` 会让圆柱只有图标
 * 那一小块能点中。
 * @param id 样式内唯一的图元 id
 * @param shape 几何，坐标按设计像素
 * @param fill 填充
 * @param strokes 多遍描边
 */
function cylVec(
  id: string,
  shape: Twin2dShape,
  fill: Twin2dPaint,
  strokes: readonly Twin2dStrokePass[],
): Twin2dVecPrim {
  return {
    ...primBase(id, FILL_PARENT, AUTO_SIZE),
    kind: 'vec',
    coord: 'px',
    shape,
    fill,
    strokes,
    gradients: [],
    stretch: true,
  }
}

/**
 * 体身矩形。
 * ⚠ `rx` 是 **0**：参考项目这一枚是直角矩形，圆角全靠两端的椭圆端盖压出来。
 * 给了圆角会让端盖与体身之间露出一条月牙缝。
 */
function cylOutline(): Twin2dVecPrim {
  return cylVec(
    'outline',
    {
      kind: 'rect',
      x: CYL_BODY_INSET,
      y: 0,
      w: CYL_W - CYL_BODY_INSET * 2,
      h: CYL_H,
      rx: 0,
    },
    CYL_BODY_FILL,
    [
      cylStroke({
        id: 'ink',
        width: CYL_INK_WIDTH,
        color: CYL_BODY_STROKE,
        round: false,
      }),
    ],
  )
}

/**
 * 一枚端盖。
 * @param id 样式内唯一的图元 id
 * @param cx 圆心横坐标（设计像素）
 */
function cylCap(id: string, cx: number): Twin2dVecPrim {
  return cylVec(
    id,
    { kind: 'ellipse', cx, cy: CYL_CY, rx: CYL_CAP_RX, ry: CYL_CY },
    CYL_CAP_FILL,
    [
      cylStroke({
        id: 'ink',
        width: CYL_INK_WIDTH,
        color: CYL_CAP_STROKE,
        round: false,
      }),
    ],
  )
}

/**
 * 一条集管线。
 * @param id 样式内唯一的图元 id
 * @param dy 相对竖向中线的偏移（设计像素）
 * @param color 描边色
 */
function cylLine(id: string, dy: number, color: string): Twin2dVecPrim {
  const y = CYL_CY + dy
  return cylVec(
    id,
    {
      kind: 'line',
      x1: CYL_LINE_INSET,
      y1: y,
      x2: CYL_W - CYL_LINE_INSET,
      y2: y,
    },
    NO_PAINT,
    [cylStroke({ id: 'ink', width: CYL_INK_WIDTH, color, round: true })],
  )
}

/** 圆柱图标：左侧 7% 处、竖向居中（§7.5 #38）。 */
function cylIcon(): Twin2dIcoPrim {
  const at: Twin2dPlacement = {
    kind: 'abs',
    left: '7%',
    right: null,
    top: '50%',
    bottom: null,
    tx: '0',
    ty: '-50%',
  }
  const size = { w: CYL_ICON_SIZE, h: CYL_ICON_SIZE }
  return {
    ...spriteOf(primBase('icon', at, size), 'ico-vsl-manifold'),
    z: 2,
  }
}

/**
 * 标题 + 读数那一列，压在 SVG 之上（§7.5 #39、#40）。
 * ⚠ `pointerEvents: 'none'`：这一层盖着大半个圆柱，吃了指针事件底下的图元就选不中。
 * ⚠ 两行之间**没有** gap，罐形那一列是 2——参考项目逐值不同。
 */
function cylBody(): Twin2dBoxPrim {
  const at: Twin2dPlacement = { kind: 'fill', inset: [0, '14%', 0, '24%'] }
  const title = titleText([
    // ⚠ 取的是**背景色** `--topo-node-fill-b`，不是 accent：抄成 accent 会让标题
    //   在深色底上发绿光（§7.5 #40）
    glowShadow('title-halo', 4, FILL_B),
  ])
  return {
    ...boxOf(
      primBase('body', at, AUTO_SIZE),
      layoutOf({
        flow: 'col',
        gap: 0,
        align: 'center',
        justify: 'center',
        pad: [0, 0, 0, 0],
      }),
      // ⚠ 圆柱读数**没有** letter-spacing，罐形那一处是 .5px
      [title, readingText(null)],
    ),
    z: 2,
    pointerEvents: 'none',
  }
}

/**
 * 圆柱 hover：体身描边转强调色并加粗到 1.8（§7.5 #37 邻档）。
 * ⚠ 参考项目的圆柱 hover **不抬也不放大**：`.tnv:hover` 只落在 `.tnv-cyl__outline`
 * 上，罐形那一档才有 `translateY(-3px) scale(1.02)`。
 */
function cylHoverVariant(): Twin2dVariant {
  return {
    id: 'hover',
    when: { kind: 'state', state: 'hover' },
    patch: {
      outline: {
        strokes: [
          cylStroke({
            id: 'ink',
            width: CYL_HOVER_WIDTH,
            color: ACCENT,
            round: false,
          }),
        ],
      },
    },
    rootPatch: {
      shadows: [glowShadow('halo', CYL_GLOW_BLUR, mixTransparent(ACCENT, 64))],
      z: 30,
    },
  }
}

/**
 * 圆柱选中：体身线宽 2.5 + 一层强调色发光（§7.5 #37）。
 * ⚠ **没有**罐形那一圈 2px 实边：参考项目的 `is-selected` 只落在 box / tank /
 * square-tile 三者上，圆柱走的是另一条规则。
 * ⚠ 参考项目那层光是 `filter: drop-shadow(0 0 8px …)`，贴着圆柱轮廓；本模型的 vec
 * 没有滤镜面，改挂节点根的外发光——圆柱的轮廓本就铺满整个节点盒，两者近似重合。
 */
function cylSelectedVariant(): Twin2dVariant {
  return {
    id: 'selected',
    when: { kind: 'state', state: 'selected' },
    patch: {
      outline: {
        strokes: [
          cylStroke({
            id: 'ink',
            width: CYL_SELECTED_WIDTH,
            color: CYL_BODY_STROKE,
            round: false,
          }),
        ],
      },
    },
    rootPatch: { shadows: [glowShadow('halo', CYL_GLOW_BLUR, ACCENT)] },
  }
}

/**
 * 圆柱报警：体身描边转危险色 + 同色发光，状态点脉冲（§7.5 #37、§7.7 #53）。
 * ⚠ 线宽仍是 1.2：参考项目只有选中那一档加粗到 2.5，报警只换色。
 * ⚠ 也**不呼吸**：`tnv-alarm` 那个 keyframes 只挂在 box / tank / square-tile 上。
 */
function cylAlarmVariant(): Twin2dVariant {
  return {
    id: 'alarm',
    when: { kind: 'status', in: ['alarm'] },
    patch: {
      outline: {
        strokes: [
          cylStroke({
            id: 'ink',
            width: CYL_INK_WIDTH,
            color: DANGER,
            round: false,
          }),
        ],
      },
      'status-dot': { anim: { kind: 'pulse', durationMs: ALARM_MS } },
    },
    rootPatch: { shadows: [glowShadow('halo', CYL_GLOW_BLUR, DANGER)] },
  }
}

// 两个样式

/** 水箱：横向胶囊，强调色跟随主题的一级强调色（参考项目的 `--accent-primary`）。 */
function waterTankStyle(): Twin2dNodeStyle {
  return {
    id: 'water-tank',
    name: '水箱',
    category: 'vessel',
    accent: 'var(--accent-primary)',
    defaultStatus: 'online',
    size: { w: 196, h: 140 },
    prims: [tankFrame(), tankStubs(), statusDot()],
    ports: VESSEL_PORTS,
    slots: vesselSlots(),
    variants: [tankHoverVariant(), tankSelectedVariant(), tankAlarmVariant()],
  }
}

/**
 * 分集水器：横向圆柱，强调色跟随主题的二级强调色（参考项目的 `--accent-secondary`）。
 * ⚠ 五枚 vec 的文档序就是叠序：体身在最下、两枚端盖压在它两头、双集管线在最上。
 * 重排就是改渲染结果——端盖跑到体身下面时只表现为「圆柱两头变平了」。
 */
function manifoldStyle(): Twin2dNodeStyle {
  return {
    id: 'manifold',
    name: '分集水器',
    category: 'vessel',
    accent: 'var(--accent-secondary)',
    defaultStatus: 'online',
    size: { w: CYL_W, h: CYL_H },
    prims: [
      cylOutline(),
      cylCap('cap-left', CYL_BODY_INSET),
      cylCap('cap-right', CYL_W - CYL_BODY_INSET),
      cylLine('line-warm', CYL_WARM_DY, CYL_WARM_STROKE),
      cylLine('line-cool', CYL_COOL_DY, CYL_COOL_STROKE),
      cylIcon(),
      cylBody(),
      statusDot(),
    ],
    ports: VESSEL_PORTS,
    slots: vesselSlots(),
    variants: [cylHoverVariant(), cylSelectedVariant(), cylAlarmVariant()],
  }
}

/**
 * 两个储能容器预置样式，文档序即调色板里的摆放序。
 * ⚠ 两者的强调色走语义 token 而不是调色板字面色：参考项目 `builtinLibrary` 里
 * 这两件的 `colorVar` 就是 `--accent-primary` / `--accent-secondary`，本仓有这两个
 * token，于是它们是预置库里**唯二跟随换肤**的强调色（§6.1）。
 */
export const TWIN_2D_VESSEL_STYLES: readonly Twin2dNodeStyle[] = [
  waterTankStyle(),
  manifoldStyle(),
]
