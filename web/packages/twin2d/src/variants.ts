/**
 * @fileoverview 变体求值：六档条件的判定、按文档序挑出命中的变体，以及把它们的补丁
 * 浅合并进图元树。产出的是**补丁**不是新树——没被补丁碰到的图元返回原引用（§9.2）。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.5、§6.3、§9.2、§9.3。
 */
import { isPresent } from './format'
import { TWIN_2D_TXT_SRC_KINDS } from './kinds'
import { trimmedString } from './sanitize'
import type { Twin2dSlotValues } from './expr'
import type {
  Twin2dHasMode,
  Twin2dState,
  Twin2dStatus,
  Twin2dThresholdOp,
} from './kinds'
import type { Twin2dVariant } from './types'
import type {
  Twin2dBoxPrim,
  Twin2dCondition,
  Twin2dIcoPrim,
  Twin2dIcoSrc,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dRootPatch,
  Twin2dTxtPrim,
  Twin2dTxtSrc,
  Twin2dVecPrim,
} from './typesPrim'

/** 六档条件各自要读的那一份。 */
export interface Twin2dVariantCtx {
  /**
   * 当前打开的交互态。
   * ⚠ `hover` 由节点根上一对 `@mouseenter` / `@mouseleave` 置的本地 ref 喂进来，
   * 不是 CSS 伪类、也不装监听器：伪类进不了内联补丁，手装的监听器要自己清理，
   * 全局命中测试在旋转过的盒上既慢又不准（§9.3）。
   */
  states: ReadonlySet<Twin2dState>
  /** 已解析的节点状态；null = 这个节点不画状态。 */
  status: Twin2dStatus | null
  /**
   * 节点上的自由标签，子类靠它（§6.3）。
   * ⚠ 用 Map 不用普通对象：`constructor` 这类键在对象上会取到原型链上的东西。
   */
  tags: ReadonlyMap<string, string>
  /** 槽键到读数，与派生槽求值共用同一份。 */
  slots: Twin2dSlotValues
}

/** 变体应用之后的图元树与节点根覆盖。 */
export interface Twin2dVariantResult {
  prims: readonly Twin2dPrim[]
  root: Twin2dRootPatch
}

/** 只比一个界的那六档 */
const COMPARATORS: Partial<
  Record<Twin2dThresholdOp, (value: number, bound: number) => boolean>
> = {
  lt: (value, bound) => value < bound,
  lte: (value, bound) => value <= bound,
  gt: (value, bound) => value > bound,
  gte: (value, bound) => value >= bound,
  eq: (value, bound) => value === bound,
  neq: (value, bound) => value !== bound,
}

/** 文本来源的四个 kind 名 */
const TXT_SRC_KINDS: ReadonlySet<string> = new Set<string>(
  TWIN_2D_TXT_SRC_KINDS,
)

type SlotCondition = Extract<Twin2dCondition, { kind: 'slot' }>

// ⚠ 阈值缺省与区间缺上界一律判不中，与 @dt/modules 的 `shared/thresholds` 同义：
//   拿单值当区间比会让「10 到 20 报警」变成「≥10 就报警」
// ⚠ 只认真正的有限数，`'60'` 这样的数字字符串一律不参与比较：这条链路上的值是实时
//   点位读数，带引号的数字是脏数据不是笔误。认了的话它会让 `>40` 的变体命中，而墙上
//   那一格显示的却是未经格式化的原样文本（`format.ts` 的 `isPresent` 是同一把尺）
function matchSlot(cond: SlotCondition, values: Twin2dSlotValues): boolean {
  const value = values.get(cond.slot)
  if (!isPresent(value) || cond.value === null) return false
  const compare = COMPARATORS[cond.op]
  if (compare !== undefined) return compare(value, cond.value)
  if (cond.value2 === null) return false
  const low = Math.min(cond.value, cond.value2)
  const high = Math.max(cond.value, cond.value2)
  return cond.op === 'between'
    ? value >= low && value <= high
    : value < low || value > high
}

