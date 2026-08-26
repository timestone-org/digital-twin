/**
 * @fileoverview 三个 `box` 系族（末端 / 容器 / 换热与标注）共用的那批图元零件：
 * 注入变量名、缺省几何、四个图元构造器与右下角状态点。
 * ⚠ 这里只放**逐族逐值相同**的那些。凡是参考项目里逐族不同的取值（hover 落影
 * `.24` 对 `.22`、缩放 1.025 对 1.02 对 1.04、主读数 32 对 30）一律留在各族自己的
 * 文件里——搬上来「统一」一次，三族的观感就一起偏了，而没有一处会报错。
 */
import { TWIN_2D_STATUSES } from '../kinds'
import { mixTransparent } from './palette'
import type { Twin2dSpriteId } from '../kinds'
import type {
  Twin2dBorder,
  Twin2dBoxPrim,
  Twin2dCondition,
  Twin2dFill,
  Twin2dIcoPrim,
  Twin2dLayout,
  Twin2dPlacement,
  Twin2dPrim,
  Twin2dPrimBase,
  Twin2dShadow,
  Twin2dSize,
  Twin2dTxtPrim,
} from '../typesPrim'

/** 节点根上的强调色变量，`paintCommon.injectVars` 注入 */
export const ACCENT = 'var(--t2-accent)'
/** 状态点取色的变量；`hidden` 档整个不注入，故状态点靠 `when` 摘掉 */
export const STATUS = 'var(--t2-status)'
/** 盒渐变的两端，同由 `injectVars` 注入 */
export const FILL_A = 'var(--t2-fill-a)'
export const FILL_B = 'var(--t2-fill-b)'
/** 变换基点缺省，与归一化的 `originOr` 同值 */
export const CENTER_ORIGIN = '50% 50%'
/** 显示名字号：参考项目的 `--topo-node-name-size` */
export const NAME_SIZE = 18
/** 参考项目七处过渡统一的 180ms ease */
export const TRANSITION_MS = 180
/** 报警呼吸与状态点脉冲的周期 */
export const ALARM_MS = 1000

/**
 * hover 的描边色。
 * ⚠ 掺的是 `--text-primary` 而不是透明底，`mixTransparent` 表达不了这一条：
 * 换成透明底会让 hover 时描边变淡而不是变亮。
 */
export const HOVER_BORDER = `color-mix(in srgb, ${ACCENT} 86%, var(--text-primary))`

/** 四边全开 */
export const ALL_SIDES = { top: true, right: true, bottom: true, left: true }

/** 无边框 */
export const NO_BORDER: Twin2dBorder = {
  width: 0,
  style: 'none',
  color: 'currentColor',
  sides: ALL_SIDES,
}

/** 状态点只在四档真状态下画；`hidden` 档 `ctx.status` 为 null，这条恒不成立 */
export const STATUS_PRESENT: Twin2dCondition = {
  kind: 'status',
  in: TWIN_2D_STATUSES,
}

/** 自适应尺寸 */
export const AUTO_SIZE: Twin2dSize = { w: 'auto', h: 'auto' }

/** 铺满父盒 */
export const FILL_PARENT: Twin2dPlacement = {
  kind: 'fill',
  inset: [0, 0, 0, 0],
}

/** 参与父级的流 */
export const IN_FLOW: Twin2dPlacement = { kind: 'flow' }

/** 只摆一个孩子并居中的排布 */
export const FLOW_NONE: Omit<Twin2dLayout, 'wrap'> = {
  flow: 'none',
  gap: 0,
  align: 'center',
  justify: 'center',
  pad: [0, 0, 0, 0],
}

/**
 * 边框：一律用节点强调色的某个混色。
 * @param width 线宽
 * @param color 线色
 */
export function borderOf(width: number, color: string): Twin2dBorder {
  return { width, style: 'solid', color, sides: ALL_SIDES }
}

