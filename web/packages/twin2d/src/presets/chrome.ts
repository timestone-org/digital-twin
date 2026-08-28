/**
 * @fileoverview 每份节点预置样式都挂着的两枚「外挂件」：左上角标与外置显示名，
 * 以及外置显示名四档定位里非缺省的那三档变体。它们不属于任何一族的形状，
 * 与 `statusDot()` 同类——十一份样式逐份重复一遍才是真正的漂移源。
 * 逐值口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.7 #50 / #51 / #56。
 */
import { mixTransparent } from './palette'
import {
  ACCENT,
  ALL_SIDES,
  AUTO_SIZE,
  IN_FLOW,
  NAME_SIZE,
  boxOf,
  layoutOf,
  primBase,
  solidFill,
  txtOf,
} from './primKit'
import type { Twin2dNodeStyle, Twin2dOutline, Twin2dVariant } from '../types'
import type {
  Twin2dBoxPrim,
  Twin2dCondition,
  Twin2dPlacement,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dTxtPrim,
} from '../typesPrim'

/** 角标底色的注入变量：`node.badgeColor || accent`（§7.7 #50） */
const BADGE = 'var(--t2-badge)'
/** 角标字与显示名的取色 */
const TEXT_PRIMARY = 'var(--text-primary)'
/** 角标字体族：参考项目那串 `'DIN Alternate'…` 在本仓的对应 token（同为数字向窄体） */
const DISPLAY_FAMILY = 'var(--font-display)'
/** 外置显示名的宽度上限 */
const NAME_MAX_WIDTH = 160
/** `inside` 一档改按父盒比例收，不再是 160px */
const NAME_INSIDE_MAX_WIDTH = '92%'

/** 角标图元的 id；节点级 patch 与变体补丁按它寻址。 */
export const TWIN_2D_BADGE_PRIM_ID = 'badge'

/** 外置显示名图元的 id。 */
export const TWIN_2D_LABEL_OUTER_PRIM_ID = 'label-outer'

/**
 * 自然名位的显示条件：`labelPos` 落在 `bottom` 那一档。
 * ⚠ 判的是节点字段而不是 tag：合进自由 tag 表的话，用户自己写一条同名 tag
 * 就能把显示名挪走，而那既不像配置生效也不像出错（§7.7 #56）。
 */
export const TWIN_2D_LABEL_NATURAL_WHEN: Twin2dCondition = {
  kind: 'field',
  field: 'labelPos',
  test: 'in',
  in: ['bottom'],
}

/** 外置名位的显示条件：四档非缺省位置任一。`hidden` 两枚都不显示。 */
const LABEL_OUTER_WHEN: Twin2dCondition = {
  kind: 'field',
  field: 'labelPos',
  test: 'in',
  in: ['top', 'left', 'right', 'inside'],
}

/** 角标的显示条件：`node.badge` 有值。 */
const BADGE_WHEN: Twin2dCondition = {
  kind: 'field',
  field: 'badge',
  test: 'present',
  in: [],
}

/** 外置显示名四档定位的档名。 */
type Twin2dNamePos = 'top' | 'left' | 'right' | 'inside'

/** 外置显示名的四档定位，`top` 是图元自己带的那一档。 */
const NAME_AT: Record<Twin2dNamePos, Twin2dPlacement> = {
  top: {
    kind: 'abs',
    left: '50%',
    right: null,
    top: 0,
    bottom: null,
    tx: '-50%',
    ty: 'calc(-100% - 4px)',
  },
  left: {
    kind: 'abs',
    left: null,
    right: '100%',
    top: '50%',
    bottom: null,
    tx: '-6px',
    ty: '-50%',
  },
  right: {
    kind: 'abs',
    left: '100%',
    right: null,
    top: '50%',
    bottom: null,
    tx: '6px',
    ty: '-50%',
  },
  inside: {
    kind: 'abs',
    left: '50%',
    right: null,
    top: '50%',
    bottom: null,
    tx: '-50%',
    ty: '-50%',
  },
}

/**
 * 角标字：15/700、`line-height: 1`、主文本色，字体族走 `--font-display`。
 * ⚠ `lineHeight: 1` 少了角标会被行高撑成椭圆——18×18 的药丸里塞一段 15px 的字，
 * 缺省行高（约 1.2）算出来就是 18px 高的行盒再加上下留白（§7.7 #51）。
 */
function badgeText(): Twin2dTxtPrim {
  return {
    ...txtOf(primBase('badge-text', IN_FLOW, AUTO_SIZE), { kind: 'badge' }),
    font: {
      family: DISPLAY_FAMILY,
      size: 15,
      weight: 700,
      color: TEXT_PRIMARY,
    },
    lineHeight: 1,
  }
}

/**
 * 左上角标：贴在节点左上角外侧的一枚药丸，`node.badge` 有值时才画。
 * ⚠ 高固定 18、宽自适应且下限 18：只给宽高会让两位数的角标被裁掉，
 * 只给下限则一位数的角标画成一个竖着的椭圆（§7.7 #50）。
 * ⚠ 描边掺的是 `--text-primary` 而不是透明底：掺透明会让角标在深色底上失去边界。
 */
