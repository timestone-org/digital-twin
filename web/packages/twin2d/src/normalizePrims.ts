/**
 * @fileoverview 图元树的归一化：四种图元的公共十六项、四个子类各自的字段、深度上限
 * 截断，以及变体与节点级覆盖用的浅补丁。叶子结构在 normalizePieces / normalizePaint /
 * normalizeShape 三处。口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§9.2。
 */
import { TWIN_2D_MAX_PRIM_DEPTH } from './constants'
import {
  TWIN_2D_CURSORS,
  TWIN_2D_ICO_SRC_KINDS,
  TWIN_2D_POINTER_EVENTS,
  TWIN_2D_PRIM_KINDS,
  TWIN_2D_TEXT_ALIGNS,
  TWIN_2D_TEXT_BASELINES,
  TWIN_2D_TXT_SRC_KINDS,
  TWIN_2D_VEC_COORDS,
} from './kinds'
import { normalizeCondition } from './normalizeExprs'
import {
  colorOr,
  normalizeFills,
  normalizeGradients,
  normalizePaint,
  normalizeShadows,
  normalizeStrokes,
  unitOr,
} from './normalizePaint'
import {
  normalizeAnim,
  normalizeBorder,
  normalizeFont,
  normalizeIcoSrc,
  normalizeLayout,
  normalizeLineHeight,
  normalizeOutline,
  normalizePlacement,
  normalizeRadius,
  normalizeSize,
  normalizeTransition,
  normalizeTxtSrc,
  optionalLen,
} from './normalizePieces'
import { normalizeShape } from './normalizeShape'
import {
  boolOr,
  finiteOr,
  idOf,
  isRecord,
  oneOf,
  posDim,
  toArray,
  trimmedString,
  uniqueBy,
} from './sanitize'
import type { Twin2dPrimKind } from './kinds'
import type {
  Twin2dBoxPrim,
  Twin2dIcoPrim,
  Twin2dIcoSrc,
  Twin2dPrim,
  Twin2dPrimBase,
  Twin2dPrimPatch,
  Twin2dShape,
  Twin2dTxtPrim,
  Twin2dTxtSrc,
  Twin2dVecPrim,
} from './typesPrim'

export {
  colorOr,
  normalizeFills,
  normalizeGradients,
  normalizePaint,
  normalizeShadows,
  normalizeStops,
  normalizeStrokes,
  unitOr,
} from './normalizePaint'
export {
  normalizeAnim,
  normalizeBorder,
  normalizeDrawParts,
  normalizeFont,
  normalizeIcoSrc,
  normalizeLayout,
  normalizeLineHeight,
  normalizeOutline,
  normalizePad,
  normalizePlacement,
  normalizeRadius,
  normalizeSize,
  normalizeTransition,
  normalizeTxtSrc,
  optionalLen,
} from './normalizePieces'
export { normalizeShape } from './normalizeShape'

/** 变换基点缺省 */
const CENTER_ORIGIN = '50% 50%'

/** 几何取不出来时 vec 落回的整格矩形。 */
const UNIT_RECT: Twin2dShape = Object.freeze({
  kind: 'rect',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  rx: 0,
})

/** 变换基点：空串会让浏览器按 `50% 50%` 走，写死它省得两处口径不一致。 */
function originOr(value: unknown): string {
  const text = trimmedString(value)
  return text === '' ? CENTER_ORIGIN : text
}

/** 四种图元共有的十六项。 */
function normalizeBase(
  raw: Record<string, unknown>,
  id: string,
): Twin2dPrimBase {
  return {
    id,
    at: normalizePlacement(raw['at']),
    size: normalizeSize(raw['size']),
    minWidth: optionalLen(raw['minWidth']),
    maxWidth: optionalLen(raw['maxWidth']),
    z: finiteOr(raw['z'], 0),
    opacity: unitOr(raw['opacity'], 1),
    hidden: boolOr(raw['hidden'], false),
    when: normalizeCondition(raw['when']),
    anim: normalizeAnim(raw['anim']),
    transition: normalizeTransition(raw['transition']),
    rotate: finiteOr(raw['rotate'], 0),
    scale: posDim(raw['scale'], 1),
    transformOrigin: originOr(raw['transformOrigin']),
    pointerEvents: oneOf(raw['pointerEvents'], TWIN_2D_POINTER_EVENTS, 'auto'),
    keepUpright: boolOr(raw['keepUpright'], false),
  }
}