/**
 * 排布六项；预置里一处都不折行。
 * @param spec 除 `wrap` 外的五项
 */
export function layoutOf(spec: Omit<Twin2dLayout, 'wrap'>): Twin2dLayout {
  return { ...spec, wrap: false }
}

/**
 * 一层实色填充。
 * @param id 填充层 id
 * @param color 颜色
 */
export function solidFill(id: string, color: string): Twin2dFill {
  return { kind: 'solid', id, color, opacity: 1 }
}

/** 150° 的盒底渐变，`box` 与 `square` 两形同角。 */
export function baseGradient(): Twin2dFill {
  return {
    kind: 'linear',
    id: 'fill-base',
    angle: 150,
    stops: [
      { id: 'stop-a', color: FILL_A, at: 0 },
      { id: 'stop-b', color: FILL_B, at: 1 },
    ],
    opacity: 1,
  }
}

/**
 * 一条强调色的发光阴影。
 * @param spec 层 id、内外、模糊半径，以及掺进透明底的比例
 */
export function accentShadow(spec: {
  id: string
  inset: boolean
  blur: number
  percent: number
}): Twin2dShadow {
  return {
    id: spec.id,
    inset: spec.inset,
    x: 0,
    y: 0,
    blur: spec.blur,
    spread: 0,
    color: mixTransparent(ACCENT, spec.percent),
  }
}

/**
 * 图元共有的十六项；偏离缺省的那几项由调用处用展开覆盖。
 * @param id 图元 id
 * @param at 摆位
 * @param size 尺寸
 */
export function primBase(
  id: string,
  at: Twin2dPlacement,
  size: Twin2dSize,
): Twin2dPrimBase {
  return {
    id,
    at,
    size,
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
    transformOrigin: CENTER_ORIGIN,
    pointerEvents: 'auto',
    keepUpright: false,
  }
}

/**
 * 一个不上色的盒：填充、边框、圆角与阴影由调用处覆盖。
 * @param base 基类十六项
 * @param layout 排布
 * @param children 子图元
 */
export function boxOf(
  base: Twin2dPrimBase,
  layout: Twin2dLayout,
  children: readonly Twin2dPrim[],
): Twin2dBoxPrim {
  return {
    ...base,
    kind: 'box',
    layout,
    fills: [],
    border: NO_BORDER,
    radius: 0,
    shadows: [],
    backdropBlur: 0,
    clip: false,
    cursor: 'default',
    children,
  }
}

/**
 * 一段文字；字体、省略、`title` 与阴影由调用处覆盖。
 * @param base 基类十六项
 * @param src 文本来源
 */
export function txtOf(
  base: Twin2dPrimBase,
  src: Twin2dTxtPrim['src'],
): Twin2dTxtPrim {
  return {
    ...base,
    kind: 'txt',
    src,
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
}

/**
 * 一枚内置图标。
 * @param base 基类十六项
 * @param id sprite id
 */
export function spriteOf(
  base: Twin2dPrimBase,
  id: Twin2dSpriteId,
): Twin2dIcoPrim {
  return { ...base, kind: 'ico', src: { kind: 'sprite', id }, color: ACCENT }
}

/** 右下角的状态点：`hidden` 档由 `when` 整枝摘掉（§7.7 行 53、行 55）。 */
export function statusDot(): Twin2dBoxPrim {
  const at: Twin2dPlacement = {
    kind: 'abs',
    left: null,
    right: 5,
    top: null,
    bottom: 5,
    tx: '0',
    ty: '0',
  }
  return {
    ...boxOf(
      primBase('status-dot', at, { w: 7, h: 7 }),
      layoutOf(FLOW_NONE),
      [],
    ),
    z: 5,
    when: STATUS_PRESENT,
    fills: [solidFill('dot', STATUS)],
    radius: 'pill',
    shadows: [
      {
        id: 'dot-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 6,
        spread: 0,
        color: STATUS,
      },
    ],
  }
}
