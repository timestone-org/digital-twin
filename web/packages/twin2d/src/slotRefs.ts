/**
 * @fileoverview 「一处配置引到了哪个槽键」这套遍历的唯一一份：图元的显示条件、`txt`
 * 的槽来源、变体条件、变体补丁与节点级补丁里的以上两处、派生槽的算式。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §14.2。
 *
 * ⚠ 诊断面、有效槽位筛选与预置库契约扫描三处**共用这一份**，不许各写各的：三份口径
 * 分叉的表现是「行照样有、值照样缝，但接错了对象」，零报错。
 * ⚠ 少扫一处 = 那个槽永远绑不上；多扫一处只是让它多留在行里。所以扫描面取并集。
 */
import { TWIN_2D_MAX_EXPR_DEPTH } from './constants'
import type {
  Twin2dCondition,
  Twin2dExpr,
  Twin2dPrim,
  Twin2dPrimPatch,
} from './typesPrim'
import type {
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dSlot,
  Twin2dVariant,
} from './types'

/** 一处槽引用：引到的键，与写着它的字段路径（相对作用域根）。 */
export interface Twin2dSlotRef {
  key: string
  at: string
}

/** 图元树上的一个位置：图元本身与它的字段路径。 */
export interface Twin2dPrimSite {
  prim: Twin2dPrim
  at: string
}

/**
 * 一处能写槽键的作用域：一棵图元树连同它的槽位、变体与节点级补丁。
 * ⚠ 样式与节点各是一个作用域而不是一个：两者的图元树挂在不同的字段名下，
 * 而字段路径要能照着找回文档里去。
 */
export interface Twin2dSlotScope {
  /** 图元树；样式给 `prims`，节点给 `layers`。 */
  prims: readonly Twin2dPrim[]
  /** 图元树的字段名，字段路径按它拼。 */
  primsField: 'prims' | 'layers'
  /** 带 `expr` 的槽位自己也是一处引用。 */
  slots: readonly Twin2dSlot[]
  variants: readonly Twin2dVariant[]
  /** 节点级覆盖补丁；样式那一层没有这个字段，给空表。 */
  patch: Readonly<Record<string, Twin2dPrimPatch>>
}

/**
 * 深度优先摊平图元树，`box` 连它自己一起带上。
 * @param prims 一棵图元树
 * @param at 这棵树在文档里的字段路径；不需要路径的调用方给空串
 */
export function twin2dWalkPrims(
  prims: readonly Twin2dPrim[],
  at: string,
): Twin2dPrimSite[] {
  return prims.flatMap((prim, index) => {
    const here = `${at}[${index}]`
    const site: Twin2dPrimSite = { prim, at: here }
    if (prim.kind !== 'box') return [site]
    return [site, ...twin2dWalkPrims(prim.children, `${here}.children`)]
  })
}

/**
 * 一条条件里引到的槽键；`not` 递归进去，`has` 一次带一串。
 * @param cond 显示条件或变体条件，缺席给 null / undefined
 * @param at 这条条件的字段路径
 */
function condRefs(
  cond: Twin2dCondition | null | undefined,
  at: string,
): Twin2dSlotRef[] {
  if (cond === null || cond === undefined) return []
  switch (cond.kind) {
    case 'slot':
      return [{ key: cond.slot, at: `${at}.slot` }]
    case 'has':
      return cond.slots.map((key, index) => ({
        key,
        at: `${at}.slots[${index}]`,
      }))
    case 'not':
      return condRefs(cond.of, `${at}.of`)
    default:
      return []
  }
}

/**
 * 一条派生算式里引到的槽键，按出现顺序，不去重。
 * ⚠ 与求值共用同一道深度上限：超深的枝永远求不出值，把它的槽键报成「被引用」会让
 * 绑点面板多出一行永远喂不到东西的槽。
 * @param expr 派生槽算式
 * @param at 这条算式的字段路径
 */
export function twin2dExprSlotRefs(
  expr: Twin2dExpr,
  at: string,
): Twin2dSlotRef[] {
  return exprRefsAt(expr, at, 0)
}