/** 盒：布局、多层填充、边框、圆角、阴影、裁剪与子树。 */
function boxPrim(
  base: Twin2dPrimBase,
  raw: Record<string, unknown>,
  depth: number,
): Twin2dBoxPrim {
  return {
    ...base,
    kind: 'box',
    layout: normalizeLayout(raw['layout']),
    fills: normalizeFills(raw['fills']),
    border: normalizeBorder(raw['border']),
    radius: normalizeRadius(raw['radius']),
    shadows: normalizeShadows(raw['shadows']),
    backdropBlur: Math.max(0, finiteOr(raw['backdropBlur'], 0)),
    clip: boolOr(raw['clip'], false),
    cursor: oneOf(raw['cursor'], TWIN_2D_CURSORS, 'default'),
    children: normalizePrims(raw['children'], depth + 1),
  }
}

/**
 * 矢量：一段几何、一个填充、多遍描边与局部渐变。
 * ⚠ 几何画不出来时落回整格矩形而不是丢掉整个图元：图元一丢，按它的 id 寻址的
 * 节点级覆盖与变体补丁就全部指向空处，而那三处都零报错。
 */
function vecPrim(
  base: Twin2dPrimBase,
  raw: Record<string, unknown>,
): Twin2dVecPrim {
  return {
    ...base,
    kind: 'vec',
    coord: oneOf(raw['coord'], TWIN_2D_VEC_COORDS, 'unit'),
    shape: normalizeShape(raw['shape']) ?? UNIT_RECT,
    fill: normalizePaint(raw['fill']),
    strokes: normalizeStrokes(raw['strokes']),
    gradients: normalizeGradients(raw['gradients']),
    stretch: boolOr(raw['stretch'], false),
  }
}

/** 图标：四来源加一个空档，外加一个只对单色 symbol 生效的颜色。 */
function icoPrim(
  base: Twin2dPrimBase,
  raw: Record<string, unknown>,
): Twin2dIcoPrim {
  return {
    ...base,
    kind: 'ico',
    src: normalizeIcoSrc(raw['src']),
    color: colorOr(raw['color']),
  }
}

/** 文本：五来源、字体、行高、对齐、省略与描边字。 */
function txtPrim(
  base: Twin2dPrimBase,
  raw: Record<string, unknown>,
): Twin2dTxtPrim {
  return {
    ...base,
    kind: 'txt',
    src: normalizeTxtSrc(raw['src']),
    font: normalizeFont(raw['font']),
    lineHeight: normalizeLineHeight(raw['lineHeight']),
    align: oneOf(raw['align'], TWIN_2D_TEXT_ALIGNS, 'start'),
    baseline: oneOf(raw['baseline'], TWIN_2D_TEXT_BASELINES, 'auto'),
    nowrap: boolOr(raw['nowrap'], false),
    ellipsis: boolOr(raw['ellipsis'], false),
    titleAttr: boolOr(raw['titleAttr'], false),
    shadows: normalizeShadows(raw['shadows']),
    outline: normalizeOutline(raw['outline']),
  }
}

/**
 * 一个图元。
 * ⚠ `kind` 认不出一律丢弃，不许静默降级成 `box`：降级出来的空盒会占住布局位置，
 * 而配置面上看它就是「配好了的那一件」。
 * ⚠ 缺 id 也丢弃：补一个 id 会让节点级覆盖补丁与变体补丁全都寻址不到它，
 * 表现是「补丁配了没反应」，三处都零报错。
 * @param raw 原始图元
 * @param depth 本图元所在的层深，根层是 0
 */
