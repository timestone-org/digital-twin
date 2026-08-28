/**
 * @fileoverview 派生槽算式的求值：七档闭合小语言按文档序取值，深度上限与归一化同为 3。
 * 归一化在 `normalizeExprs.ts`，这里只负责算，以及数出一条算式引用了哪些槽键。
 * `join` 拼出来的每一段过 `format.ts` 的 `formatSlotValue`——显示口径全仓只有那一份。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.5 与 §9.5。
 */
import { TWIN_2D_MAX_EXPR_DEPTH } from './constants'
import { formatSlotValue, isPresent } from './format'
import { trimmedString } from './sanitize'
import { twin2dExprSlotRefs } from './slotRefs'
import type { Twin2dSlotFormat } from './format'
import type { Twin2dExpr } from './typesPrim'

/** 算式的取值：一个有限数，或一段文本（`join` 与字符串字面量产出）。 */
export type Twin2dExprValue = number | string

/** 槽键 → 读数 */
export type Twin2dSlotValues = ReadonlyMap<string, unknown>

/** 槽键 → 显示口径；`join` 逐段拿它出单位与精度。整个 `Twin2dSlot` 表也能直接喂进来。 */
export type Twin2dSlotFormats = ReadonlyMap<string, Twin2dSlotFormat>

/** 一次求值用得到的两张表：读数与显示口径。 */
interface EvalScope {
  values: Twin2dSlotValues
  formats: Twin2dSlotFormats
}

// ⚠ 非有限数一律降为无值：让 Infinity 流下去，墙上会出现一个「∞」而每一层都不报错
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

// 四则运算只吃数字项，文本项当无值
function numberOf(value: Twin2dExprValue | null): number | null {
  return typeof value === 'number' ? value : null
}

// ⚠ 显式 0 是有值：0 kWh 与「这个槽没绑上」是两回事，混成一档会让停机的设备
//   与没接线的设备在墙上长得一样
// ⚠ 数字直取、字符串**保持为文本**，不做 `'60'` → 60 的转数：这条链路上的值是实时点位
//   读数，带引号的数字是脏数据不是笔误（`@dt/modules` 的 `shared/config` 同款分工）；
//   显示、变体命中、派生求值三处共用 `format.ts` 的 `isPresent` 这一把尺
function slotValue(raw: unknown): Twin2dExprValue | null {
  if (isPresent(raw)) return raw
  const text = trimmedString(raw)
  return text === '' ? null : text
}

// 字面量：非有限数当无值，空串是作者写死的取值、照旧算有值
function litValue(value: number | string): Twin2dExprValue | null {
  if (typeof value === 'number') return finiteOrNull(value)
  return value
}

// ⚠ 三级兜底链只认「有没有值」，不认大小：第一个非 null 的赢，哪怕它是 0
function firstValue(
  of: readonly Twin2dExpr[],
  scope: EvalScope,
  depth: number,
): Twin2dExprValue | null {
  for (const item of of) {
    const value = evalAt(item, scope, depth + 1)
    if (value !== null) return value
  }
  return null
}

// ⚠ 缺一项就整式为空：三路总管缺一路时给两路之和，那个数会被当成总量读走，
//   而画面上没有任何迹象说明它少了一路
function sumValue(
  of: readonly Twin2dExpr[],
  scope: EvalScope,
  depth: number,
): number | null {
  if (of.length === 0) return null
  let total = 0
  for (const item of of) {
    const num = numberOf(evalAt(item, scope, depth + 1))
    if (num === null) return null
    total += num
  }
  return finiteOrNull(total)
}

function ratioValue(
  expr: Extract<Twin2dExpr, { kind: 'ratio' }>,
  scope: EvalScope,
  depth: number,
): number | null {
  const den = numberOf(evalAt(expr.den, scope, depth + 1))
  // ⚠ 分母 0 给 0% 会让「没在跑」和「效率为零」在墙上长得一样；负分母同理，
  //   本档的分母是投入量，负数只可能是坏数据。⚠ 这里不必再判非有限：每一档都只
  //   产出有限数，非有限的在源头就降成了 null
  if (den === null || den <= 0) return null
  const num = numberOf(evalAt(expr.num, scope, depth + 1))
  if (num === null) return null
  return finiteOrNull((num / den) * expr.scale)
}

function scaleValue(
  expr: Extract<Twin2dExpr, { kind: 'scale' }>,
  scope: EvalScope,
  depth: number,
): number | null {
  const num = numberOf(evalAt(expr.of, scope, depth + 1))
  return num === null ? null : finiteOrNull(num * expr.by)
}