function exprRefsAt(
  expr: Twin2dExpr,
  at: string,
  depth: number,
): Twin2dSlotRef[] {
  if (depth >= TWIN_2D_MAX_EXPR_DEPTH) return []
  switch (expr.kind) {
    case 'slot':
      return [{ key: expr.slot, at: `${at}.slot` }]
    case 'ratio':
      return [
        ...exprRefsAt(expr.num, `${at}.num`, depth + 1),
        ...exprRefsAt(expr.den, `${at}.den`, depth + 1),
      ]
    case 'scale':
      return exprRefsAt(expr.of, `${at}.of`, depth + 1)
    case 'first':
    case 'sum':
    case 'join':
      return expr.of.flatMap((item, index) =>
        exprRefsAt(item, `${at}.of[${index}]`, depth + 1),
      )
    default:
      return []
  }
}

/**
 * 一枚图元自己引到的槽键：显示条件，加上 `txt` 的 `slot` 来源。
 * @param site 图元与它的字段路径
 */
function primRefs(site: Twin2dPrimSite): Twin2dSlotRef[] {
  const prim = site.prim
  const fromWhen = condRefs(prim.when, `${site.at}.when`)
  if (prim.kind !== 'txt' || prim.src.kind !== 'slot') return fromWhen
  return [...fromWhen, { key: prim.src.slot, at: `${site.at}.src.slot` }]
}

/**
 * 一条浅补丁引到的槽键：补出来的显示条件，加上补成 `slot` 档的文本来源。
 * @param patch 图元浅覆盖补丁
 * @param at 这条补丁的字段路径
 */
function patchRefs(patch: Twin2dPrimPatch, at: string): Twin2dSlotRef[] {
  const src = patch.src
  const fromWhen = condRefs(patch.when, `${at}.when`)
  if (src === undefined || src.kind !== 'slot') return fromWhen
  return [...fromWhen, { key: src.slot, at: `${at}.src.slot` }]
}

/**
 * 一张「图元 id → 补丁」表上引到的槽键。
 * @param table 变体补丁表或节点级覆盖补丁表
 * @param at 这张表的字段路径
 */
function tableRefs(
  table: Readonly<Record<string, Twin2dPrimPatch>>,
  at: string,
): Twin2dSlotRef[] {
  return Object.entries(table).flatMap(([primId, patch]) =>
    patchRefs(patch, `${at}.${primId}`),
  )
}

/**
 * 一个作用域上**静态可达**的全部槽引用，七处一处不少：`txt` 图元的 `slot` 来源、
 * 图元的 `when`、变体条件、变体补丁改出来的 `when` 与 `txt.src`、节点级补丁里的
 * 同两处、派生槽的 `expr`。
 *
 * ⚠ 运行期状态一律不参与：`hidden: true` 的图元、当下不满足的 `when`、当下没命中的
 * 变体，它们引到的槽全都算数。行号是与服务端的静态契约，让运行期状态影响行数等于
 * 「墙上的值一变，绑定就全体错位」。
 * ⚠ 派生槽按 `expr` 扫而不按 `kind`：归一化已把两者钉成一件事（`expr === null` ⟺
 * `'live'`），扫 `expr` 少一层假设。
 * @param scope 一棵图元树与它的槽位、变体、节点级补丁
 */
export function twin2dSlotRefs(scope: Twin2dSlotScope): Twin2dSlotRef[] {
  const sites = twin2dWalkPrims(scope.prims, scope.primsField)
  const fromExprs = scope.slots.flatMap((slot, index) =>
    slot.expr === null
      ? []
      : twin2dExprSlotRefs(slot.expr, `slots[${index}].expr`),
  )
  const fromVariants = scope.variants.flatMap((variant, index) => [
    ...condRefs(variant.when, `variants[${index}].when`),
    ...tableRefs(variant.patch, `variants[${index}].patch`),
  ])
  return [
    ...sites.flatMap((site) => primRefs(site)),
    ...fromExprs,
    ...fromVariants,
    ...tableRefs(scope.patch, 'patch'),
  ]
}

/**
 * 一个节点样式作为槽引用作用域：它没有节点级补丁那一层。
 * @param style 节点样式
 */
export function twin2dStyleScope(style: Twin2dNodeStyle): Twin2dSlotScope {
  return {
    prims: style.prims,
    primsField: 'prims',
    slots: style.slots,
    variants: style.variants,
    patch: {},
  }
}

/**
 * 一个节点作为槽引用作用域：图元树挂在 `layers` 上，变体归它引的样式。
 * @param node 节点实例
 */
export function twin2dNodeScope(node: Twin2dNode): Twin2dSlotScope {
  return {
    prims: node.layers,
    primsField: 'layers',
    slots: node.slots,
    variants: [],
    patch: node.patch,
  }
}
