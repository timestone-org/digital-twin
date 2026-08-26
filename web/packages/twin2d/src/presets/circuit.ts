/**
 * @fileoverview 预置库的电路符号族：电阻、电容、电感、二极管、开关、接地、电源、
 * 接线点共 8 枚。每枚是一份 `Twin2dNodeStyle` 字面量（几何 + 端口 + 引脚 marker +
 * 一个正立标号），与用户自建的样式走同一条渲染路径。口径见
 * docs/MODULE_TWIN_2D_DESIGN.md §6.2 与 §12。
 * ⚠ 符号标准是 GB/T 4728：电阻是长宽比 4:1 的**空心矩形**、接地是**三横递减**。
 * 北美系常见的折线锯齿形电阻不是本族的口径，别拿那种图来对这几枚的几何。
 */
import type {
  Twin2dAnchor9,
  Twin2dPortDir,
  Twin2dPortSide,
  Twin2dStrokeCap,
  Twin2dStrokeJoin,
} from '../kinds'
import type {
  Twin2dNodeStyle,
  Twin2dPinMarker,
  Twin2dPort,
  Twin2dPortAt,
} from '../types'
import type {
  Twin2dPaint,
  Twin2dPrimBase,
  Twin2dShape,
  Twin2dStrokePass,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../typesPrim'

/** 本族全部线条的线宽（设计像素）：符号本体、引脚与接线点一律同宽 */
const INK_WIDTH = 1.5

/** 符号本体的取色：节点根上注入的强调色，跟着节点实例的 `accent` 走 */
const INK = 'var(--t2-accent)'

/**
 * 引脚短横线的取色。
 * ⚠ 这里不能写 `var(--t2-accent)`：引脚由 `edgeView` 画在**连线层**里，那一层在节点根
 * 之外，读不到根上注入的六个 `--t2-*`。写了整条 `stroke` 声明报废，引脚退回浏览器缺省
 * 的黑色——而本体仍然是对的，看着只像「引脚颜色没跟上」。
 */
const PIN_INK = 'var(--text-primary)'

/** 引脚伸出节点盒外的长度（设计像素）：连线从这一头的外端起画 */
const PIN_LENGTH = 8

/** 元件标号的字号（设计像素） */
const LABEL_SIZE = 12

/** 元件标号的字重 */
const LABEL_WEIGHT = 500

/** 不上色 */
const NO_FILL: Twin2dPaint = { kind: 'none' }

/** 实心：二极管三角、开关触点与接线点圆点用它 */
const SOLID_INK: Twin2dPaint = { kind: 'color', color: INK }

/**
 * 实心图元一律不描边。
 * ⚠ 同色描边看不出来，但它把形状往外撑半个线宽：接线点的 r=3 会画成 3.75、二极管的
 * 三角尖会戳过阴极横杠，而「半径 3」「尖端与横杠同在 x=26」这两条口径就都不再成立。
 */
const NO_STROKE: readonly Twin2dStrokePass[] = []

/**
 * 图元公共十五项的本族缺省：铺满节点盒、不吃指针、不参与变体。
 * ⚠ `at` 取 `fill` 是「几何坐标能按设计像素直写」的前提——vec 的 viewBox 取的是**父级**
 * 盒尺寸，根层图元的父级就是节点盒，所以 `coord: 'px'` 的坐标与样式 `size` 是同一把尺子。
 * 换成别的摆位，同一组数字画出来就不在同一个坐标系里了。
 */
const PRIM_BASE: Omit<Twin2dPrimBase, 'id'> = {
  at: { kind: 'fill', inset: [0, 0, 0, 0] },
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
  pointerEvents: 'none',
  keepUpright: false,
}

/**
 * 一遍符号线条的描边。
 * @param cap 线端
 * @param join 折角
 */
function ink(
  cap: Twin2dStrokeCap,
  join: Twin2dStrokeJoin,
): readonly Twin2dStrokePass[] {
  return [
    {
      id: 'ink',
      width: INK_WIDTH,
      color: INK,
      dash: [],
      cap,
      join,
      opacity: 1,
      nonScaling: false,
    },
  ]
}

/**
 * 一枚 vec 图元。
 * @param id 样式内唯一的图元 id
 * @param shape 几何，坐标按设计像素
 * @param fill 填充
 * @param strokes 多遍描边
 */
function vec(
  id: string,
  shape: Twin2dShape,
  fill: Twin2dPaint,
  strokes: readonly Twin2dStrokePass[],
): Twin2dVecPrim {
  return {
    ...PRIM_BASE,
    id,
    kind: 'vec',
    coord: 'px',
    shape,
    fill,
    strokes,
    gradients: [],
    stretch: false,
  }
}

/**
 * 一段直线图元：引线、电容极板、接地横杠与开关刀闸都从这里出。
 * @param id 样式内唯一的图元 id
 * @param x1 起点 x（设计像素）
 * @param y1 起点 y
 * @param x2 终点 x
 * @param y2 终点 y
 */
function seg(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Twin2dVecPrim {
  return vec(
    id,
    { kind: 'line', x1, y1, x2, y2 },
    NO_FILL,
    ink('round', 'round'),
  )
}

/**
 * 元件标号：读节点实例的 `label`，贴在节点盒外侧，且永远正立。
 * ⚠ `keepUpright` 是电路图惯例，不是可选项：节点转 90° 时符号跟着转、标号不跟着转。
 * 少了它，一张有竖排元件的图上会有一半标号是躺着的，而没有任何一处报错。
 * @param anchor 贴哪一侧（横排元件贴上、引脚朝上下的元件贴右，免得压住引脚）
 */
function designator(anchor: Twin2dAnchor9): Twin2dTxtPrim {
  return {
    ...PRIM_BASE,
    id: 'ref',
    kind: 'txt',
    at: { kind: 'anchor', anchor, dx: 0, dy: 0 },
    keepUpright: true,
    src: { kind: 'label' },
    font: { size: LABEL_SIZE, weight: LABEL_WEIGHT, color: PIN_INK },
    lineHeight: null,
    align: 'center',
    baseline: 'auto',
    nowrap: true,
    ellipsis: false,
    titleAttr: false,
    shadows: [],
    outline: null,
  }
}

/**
 * 引脚符号：沿出线方向伸出的一段短横线。
 * ⚠ 几何按 `unit` 档解释、`length` 见方，且 +x 就是出线方向，所以 `(0,0) → (1,0)`
 * 才是「从端口点笔直伸出去一段」；y 给非 0 的话引脚会与端口点错开，而连线仍然从
 * 引脚外端起画，看着像连线飘在半空。
 * ⚠ `strokes` 不能省：只给 `shape` 时线宽落到 SVG 缺省的 1px，整张图的引脚比导线细
 * 一圈，这既不报错也不像 bug，只像画得难看（§4.4）。
 */
const PIN_MARKER: Twin2dPinMarker = {
  shape: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
  strokes: [
    {
      id: 'pin',
      width: INK_WIDTH,
      color: PIN_INK,
      dash: [],
      cap: 'butt',
      join: 'miter',
      opacity: 1,
      nonScaling: false,
    },
  ],
  fill: NO_FILL,
  length: PIN_LENGTH,
}

/**
 * 节点盒内的归一落点。
 * @param x 0..1
 * @param y 0..1
 */
function xy(x: number, y: number): Twin2dPortAt {
  return { kind: 'xy', x, y }
}

/**
 * 一个带引脚的端口。
 * @param id 端口 id，连线按它挂
 * @param name 引脚名
 * @param at 落点
 * @param dir 通路方向
 * @param side 出线方向
 */
function pin(
  id: string,
  name: string,
  at: Twin2dPortAt,
  dir: Twin2dPortDir,
  side: Twin2dPortSide,
): Twin2dPort {
  return { id, name, at, dir, side, showName: false, marker: PIN_MARKER }
}

/**
 * 接线点的端口：导线直接落在圆点上，没有引脚要画。
 * @param id 端口 id
 * @param name 引脚名
 * @param t 周长参数，四边中点是 0.125 / 0.375 / 0.625 / 0.875
 * @param side 出线方向
 */
function tap(
  id: string,
  name: string,
  t: number,
  side: Twin2dPortSide,
): Twin2dPort {
  return {
    id,
    name,
    at: { kind: 'perim', t },
    dir: 'both',
    side,
    showName: false,
    marker: null,
  }
}

/**
 * 本族样式的公共头：调色板分栏、缺省墨色，与「不画状态点」。
 * ⚠ `accent` 取 `--text-primary` 而不是主题强调色：电路图是墨线图，出厂就该与图框
 * 同色；要变色是用户改节点 `accent` 的事。
 */
const STYLE_BASE = {
  category: 'circuit',
  accent: PIN_INK,
  defaultStatus: 'hidden',
  slots: [],
  variants: [],
} as const

/** 电阻：GB/T 4728 的空心矩形，24×6 恰好是长宽比 4:1。 */
export const TWIN_2D_CIRCUIT_RESISTOR: Twin2dNodeStyle = {
  ...STYLE_BASE,
  id: 'circuit-resistor',
  name: '电阻',
  size: { w: 40, h: 20 },
  prims: [
    seg('lead-1', 0, 10, 8, 10),
    seg('lead-2', 32, 10, 40, 10),
    vec(
      'body',
      { kind: 'rect', x: 8, y: 7, w: 24, h: 6, rx: 0 },
      NO_FILL,
      ink('butt', 'miter'),
    ),
    designator('t'),
  ],
  ports: [
    pin('1', '1', xy(0, 0.5), 'passive', 'left'),
    pin('2', '2', xy(1, 0.5), 'passive', 'right'),
  ],
}

/** 电容：两条等长平行极板，板间距 6。 */
export const TWIN_2D_CIRCUIT_CAPACITOR: Twin2dNodeStyle = {
  ...STYLE_BASE,
  id: 'circuit-capacitor',
  name: '电容',
  size: { w: 40, h: 20 },
  prims: [
    seg('lead-1', 0, 10, 17, 10),
    seg('lead-2', 23, 10, 40, 10),
    seg('plate-1', 17, 3, 17, 17),
    seg('plate-2', 23, 3, 23, 17),
    designator('t'),
  ],
  ports: [
    pin('1', '1', xy(0, 0.5), 'passive', 'left'),
    pin('2', '2', xy(1, 0.5), 'passive', 'right'),
  ],
}

/**
 * 电感：四个朝上的半圆弧，每个跨 6、半径 3。
 * ⚠ 四段弧的 `sweep-flag` 都是 1：在 y 轴朝下的 SVG 坐标里，从左往右画且 sweep=1
 * 才是往上鼓；写成 0 会画成四个朝下的弧，那是另一种符号。
 */
export const TWIN_2D_CIRCUIT_INDUCTOR: Twin2dNodeStyle = {
  ...STYLE_BASE,
  id: 'circuit-inductor',
  name: '电感',
  size: { w: 40, h: 20 },
  prims: [
    seg('lead-1', 0, 10, 8, 10),
    seg('lead-2', 32, 10, 40, 10),
    vec(
      'body',
      {
        kind: 'path',
        d:
          'M 8 10 A 3 3 0 0 1 14 10 A 3 3 0 0 1 20 10' +
          ' A 3 3 0 0 1 26 10 A 3 3 0 0 1 32 10',
      },
      NO_FILL,
      ink('round', 'round'),
    ),
    designator('t'),
  ],
  ports: [
    pin('1', '1', xy(0, 0.5), 'passive', 'left'),
    pin('2', '2', xy(1, 0.5), 'passive', 'right'),
  ],
}

/**
 * 二极管：实心三角指向阴极，阴极横杠压在三角尖上。
 * ⚠ 这一枚是 `transform.test.ts` 的锁具：两个端口方向有意义（阳极 A / 阴极 K）、外形
 * 也不对称，所以 4 档 rotate × 4 种 flip 的 16 组端口坐标是全仓唯一能看出「先镜像后
 * 旋转」还是「先旋转后镜像」的样例。端口 id、名字与落点改一个，那份用例就不再守着
 * 复合顺序了。
 */
export const TWIN_2D_CIRCUIT_DIODE: Twin2dNodeStyle = {
  ...STYLE_BASE,
  id: 'circuit-diode',
  name: '二极管',
  size: { w: 40, h: 20 },
  prims: [
    seg('lead-a', 0, 10, 14, 10),
    seg('lead-k', 26, 10, 40, 10),
    vec(
      'tri',
      {
        kind: 'poly',
        points: [
          [14, 4],
          [14, 16],
          [26, 10],
        ],
        closed: true,
      },
      SOLID_INK,
      NO_STROKE,
    ),
    seg('bar', 26, 4, 26, 16),
    designator('t'),
  ],
  ports: [
    pin('a', 'A', xy(0, 0.5), 'in', 'left'),
    pin('k', 'K', xy(1, 0.5), 'out', 'right'),
  ],
}

/** 开关：两个实心触点加一把抬起的刀闸（常态画成断开）。 */
export const TWIN_2D_CIRCUIT_SWITCH: Twin2dNodeStyle = {
  ...STYLE_BASE,
  id: 'circuit-switch',
  name: '开关',
  size: { w: 40, h: 20 },
  prims: [
    seg('lead-1', 0, 10, 12, 10),
    seg('lead-2', 28, 10, 40, 10),
    vec(
      'pivot',
      { kind: 'ellipse', cx: 12, cy: 10, rx: 1.5, ry: 1.5 },
      SOLID_INK,
      NO_STROKE,
    ),
    vec(
      'contact',
      { kind: 'ellipse', cx: 28, cy: 10, rx: 1.5, ry: 1.5 },
      SOLID_INK,
      NO_STROKE,
    ),
    seg('blade', 12, 10, 27, 3),
    designator('t'),
  ],
  ports: [
    pin('1', '1', xy(0, 0.5), 'passive', 'left'),
    pin('2', '2', xy(1, 0.5), 'passive', 'right'),
  ],
}

/**
 * 接地：GB/T 4728 的三横递减（16 / 10 / 4），一竖引下。
 * ⚠ 标号贴右不贴上：唯一那个端口在顶边，引脚正朝上伸出去 8px，贴上就压在引脚上。
 */
export const TWIN_2D_CIRCUIT_GROUND: Twin2dNodeStyle = {
  ...STYLE_BASE,
  id: 'circuit-ground',
  name: '接地',
  size: { w: 24, h: 20 },
  prims: [
    seg('lead', 12, 0, 12, 10),
    seg('bar-1', 4, 10, 20, 10),
    seg('bar-2', 7, 14, 17, 14),
    seg('bar-3', 10, 18, 14, 18),
    designator('r'),
  ],
  ports: [pin('1', 'GND', xy(0.5, 0), 'in', 'top')],
}

/**
 * 电源：一个圆加一个正号，正端在上、负端在下。
 * ⚠ 负端只有端口名 `−`、圆里不画负号：§6.2 那张表给的极性号就是**两条** line，
 * 而一个正号正好占两条；再补一条负号横线就与表对不上了。
 */
export const TWIN_2D_CIRCUIT_SOURCE: Twin2dNodeStyle = {
  ...STYLE_BASE,
  id: 'circuit-source',
  name: '电源',
  size: { w: 32, h: 40 },
  prims: [
    seg('lead-p', 16, 0, 16, 8),
    seg('lead-n', 16, 32, 16, 40),
    vec(
      'body',
      { kind: 'ellipse', cx: 16, cy: 20, rx: 12, ry: 12 },
      NO_FILL,
      ink('butt', 'miter'),
    ),
    seg('plus-h', 12, 14, 20, 14),
    seg('plus-v', 16, 10, 16, 18),
    designator('r'),
  ],
  ports: [
    pin('p', '+', xy(0.5, 0), 'out', 'top'),
    pin('n', '−', xy(0.5, 1), 'in', 'bottom'),
  ],
}

/**
 * 接线点：一个实心圆点，四条边中点各一个端口。
 * ⚠ 盒就是 6×6、圆点半径就是 3，两者同尺不是巧合：这样四个 `perim` 中点正好落在
 * 圆周上，导线贴着圆点收口。把盒放大而圆点不放大，四条线就都停在离圆点几像素的
 * 空处，而每一处看着都「连上了」。
 * ⚠ 四个端口都不带引脚 marker：接线点是导线的汇合处，本来就没有引脚可画，
 * 给了 marker 反而会让四条线各自往外错开 8px。
 */
export const TWIN_2D_CIRCUIT_JUNCTION: Twin2dNodeStyle = {
  ...STYLE_BASE,
  id: 'circuit-junction',
  name: '接线点',
  size: { w: 6, h: 6 },
  prims: [
    vec(
      'dot',
      { kind: 'ellipse', cx: 3, cy: 3, rx: 3, ry: 3 },
      SOLID_INK,
      NO_STROKE,
    ),
    designator('r'),
  ],
  ports: [
    tap('t', '1', 0.125, 'top'),
    tap('r', '2', 0.375, 'right'),
    tap('b', '3', 0.625, 'bottom'),
    tap('l', '4', 0.875, 'left'),
  ],
}

/** 8 枚电路符号；文档序就是调色板里的排序。 */
export const TWIN_2D_CIRCUIT_STYLES: readonly Twin2dNodeStyle[] = [
  TWIN_2D_CIRCUIT_RESISTOR,
  TWIN_2D_CIRCUIT_CAPACITOR,
  TWIN_2D_CIRCUIT_INDUCTOR,
  TWIN_2D_CIRCUIT_DIODE,
  TWIN_2D_CIRCUIT_SWITCH,
  TWIN_2D_CIRCUIT_GROUND,
  TWIN_2D_CIRCUIT_SOURCE,
  TWIN_2D_CIRCUIT_JUNCTION,
]