/**
 * 拼进一行里的一段文本：写在 `join` 里的 `slot` 一档过**那个槽位自己的口径**
 * （映射表、格式档、精度、单位），其余档直拼。
 * ⚠ 与那个槽独立成一格时**同一种写法**：单位紧贴与否归 `format.ts` 的 `withUnit`
 *   按单位分档，这里不另开一档——同一个数在读数行与悬浮卡里长得不一样，看着就像
 *   两处各自格式化的。
 * ⚠ 口径只认**直接写在 `join` 里**的那一档 `slot`：`first` / `ratio` / `scale`
 *   算出来的是个没有槽位身份的中间值，照旧直拼。要给它带单位就把它自己立成一个
 *   带单位的派生槽（`nodesSource.ts` 的 `output` / `output_total` 就是这么分的）。
 * ⚠ 槽位表里查不到这个键时直拼：那是一处悬空引用，`issues.ts` 出诊断，不在这里
 *   编一份缺省口径出来。
 * @param item 这一段的算式
 * @param value 这一段已经求出来的值
 * @param formats 槽键到显示口径
 */
function partText(
  item: Twin2dExpr,
  value: Twin2dExprValue,
  formats: Twin2dSlotFormats,
): string {
  if (item.kind !== 'slot') return String(value)
  const format = formats.get(item.slot)
  if (format === undefined) return String(value)
  return formatSlotValue(value, format)
}

// ⚠ 一项都拼不出时给 null 而不是空串：空串会让那一格变成一片空白，
//   而占位符「—」才说得清「这里本该有个读数」
function joinValue(
  expr: Extract<Twin2dExpr, { kind: 'join' }>,
  scope: EvalScope,
  depth: number,
): string | null {
  const parts: string[] = []
  for (const item of expr.of) {
    const value = evalAt(item, scope, depth + 1)
    if (value !== null) parts.push(partText(item, value, scope.formats))
  }
  return parts.length === 0 ? null : parts.join(expr.sep)
}

function evalAt(
  expr: Twin2dExpr,
  scope: EvalScope,
  depth: number,
): Twin2dExprValue | null {
  // ⚠ 超深整枝返回 null 而不是接着递归：归一化挡住的只是落库那一份，预置库与
  //   编辑器内存里的算式都是直接喂进来的，没有这道闸就是一条栈溢出的路
  if (depth >= TWIN_2D_MAX_EXPR_DEPTH) return null
  switch (expr.kind) {
    case 'slot':
      return slotValue(scope.values.get(expr.slot))
    case 'lit':
      return litValue(expr.value)
    case 'first':
      return firstValue(expr.of, scope, depth)
    case 'sum':
      return sumValue(expr.of, scope, depth)
    case 'ratio':
      return ratioValue(expr, scope, depth)
    case 'scale':
      return scaleValue(expr, scope, depth)
    default:
      return joinValue(expr, scope, depth)
  }
}

/**
 * 求一条派生槽算式的值；取不到一律给 null，占位符由渲染层出。
 * @param expr 派生槽算式，取归一化之后的那一份
 * @param values 槽键到读数的映射。⚠ 用 Map 不用普通对象：对象上 `constructor`
 *   这类键会取到原型链上的函数，于是一个从没绑过的槽突然「有值」了
 * @param formats 槽键到显示口径，只有 `join` 用得上（见 `partText`）。⚠ 它是必填的：
 *   给成可省的话，忘了传的那一处会安安静静地拼出一串没有单位、没有小数位的裸数
 */
export function evalExpr(
  expr: Twin2dExpr,
  values: Twin2dSlotValues,
  formats: Twin2dSlotFormats,
): Twin2dExprValue | null {
  return evalAt(expr, { values, formats }, 0)
}

/**
 * 一条算式引用到的槽键，按首次出现去重。
 * ⚠ 遍历本身归 `slotRefs.ts`——「哪些地方能写槽键」全仓只许有一份口径（§14.2）。
 * 那一份与这里的求值共用同一道深度上限：超深的枝永远求不出值，把它的槽键报成
 * 「被引用」会让绑点面板多出一行永远喂不到东西的槽。
 * @param expr 派生槽算式
 */
export function exprSlotRefs(expr: Twin2dExpr): string[] {
  return [...new Set(twin2dExprSlotRefs(expr, '').map((ref) => ref.key))]
}