export function badgePrim(): Twin2dBoxPrim {
  const at: Twin2dPlacement = {
    kind: 'abs',
    left: 0,
    right: null,
    top: 0,
    bottom: null,
    tx: '-40%',
    ty: '-40%',
  }
  return {
    ...boxOf(
      primBase(TWIN_2D_BADGE_PRIM_ID, at, { w: 'auto', h: 18 }),
      layoutOf({
        flow: 'none',
        gap: 0,
        align: 'center',
        justify: 'center',
        pad: [0, 3, 0, 3],
      }),
      [badgeText()],
    ),
    minWidth: 18,
    z: 5,
    when: BADGE_WHEN,
    fills: [solidFill('badge-fill', BADGE)],
    border: {
      width: 1.5,
      style: 'solid',
      color: `color-mix(in srgb, ${TEXT_PRIMARY} 35%, ${BADGE})`,
      sides: ALL_SIDES,
    },
    radius: 'pill',
    shadows: [
      {
        id: 'badge-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 7,
        spread: 0,
        color: mixTransparent(BADGE, 75),
      },
    ],
  }
}

/**
 * 外置显示名：`labelPos` 取 `top/left/right/inside` 时画的那一枚，缺省带 `top` 档定位。
 * ⚠ `pointerEvents: 'none'` 不能省：它盖在节点外沿，吃了指针就会在名字底下丢 hover，
 * 表现是「鼠标一挪到名字上，整个节点的 hover 效果就闪一下没了」（§7 #15 的第五处）。
 * ⚠ 不挂 `title`：整枚图元不吃指针事件，原生提示永远弹不出来——与悬浮卡标题同一处取舍。
 */
export function labelOuterPrim(): Twin2dTxtPrim {
  return {
    ...txtOf(primBase(TWIN_2D_LABEL_OUTER_PRIM_ID, NAME_AT.top, AUTO_SIZE), {
      kind: 'label',
    }),
    maxWidth: NAME_MAX_WIDTH,
    z: 4,
    when: LABEL_OUTER_WHEN,
    pointerEvents: 'none',
    font: { size: NAME_SIZE, weight: 600, color: TEXT_PRIMARY },
    nowrap: true,
    ellipsis: true,
    shadows: [
      {
        id: 'name-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 4,
        spread: 0,
        color: mixTransparent(ACCENT, 50),
      },
    ],
  }
}

/** 一条把外置显示名挪到某一档的变体。 */
function labelVariant(
  pos: Exclude<Twin2dNamePos, 'top'>,
  patch: Twin2dPrimPatch,
): Twin2dVariant {
  return {
    id: `label-${pos}`,
    when: { kind: 'field', field: 'labelPos', test: 'in', in: [pos] },
    patch: { [TWIN_2D_LABEL_OUTER_PRIM_ID]: { at: NAME_AT[pos], ...patch } },
    rootPatch: {},
  }
}

/**
 * 外置显示名非缺省那三档的变体，文档序即覆盖序。
 * ⚠ 三条条件互斥，所以顺序在这里看不出影响——但仍按 `left/right/inside` 固定，
 * 换序会让「同一份样式两次序列化出的 JSON 不一样」（§4.5）。
 * ⚠ `inside` 那一档的上限是 **92%** 不是 160px：贴在节点正中的名字要跟着盒宽收，
 * 抄成 160 的表现是窄节点上的名字整段溢出到盒外（§7.7 #56）。
 */
export const TWIN_2D_LABEL_VARIANTS: readonly Twin2dVariant[] = [
  labelVariant('left', { align: 'end' }),
  labelVariant('right', { align: 'start' }),
  labelVariant('inside', {
    align: 'center',
    maxWidth: NAME_INSIDE_MAX_WIDTH,
  }),
]

/**
 * 两枚外挂件，追加在每份样式自己的图元之后（文档序即绘制序）。
 * @returns 角标与外置显示名，按 z 序 5 / 4
 */
export function twin2dChromePrims(): readonly Twin2dPrim[] {
  return [badgePrim(), labelOuterPrim()]
}

/**
 * 把两枚外挂件与三条定位变体并进一份样式。
 * ⚠ 变体接在**最后**：外置显示名的定位不该被样式自己的 hover / 报警补丁盖住，
 * 而合并序是「文档序在后的赢」（§4.5）。
 * @param style 已经写好形状、槽位与自己那几条变体的样式
 */
/**
 * 一份预置样式的原料：外缘可以不写，其余与 `Twin2dNodeStyle` 逐字相同。
 * ⚠ 只有**外缘**可缺席：它是后加的一项，缺省回外接矩形正是老口径。其余字段一个都不许
 * 省——省一个就得在这里补一份缺省，而那份缺省与归一化那份迟早漂开。
 */
type Twin2dStyleSeed = Omit<Twin2dNodeStyle, 'outline'> & {
  outline?: Twin2dOutline
}

export function twin2dWithChrome(style: Twin2dStyleSeed): Twin2dNodeStyle {
  return {
    ...style,
    // ⚠ 不声明外缘的按外接矩形算：那是老口径，逐个预置去补之前所有图一像素不动
    outline: style.outline ?? { kind: 'rect', r: 0 },
    prims: [...style.prims, ...twin2dChromePrims()],
    variants: [...style.variants, ...TWIN_2D_LABEL_VARIANTS],
  }
}
