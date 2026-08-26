/**
 * @fileoverview 两门闭合小语言的归一化：派生槽算式（七档算子、最多三层）与变体条件
 * （七档判据、`not` 可嵌套）。样式与节点两侧都用它们。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.5、§6.3 与 §9.5。
 */
import { TWIN_2D_MAX_EXPR_DEPTH, TWIN_2D_MAX_TAG_LENGTH } from './constants'
import {
  TWIN_2D_CONDITION_KINDS,
  TWIN_2D_EXPR_KINDS,
  TWIN_2D_FIELD_TESTS,
  TWIN_2D_HAS_MODES,
  TWIN_2D_NODE_FIELDS,
  TWIN_2D_STATES,
  TWIN_2D_STATUSES,
  TWIN_2D_THRESHOLD_OPS,
} from './kinds'
import {
  isRecord,
  oneOf,
  stringList,
  toArray,
  toFiniteNumber,
  trimmedString,
} from './sanitize'
import type {
  Twin2dConditionKind,
  Twin2dExprKind,
  Twin2dNodeField,
  Twin2dState,
  Twin2dThresholdOp,
} from './kinds'
import type { Twin2dCondition, Twin2dExpr } from './typesPrim'

/** `not` 的嵌套上限；再深的条件人读不懂，机器也只是白绕 */
const MAX_CONDITION_DEPTH = 4

function leafExpr(
  kind: 'slot' | 'lit',
  raw: Record<string, unknown>,
): Twin2dExpr | null {
  if (kind === 'slot') {
    const slot = trimmedString(raw.slot)
    return slot === '' ? null : { kind: 'slot', slot }
  }
  const value = raw.value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { kind: 'lit', value } : null
  }
  return typeof value === 'string' ? { kind: 'lit', value } : null
}

function listExpr(
  kind: 'first' | 'sum' | 'join',
  raw: Record<string, unknown>,
  depth: number,
): Twin2dExpr | null {
  const of: Twin2dExpr[] = []
  for (const item of toArray(raw.of)) {
    const operand = normalizeExpr(item, depth + 1)
    if (operand !== null) of.push(operand)
  }
  if (of.length === 0) return null
  if (kind === 'first') return { kind: 'first', of }
  if (kind === 'sum') return { kind: 'sum', of }
  // ⚠ sep 不 trim：分隔符里的空格是有意义的（`' · '`），trim 掉两个读数就贴在一起
  return { kind: 'join', of, sep: typeof raw.sep === 'string' ? raw.sep : '' }
}

function mathExpr(
  kind: 'ratio' | 'scale',
  raw: Record<string, unknown>,
  depth: number,
): Twin2dExpr | null {
  if (kind === 'scale') {
    const of = normalizeExpr(raw.of, depth + 1)
    return of === null
      ? null
      : { kind: 'scale', of, by: toFiniteNumber(raw.by) ?? 1 }
  }
  const num = normalizeExpr(raw.num, depth + 1)
  const den = normalizeExpr(raw.den, depth + 1)
  if (num === null || den === null) return null
  return { kind: 'ratio', num, den, scale: toFiniteNumber(raw.scale) ?? 1 }
}

/**
 * 派生槽算式：七档闭合算子，最多递归三层；超深、认不出的算子与缺操作数一律返回 null。
 * ⚠ 这是一门闭合小语言，不是表达式语言——真需要复杂计算走绑定的 `computed` 来源（§9.5）。
 * ⚠ 超深返回 null 而不是截断成半截式子：半截 `ratio` 会算出一个看着正常的错数，
 * 而 null 让这一槽降级成普通槽——绑点面板给普通槽一行，用户至少接得上（§9.5）。
 * @param raw 原始算式
 * @param depth 当前深度，从 0 起
 */
export function normalizeExpr(raw: unknown, depth = 0): Twin2dExpr | null {
  if (!isRecord(raw) || depth >= TWIN_2D_MAX_EXPR_DEPTH) return null
  const kind = oneOf<Twin2dExprKind | ''>(raw.kind, TWIN_2D_EXPR_KINDS, '')
  if (kind === '') return null
  if (kind === 'slot' || kind === 'lit') return leafExpr(kind, raw)
  if (kind === 'first' || kind === 'sum' || kind === 'join') {
    return listExpr(kind, raw, depth)
  }
  return mathExpr(kind, raw, depth)
}

