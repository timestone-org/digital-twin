/**
 * @fileoverview 2D 孪生读数格式化：与 `@dt/modules/shared/format` 同名同签名的第二份副本，
 * 外加按槽位 `format`/`precision`/`unit`/`enumMap` 出显示串的 `formatSlotValue`。本包不许依赖
 * `@dt/modules`（方向反了）而调用点在图元渲染最深处（一个 `txt` 读一个槽），提到
 * `Component.vue` 去做不现实，故照抄一份，两份不漂由行为对齐契约守（§11.3）。
 */
import type { Twin2dSlot } from './types'

/** 无数据占位符，全平台统一。 */
export const NO_DATA = '—'

// Intl 与 toFixed 只接受 [0, 100] 的小数位，越界直接抛 RangeError
const MIN_DIGITS = 0
const MAX_DIGITS = 100
// 压缩到「k」的门槛
const KILO = 1000
// 值与单位之间的分隔
const UNIT_GAP = ' '
// kwhShort 档压缩后保留几位小数（§7 #93）
const KWH_SHORT_DIGITS = 2
// grouped 档不留小数：先四舍五入到整数再加千分位（§7 #94）
const GROUPED_DIGITS = 0
// trim2 档最多两位、去尾随零（§7 #95）
const TRIM_DIGITS = 2

/**
 * ⚠ 钉死的显示 locale：自托管 runner 是中文 locale、开发机是 en-US，不钉的
 * `toLocaleString` 本地绿、CI 红，而红出来的报错跟格式化毫无关系。
 */
const LOCALE = 'en-US'

/** 格式化只用到槽位的这五个字段，整个 `Twin2dSlot` 也能直接喂进来。 */
export type Twin2dSlotFormat = Pick<
  Twin2dSlot,
  'precision' | 'unit' | 'enumMap' | 'placeholder' | 'format'
>

/**
 * 是不是一个能拿来显示的有限数。真实 0 算，NaN / ±Infinity / null 都不算。
 * @param raw 待判定的原值
 */
export function isPresent(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw)
}

/**
 * 小数位钳到合法区间。
 * ⚠ 位数是配置驱动的，用户填个负数或 200 都合法地存得下来，不钳就是运行时抛错。
 * @param digits 配置里来的小数位
 * @param fallback 非有限数时的回退
 */
function clampDigits(digits: number, fallback: number): number {
  return Number.isFinite(digits)
    ? Math.min(MAX_DIGITS, Math.max(MIN_DIGITS, digits))
    : fallback
}

/**
 * 定点小数，缺值给「—」。
 * @param raw 待格式化的原值
 * @param digits 小数位
 */
export function fmtFixed(raw: unknown, digits = 0): string {
  return isPresent(raw) ? raw.toFixed(clampDigits(digits, 0)) : NO_DATA
}