// ⚠ 显式 0 是有值：0 kWh 与「这个槽没绑上」是两回事，混成一档会让停机的设备
//   与没接线的设备在墙上长得一样。数字与非空文本各算一档，判「有没有」用不着转数
function hasSlotValue(raw: unknown): boolean {
  return isPresent(raw) || trimmedString(raw) !== ''
}

function matchHas(
  slots: readonly string[],
  mode: Twin2dHasMode,
  values: Twin2dSlotValues,
): boolean {
  const present = (key: string): boolean => hasSlotValue(values.get(key))
  return mode === 'all' ? slots.every(present) : slots.some(present)
}

function matchTag(
  key: string,
  wanted: readonly string[],
  tags: ReadonlyMap<string, string>,
): boolean {
  const value = tags.get(key)
  return value !== undefined && wanted.includes(value)
}

/**
 * 一条变体条件成不成立。
 * @param cond 已归一化的条件
 * @param ctx 求值上下文
 */
export function evalCondition(
  cond: Twin2dCondition,
  ctx: Twin2dVariantCtx,
): boolean {
  switch (cond.kind) {
    case 'state':
      return ctx.states.has(cond.state)
    case 'status':
      return ctx.status !== null && cond.in.includes(ctx.status)
    case 'tag':
      return matchTag(cond.key, cond.in, ctx.tags)
    case 'slot':
      return matchSlot(cond, ctx.slots)
    case 'has':
      return matchHas(cond.slots, cond.mode, ctx.slots)
    case 'not':
      return !evalCondition(cond.of, ctx)
  }
}

/**
 * 命中的变体，**保持文档序**。
 * ⚠ 顺序就是覆盖顺序，重排即改渲染结果（§4.5）。
 * @param variants 该样式的变体表，取文档序
 * @param ctx 求值上下文
 */
export function activeVariants(
  variants: readonly Twin2dVariant[],
  ctx: Twin2dVariantCtx,
): Twin2dVariant[] {
  return variants.filter((variant) => evalCondition(variant.when, ctx))
}

/** 四种图元共有的可补丁键 */
const BASE_KEYS = [
  'at',
  'size',
  'minWidth',
  'maxWidth',
  'z',
  'opacity',
  'hidden',
  'when',
  'anim',
  'transition',
  'rotate',
  'scale',
  'transformOrigin',
  'pointerEvents',
  'keepUpright',
] as const

/** box 独有的可补丁键 */
const BOX_KEYS = [
  'layout',
  'fills',
  'border',
  'radius',
  'shadows',
  'backdropBlur',
  'clip',
  'cursor',
] as const

/** vec 独有的可补丁键 */
const VEC_KEYS = [
  'coord',
  'shape',
  'fill',
  'strokes',
  'gradients',
  'stretch',
] as const

/** ico 独有的可补丁键（`src` 另判） */
const ICO_KEYS = ['color'] as const

/** txt 独有的可补丁键（`src` 另判） */
const TXT_KEYS = [
  'font',
  'align',
  'baseline',
  'nowrap',
  'ellipsis',
  'titleAttr',
  'shadows',
  'outline',
] as const

// 只搬这些键里显式给出的那几个：浅合并的全部含义就是「没列出的原样保留」
function pickKeys<K extends keyof Twin2dPrimPatch>(
  patch: Twin2dPrimPatch,
  keys: readonly K[],
): Partial<Pick<Twin2dPrimPatch, K>> {
  const picked: Partial<Pick<Twin2dPrimPatch, K>> = {}
  for (const key of keys) {
    const value = patch[key]
    if (value !== undefined) picked[key] = value
  }
  return picked
}

// ⚠ ico 与 txt 的来源两族 kind 名互不相交，所以只看 kind 名就分得开；
//   补丁按图元 id 寻址，类型面上分不出寻的是哪一种图元
function isTxtSrc(src: Twin2dIcoSrc | Twin2dTxtSrc): src is Twin2dTxtSrc {
  return TXT_SRC_KINDS.has(src.kind)
}