function matchCondition(
  kind: 'state' | 'status' | 'tag',
  raw: Record<string, unknown>,
): Twin2dCondition | null {
  if (kind === 'state') {
    const state = oneOf<Twin2dState | ''>(raw.state, TWIN_2D_STATES, '')
    return state === '' ? null : { kind: 'state', state }
  }
  if (kind === 'status') {
    const wanted = new Set(stringList(raw.in))
    const inList = TWIN_2D_STATUSES.filter((status) => wanted.has(status))
    return inList.length === 0 ? null : { kind: 'status', in: inList }
  }
  // ⚠ tag 的键与值都是自由字符串，只 trim 与截断、不做白名单——做了白名单就等于
  //   把子类重新钉死成枚举，这一档就白加了（§6.3）
  const key = trimmedString(raw.key).slice(0, TWIN_2D_MAX_TAG_LENGTH)
  if (key === '') return null
  const values = stringList(raw.in).map((one) =>
    one.slice(0, TWIN_2D_MAX_TAG_LENGTH),
  )
  const inList = [...new Set(values)]
  return inList.length === 0 ? null : { kind: 'tag', key, in: inList }
}

/**
 * 节点字段条件：字段名不在白名单里整条丢弃；`in` 一档的空名单同样整条丢弃。
 * ⚠ `present` 一档不看 `in`：它判的是「这个字段有没有值」，硬要一份名单就等于
 * 让用户把角标可能的取值全枚举一遍（§7.7 #50）。
 */
function fieldCondition(raw: Record<string, unknown>): Twin2dCondition | null {
  const field = oneOf<Twin2dNodeField | ''>(raw.field, TWIN_2D_NODE_FIELDS, '')
  if (field === '') return null
  const test = oneOf(raw.test, TWIN_2D_FIELD_TESTS, 'in')
  if (test === 'present') return { kind: 'field', field, test, in: [] }
  const inList = stringList(raw.in)
  return inList.length === 0 ? null : { kind: 'field', field, test, in: inList }
}

function valueCondition(
  kind: 'slot' | 'has',
  raw: Record<string, unknown>,
): Twin2dCondition | null {
  if (kind === 'has') {
    const slots = stringList(raw.slots)
    if (slots.length === 0) return null
    const mode = oneOf(raw.mode, TWIN_2D_HAS_MODES, 'any')
    return { kind: 'has', slots, mode }
  }
  const slot = trimmedString(raw.slot)
  if (slot === '') return null
  // ⚠ 认不出的算子整条丢弃，不回落到某一档：悄悄换成 `eq` 会让同一条 `between`
  //   在阈值卡片上成立、在 2D 图上不成立（§4.5）
  const op = oneOf<Twin2dThresholdOp | ''>(raw.op, TWIN_2D_THRESHOLD_OPS, '')
  if (op === '') return null
  return {
    kind: 'slot',
    slot,
    op,
    value: toFiniteNumber(raw.value),
    value2: toFiniteNumber(raw.value2),
  }
}

function conditionAt(raw: unknown, depth: number): Twin2dCondition | null {
  if (!isRecord(raw) || depth > MAX_CONDITION_DEPTH) return null
  const kind = oneOf<Twin2dConditionKind | ''>(
    raw.kind,
    TWIN_2D_CONDITION_KINDS,
    '',
  )
  if (kind === '') return null
  if (kind === 'not') {
    const of = conditionAt(raw.of, depth + 1)
    return of === null ? null : { kind: 'not', of }
  }
  if (kind === 'state' || kind === 'status' || kind === 'tag') {
    return matchCondition(kind, raw)
  }
  if (kind === 'field') return fieldCondition(raw)
  return valueCondition(kind, raw)
}

/**
 * 一条变体条件；认不出的 kind、空取值集合与嵌套过深的 `not` 一律返回 null。
 * ⚠ 例外是 `field` 的 `present` 一档：它本来就不带取值集合（见 `fieldCondition`）。
 * ⚠ 返回 null 的条件会让整条变体被丢弃（见 `normalizeVariant`），不是「恒真」——
 * 一条恒真的变体会把外观钉死在那一档上，而它看起来像「样式本来就长这样」。
 * @param raw 原始条件
 */
export function normalizeCondition(raw: unknown): Twin2dCondition | null {
  return conditionAt(raw, 0)
}