export function normalizePrim(raw: unknown, depth: number): Twin2dPrim | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw['id'])
  if (id === '') return null
  const kind = oneOf<Twin2dPrimKind | ''>(raw['kind'], TWIN_2D_PRIM_KINDS, '')
  if (kind === '') return null
  const base = normalizeBase(raw, id)
  switch (kind) {
    case 'box':
      return boxPrim(base, raw, depth)
    case 'vec':
      return vecPrim(base, raw)
    case 'ico':
      return icoPrim(base, raw)
    case 'txt':
      return txtPrim(base, raw)
  }
}

/**
 * 一层图元；同层内重复的 id 只留第一条。
 * ⚠ 到了深度上限一律归空数组而不是抛错：一棵一千层的树只会把浏览器摁死，
 * 归一化不是校验器，截断的那一刀由诊断面的 `prim-too-deep` 按**原始**下标报出来（§4.2）。
 * @param raw 原始图元数组
 * @param depth 这一层的层深，根层是 0
 */
export function normalizePrims(raw: unknown, depth: number): Twin2dPrim[] {
  if (depth >= TWIN_2D_MAX_PRIM_DEPTH) return []
  const prims: Twin2dPrim[] = []
  for (const item of toArray(raw)) {
    const prim = normalizePrim(item, depth)
    if (prim !== null) prims.push(prim)
  }
  return uniqueBy(prims, (prim) => prim.id)
}

/** 位姿与可见性那一组补丁键。 */
function applyGeometryPatch(
  raw: Record<string, unknown>,
  patch: Twin2dPrimPatch,
): void {
  if ('at' in raw) patch.at = normalizePlacement(raw['at'])
  if ('size' in raw) patch.size = normalizeSize(raw['size'])
  if ('minWidth' in raw) patch.minWidth = optionalLen(raw['minWidth'])
  if ('maxWidth' in raw) patch.maxWidth = optionalLen(raw['maxWidth'])
  if ('z' in raw) patch.z = finiteOr(raw['z'], 0)
  if ('opacity' in raw) patch.opacity = unitOr(raw['opacity'], 1)
  if ('rotate' in raw) patch.rotate = finiteOr(raw['rotate'], 0)
  // ⚠ 等比缩放走 posDim：0 会让整枝塌成一个点且一处都不报错，负数则连带镜像
  if ('scale' in raw) patch.scale = posDim(raw['scale'], 1)
  if ('hidden' in raw) patch.hidden = boolOr(raw['hidden'], false)
}

/** 条件、动效与指针那一组补丁键。 */
function applyBehaviorPatch(
  raw: Record<string, unknown>,
  patch: Twin2dPrimPatch,
): void {
  if ('when' in raw) patch.when = normalizeCondition(raw['when'])
  if ('anim' in raw) patch.anim = normalizeAnim(raw['anim'])
  if ('transition' in raw) {
    patch.transition = normalizeTransition(raw['transition'])
  }
  if ('transformOrigin' in raw) {
    patch.transformOrigin = originOr(raw['transformOrigin'])
  }
  if ('pointerEvents' in raw) {
    patch.pointerEvents = oneOf(
      raw['pointerEvents'],
      TWIN_2D_POINTER_EVENTS,
      'auto',
    )
  }
  if ('keepUpright' in raw) {
    patch.keepUpright = boolOr(raw['keepUpright'], false)
  }
}

/** 盒外观那一组补丁键。 */
function applyBoxPatch(
  raw: Record<string, unknown>,
  patch: Twin2dPrimPatch,
): void {
  if ('layout' in raw) patch.layout = normalizeLayout(raw['layout'])
  if ('fills' in raw) patch.fills = normalizeFills(raw['fills'])
  if ('border' in raw) patch.border = normalizeBorder(raw['border'])
  if ('radius' in raw) patch.radius = normalizeRadius(raw['radius'])
  if ('shadows' in raw) patch.shadows = normalizeShadows(raw['shadows'])
  if ('backdropBlur' in raw) {
    patch.backdropBlur = Math.max(0, finiteOr(raw['backdropBlur'], 0))
  }
  if ('clip' in raw) patch.clip = boolOr(raw['clip'], false)
  if ('cursor' in raw) {
    patch.cursor = oneOf(raw['cursor'], TWIN_2D_CURSORS, 'default')
  }
}