/** ⚠ -0 归一成 0：不归一的话大屏上会显出「-0」，看着像个坏值。 */
function unsignZero(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * 千分位数值，缺值给「—」。
 * @param raw 待格式化的原值
 * @param precision 最多几位小数，≤0 时先四舍五入到整数
 */
export function fmtNumber(raw: unknown, precision = 2): string {
  if (!isPresent(raw)) return NO_DATA
  const value = unsignZero(raw)
  const digits = clampDigits(precision, 2)
  return digits <= 0
    ? Math.round(value).toLocaleString(LOCALE)
    : value.toLocaleString(LOCALE, { maximumFractionDigits: digits })
}

/**
 * 去尾随零、不带千分位的数值，缺值给「—」。坐标与轴标签用这一档。
 * @param raw 待格式化的原值
 * @param max 最多几位小数
 */
export function fmtTrim(raw: unknown, max = 2): string {
  if (!isPresent(raw)) return NO_DATA
  return unsignZero(raw).toLocaleString(LOCALE, {
    maximumFractionDigits: clampDigits(max, 2),
    useGrouping: false,
  })
}

/**
 * 电量读数：绝对值取整后 ≥1000 压成「x.xxk」，否则显整数，缺值给「—」。
 * ⚠ 判档用的是**取整后**的绝对值：999.6 与 1000 因此同显「1k」，
 * 否则同一屏上会并排出现「1000」和「1k」两种写法。
 * @param raw 待格式化的原值
 * @param precision 压缩档保留几位小数
 */
export function fmtKwh(raw: unknown, precision = 2): string {
  if (!isPresent(raw)) return NO_DATA
  const sign = raw < 0 ? '-' : ''
  const abs = Math.abs(raw)
  return Math.round(abs) >= KILO
    ? `${sign}${fmtTrim(abs / KILO, precision)}k`
    : `${sign}${fmtTrim(abs, 0)}`
}

/**
 * 定点小数，位数固定；`grouping` 决定要不要千分位。缺值给「—」。
 * ⚠ 与 `fmtNumber` 的分工是刻意的：那一档是「最多几位」，尾随零会被抹掉，
 * 于是同一列里 63.40 与 63.4 并排出现，看着像两个精度不同的表。仪表读数要的是
 * 逐行对齐，故这一档补零。
 * @param raw 待格式化的原值
 * @param digits 小数位
 * @param grouping 整数部分要不要千分位
 */
export function fmtDecimal(raw: unknown, digits = 1, grouping = false): string {
  if (!isPresent(raw)) return NO_DATA
  const fixed = clampDigits(digits, 1)
  return unsignZero(raw).toLocaleString(LOCALE, {
    minimumFractionDigits: fixed,
    maximumFractionDigits: fixed,
    useGrouping: grouping,
  })
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 采样时刻 → 本地时的 `HH:mm:ss`，缺值给「—」。
 * ⚠ 到**秒**而不是到分：本仓的点位周期低到 10 秒，按分钟显示时「还在动」与
 * 「一分钟前就停了」是同一个字样，而这一列存在的全部意义就是分开这两件事。
 * ⚠ 只格式化、不判新旧：值有多旧由看的人决定，不在这里降档。
 * @param epochMs 采样时刻，UTC 毫秒
 */
export function fmtClock(epochMs: unknown): string {
  if (!isPresent(epochMs)) return NO_DATA
  const at = new Date(epochMs)
  if (Number.isNaN(at.getTime())) return NO_DATA
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`
}

/**
 * 查槽位的展示映射表；查不到给 null。
 * ⚠ 键一律走 `String(value)`：JSON 的键永远是字符串，拿数值原样去索引会静默查不到。
 * @param value 原始读数
 * @param enumMap 槽位上的展示映射表
 */
function enumText(
  value: unknown,
  enumMap: Record<string, string>,
): string | null {
  const kind = typeof value
  if (kind !== 'number' && kind !== 'string' && kind !== 'boolean') return null
  const hit = enumMap[String(value)]
  return hit === undefined || hit === '' ? null : hit
}

/**
 * `auto` 一档的数值串。
 * ⚠ `precision === null` 时整数直出、小数走 `fmtTrim(v, 1)`：与 `toFixed(1)` 的差别是
 * **尾随零**（63.40 → 63.4），这是本仓口径（§7 #91）。
 * @param value 有限数
 * @param precision 槽位精度，null = 整数直出
 */
function autoText(value: number, precision: number | null): string {
  if (precision !== null) return fmtFixed(value, precision)
  return Number.isInteger(value) ? String(unsignZero(value)) : fmtTrim(value, 1)
}

/**
 * 按槽位的格式档挑格式化器，`precision` 是喂给它的位数。
 * ⚠ 三个非缺省档各有自己的缺省位数，与函数签名上的缺省**刻意不同**：压缩档 2
 * （§7 #93）、千分位档 0（#94）、去尾随零档 2（#95）。凑成一个统一值不会报错，
 * 只是墙上的小数位换了一档。
 * @param value 有限数
 * @param slot 槽位的格式档与精度
 */
function numberText(value: number, slot: Twin2dSlotFormat): string {
  switch (slot.format) {
    case 'kwhShort':
      return fmtKwh(value, slot.precision ?? KWH_SHORT_DIGITS)
    case 'grouped':
      return fmtNumber(value, slot.precision ?? GROUPED_DIGITS)
    case 'trim2':
      return fmtTrim(value, slot.precision ?? TRIM_DIGITS)
    case 'auto':
      return autoText(value, slot.precision)
  }
}

/**
 * 值后面拼单位，空单位不留空格。
 * @param text 已格式化的值
 * @param unit 单位
 */
function withUnit(text: string, unit: string): string {
  return unit === '' ? text : `${text}${UNIT_GAP}${unit}`
}

/**
 * 一个槽位的最终显示串：映射表优先，其次数值按精度 + 单位，取不到值给槽位占位符。
 * ⚠ 布尔与对象类的值在没有 `enumMap` 时落占位符——凭空把 `true` 显成「1」会让
 * 「通电」与「读数 1」在图上长得一模一样。
 * @param value 原始读数
 * @param slot 槽位上的格式档、精度、单位、映射表与占位符
 */
export function formatSlotValue(
  value: unknown,
  slot: Twin2dSlotFormat,
): string {
  const mapped = enumText(value, slot.enumMap)
  if (mapped !== null) return mapped
  if (isPresent(value)) {
    return withUnit(numberText(value, slot), slot.unit)
  }
  const text = typeof value === 'string' ? value.trim() : ''
  if (text !== '') return withUnit(text, slot.unit)
  return slot.placeholder === '' ? NO_DATA : slot.placeholder
}