// 喂错族的来源静默跳过：换了 kind 就等于换渲染分支，那是补丁不许做的事
function icoSrcPatch(patch: Twin2dPrimPatch): { src?: Twin2dIcoSrc } {
  const src = patch.src
  if (src === undefined || isTxtSrc(src)) return {}
  return { src }
}

function txtSrcPatch(patch: Twin2dPrimPatch): { src?: Twin2dTxtSrc } {
  const src = patch.src
  if (src === undefined || !isTxtSrc(src)) return {}
  return { src }
}

function patchedBox(
  prim: Twin2dBoxPrim,
  patch: Twin2dPrimPatch,
): Twin2dBoxPrim {
  return {
    ...prim,
    ...pickKeys(patch, BASE_KEYS),
    ...pickKeys(patch, BOX_KEYS),
  }
}

function patchedLeaf(
  prim: Twin2dVecPrim | Twin2dIcoPrim | Twin2dTxtPrim,
  patch: Twin2dPrimPatch,
): Twin2dPrim {
  const base = pickKeys(patch, BASE_KEYS)
  switch (prim.kind) {
    case 'vec':
      return { ...prim, ...base, ...pickKeys(patch, VEC_KEYS) }
    case 'ico':
      return {
        ...prim,
        ...base,
        ...pickKeys(patch, ICO_KEYS),
        ...icoSrcPatch(patch),
      }
    case 'txt':
      return {
        ...prim,
        ...base,
        ...pickKeys(patch, TXT_KEYS),
        ...txtSrcPatch(patch),
      }
  }
}

// ⚠ 只有真被改到的那一枝换引用：整树重建会让每一帧都换掉所有子组件的 props，
//   hover 一个节点就重绘整张图（§9.2）
function patchedNode(
  prim: Twin2dPrim,
  patches: ReadonlyMap<string, Twin2dPrimPatch>,
): Twin2dPrim {
  const patch = patches.get(prim.id)
  if (prim.kind !== 'box') {
    return patch === undefined ? prim : patchedLeaf(prim, patch)
  }
  const children = patchedTree(prim.children, patches)
  const self = patch === undefined ? prim : patchedBox(prim, patch)
  return children === prim.children ? self : { ...self, children }
}

function patchedTree(
  prims: readonly Twin2dPrim[],
  patches: ReadonlyMap<string, Twin2dPrimPatch>,
): readonly Twin2dPrim[] {
  let changed = false
  const next = prims.map((prim) => {
    const one = patchedNode(prim, patches)
    if (one !== prim) changed = true
    return one
  })
  return changed ? next : prims
}

// ⚠ 文档序在后的赢：反过来的表现是「配了两个变体，其中一个永远不生效」（§4.5）
function mergedPatches(
  hits: readonly Twin2dVariant[],
): ReadonlyMap<string, Twin2dPrimPatch> {
  const merged = new Map<string, Twin2dPrimPatch>()
  for (const variant of hits) {
    for (const [primId, patch] of Object.entries(variant.patch)) {
      const prev = merged.get(primId)
      merged.set(primId, prev === undefined ? patch : { ...prev, ...patch })
    }
  }
  return merged
}

function mergedRoot(hits: readonly Twin2dVariant[]): Twin2dRootPatch {
  let root: Twin2dRootPatch = {}
  for (const variant of hits) root = { ...root, ...variant.rootPatch }
  return root
}

/**
 * 把命中变体的补丁浅合并进图元树，另出一份节点根覆盖。
 * ⚠ 补丁按图元 id 寻址、只覆盖列出的键；指向不存在的 id 静默跳过（诊断归 issues.ts）。
 * @param prims 已并过节点级 `patch` / `layers` 的图元树
 * @param variants 该样式的变体表，取文档序
 * @param ctx 求值上下文
 */
export function applyVariants(
  prims: readonly Twin2dPrim[],
  variants: readonly Twin2dVariant[],
  ctx: Twin2dVariantCtx,
): Twin2dVariantResult {
  const hits = activeVariants(variants, ctx)
  return {
    prims: patchedTree(prims, mergedPatches(hits)),
    root: mergedRoot(hits),
  }
}