/** 矢量那一组补丁键；几何画不出来就当这一键没给过。 */
function applyVecPatch(
  raw: Record<string, unknown>,
  patch: Twin2dPrimPatch,
): void {
  if ('coord' in raw) {
    patch.coord = oneOf(raw['coord'], TWIN_2D_VEC_COORDS, 'unit')
  }
  if ('shape' in raw) {
    const shape = normalizeShape(raw['shape'])
    if (shape !== null) patch.shape = shape
  }
  if ('fill' in raw) patch.fill = normalizePaint(raw['fill'])
  if ('strokes' in raw) patch.strokes = normalizeStrokes(raw['strokes'])
  if ('gradients' in raw) patch.gradients = normalizeGradients(raw['gradients'])
  if ('stretch' in raw) patch.stretch = boolOr(raw['stretch'], false)
}

/**
 * 来源补丁：`ico` 与 `txt` 的 `src` 共用一个键。
 * ⚠ 补丁按图元 id 寻址，类型面上分不出补的是哪一种图元，只能按 `kind` 落在
 * 哪一张名单里判；两张名单没有重名的档，认不出就当这一键没给过。
 */
function patchSrc(raw: unknown): Twin2dIcoSrc | Twin2dTxtSrc | null {
  if (!isRecord(raw)) return null
  const kind = trimmedString(raw['kind'])
  if (TWIN_2D_TXT_SRC_KINDS.some((item) => item === kind)) {
    return normalizeTxtSrc(raw)
  }
  if (TWIN_2D_ICO_SRC_KINDS.some((item) => item === kind)) {
    return normalizeIcoSrc(raw)
  }
  return null
}

/** 来源、颜色与字体那一组补丁键。 */
function applyTextPatch(
  raw: Record<string, unknown>,
  patch: Twin2dPrimPatch,
): void {
  if ('src' in raw) {
    const src = patchSrc(raw['src'])
    if (src !== null) patch.src = src
  }
  if ('color' in raw) patch.color = colorOr(raw['color'])
  if ('font' in raw) patch.font = normalizeFont(raw['font'])
  if ('lineHeight' in raw) {
    patch.lineHeight = normalizeLineHeight(raw['lineHeight'])
  }
  if ('align' in raw) {
    patch.align = oneOf(raw['align'], TWIN_2D_TEXT_ALIGNS, 'start')
  }
  if ('baseline' in raw) {
    patch.baseline = oneOf(raw['baseline'], TWIN_2D_TEXT_BASELINES, 'auto')
  }
}

/** 文本排版开关那一组补丁键。 */
function applyTextFlagsPatch(
  raw: Record<string, unknown>,
  patch: Twin2dPrimPatch,
): void {
  if ('nowrap' in raw) patch.nowrap = boolOr(raw['nowrap'], false)
  if ('ellipsis' in raw) patch.ellipsis = boolOr(raw['ellipsis'], false)
  if ('titleAttr' in raw) patch.titleAttr = boolOr(raw['titleAttr'], false)
  if ('outline' in raw) patch.outline = normalizeOutline(raw['outline'])
}

/**
 * 图元的浅覆盖补丁：只收显式给出的键，缺席的键在合并时沿用原值。
 * ⚠ 缺席与「显式给了个空」是两回事，所以判的是键在不在，不是值合不合法；
 * 把缺席补成缺省值等于让每一条变体都把整份外观重写一遍（§9.2）。
 * ⚠ `id` / `kind` / `children` 刻意不可补丁：换 kind 会把渲染分支整条换掉，
 * 换 children 等于重建整棵子树，而变体产出补丁的全部理由就是不重建。
 * @param raw 原始补丁
 */
export function normalizePrimPatch(raw: unknown): Twin2dPrimPatch {
  const patch: Twin2dPrimPatch = {}
  if (!isRecord(raw)) return patch
  applyGeometryPatch(raw, patch)
  applyBehaviorPatch(raw, patch)
  applyBoxPatch(raw, patch)
  applyVecPatch(raw, patch)
  applyTextPatch(raw, patch)
  applyTextFlagsPatch(raw, patch)
  return patch
}
