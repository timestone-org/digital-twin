/**
 * @fileoverview 标注（辅助框 / 辅助线 / 文字）实例的归一化。
 * 三档 kind 闭合，认不出就丢；描边随不随舞台缩放是显式开关。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.7 与 §7.10（#71–#74 的逐值缺省）。
 */
import {
  TWIN_2D_MARK_ALIGN_H,
  TWIN_2D_MARK_ALIGN_V,
  TWIN_2D_MARK_KINDS,
  TWIN_2D_MARK_LABEL_POSITIONS,
  TWIN_2D_MARK_Z_ORDERS,
} from './kinds'
import { normalizeFont } from './normalizePieces'
import {
  boolOr,
  clamp,
  finiteOr,
  idOf,
  isRecord,
  oneOf,
  posDim,
  toArray,
  trimmedString,
  uniqueBy,
} from './sanitize'
import type { Twin2dMarkKind } from './kinds'
import type { Twin2dMark } from './types'

/** 辅助框缺省宽 */
const DEFAULT_MARK_WIDTH = 120
/** 辅助框缺省高 */
const DEFAULT_MARK_HEIGHT = 80
/** 描边缺省线宽 */
const DEFAULT_STROKE_WIDTH = 2
/** 缺省不透明 */
const DEFAULT_OPACITY = 1

/** 闭合的三档 kind，认不出返回 null（调用方按「丢弃该条」处理）。 */
function markKindOf(value: unknown): Twin2dMarkKind | null {
  const found = TWIN_2D_MARK_KINDS.find((kind) => kind === value)
  return found === undefined ? null : found
}

/**
 * 归一化一条标注；id 缺失或 kind 不在三档内时返回 null。
 * `stroke` / `fill` 允许空串——空 = 由渲染层回退（描边落到 `--accent-primary`、
 * 填充落到 `none`），在这里补一个具体颜色等于把主题色写死进文档。
 * ⚠ `x2/y2` 的缺省是**起点自身**而不是 0：缺省 0 会让一条本该短短的辅助线
 * 横穿整张画布连到左上角原点，看起来像坐标算错了。
 * @param raw 原始标注
 */
export function normalizeMark(raw: unknown): Twin2dMark | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === '') return null
  const kind = markKindOf(raw.kind)
  if (kind === null) return null
  const x = finiteOr(raw.x, 0)
  const y = finiteOr(raw.y, 0)
  return {
    id,
    kind,
    x,
    y,
    w: posDim(raw.w, DEFAULT_MARK_WIDTH),
    h: posDim(raw.h, DEFAULT_MARK_HEIGHT),
    x2: finiteOr(raw.x2, x),
    y2: finiteOr(raw.y2, y),
    text: trimmedString(raw.text),
    font: normalizeFont(raw.font),
    labelPos: oneOf(raw.labelPos, TWIN_2D_MARK_LABEL_POSITIONS, 'top'),
    labelAlignH: oneOf(raw.labelAlignH, TWIN_2D_MARK_ALIGN_H, 'center'),
    labelAlignV: oneOf(raw.labelAlignV, TWIN_2D_MARK_ALIGN_V, 'top'),
    stroke: trimmedString(raw.stroke),
    fill: trimmedString(raw.fill),
    // 负线宽在 SVG 里是非法属性、会被整条忽略，先在这里压回 0
    strokeWidth: Math.max(0, finiteOr(raw.strokeWidth, DEFAULT_STROKE_WIDTH)),
    strokeDash: boolOr(raw.strokeDash, false),
    opacity: clamp(finiteOr(raw.opacity, DEFAULT_OPACITY), 0, 1),
    // 缺省沉到节点层之下，与运行态、编辑器两处同一份分层（§7.10 #74）
    zOrder: oneOf(raw.zOrder, TWIN_2D_MARK_Z_ORDERS, 'below'),
    nonScalingStroke: boolOr(raw.nonScalingStroke, false),
  }
}

/**
 * 归一化整份标注列表：丢弃脏条目，同 id 只留最先出现的一条。
 * @param raw 原始标注数组
 */
export function normalizeMarks(raw: unknown): Twin2dMark[] {
  const kept: Twin2dMark[] = []
  for (const item of toArray(raw)) {
    const mark = normalizeMark(item)
    if (mark !== null) kept.push(mark)
  }
  return uniqueBy(kept, (mark) => mark.id)
}
