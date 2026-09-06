/**
 * @fileoverview 结果视图里数字的写法。三个视图共用一份，免得同一个数在两处显示
 * 出不同的位数。
 */

/** 小数至少留这么多位有效数字。 */
const DIGITS = 4

/**
 * 比它还小的量改用指数记法。
 *
 * ⚠ 阈值就是 `DIGITS` 位有效数字在小数点后开始「全是零」的那一档：3e-5 按定点
 * 写出来是 `0.00003000`，一眼数不清几个零，读者会把它当成 0。
 */
const TINY = 1e-4

/**
 * 尾零剥掉，指数部分留着。
 *
 * ⚠ 只在有小数点时剥：`120` 这种整数串一剥就成了 `12`。
 * Args: text。
 */
function trimmed(text: string): string {
  const [mantissa = '', exponent] = text.split('e')
  const lean = mantissa.includes('.')
    ? mantissa.replace(/0+$/, '').replace(/\.$/, '')
    : mantissa
  return exponent === undefined ? lean : `${lean}e${exponent}`
}

/**
 * 至少四位有效数字，整数不补零，空值写成「—」而不是 0。
 *
 * ⚠ 小数点前一位都不截：`12345.678` 按四位有效数字是 `12350`，那是把一个精确的
 * 数改错了。所以只有 |值| < 1 才按有效数字收，其余按四位小数收。
 * Args: value。
 */
export function niceNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  if (Number.isInteger(value)) return String(value)
  const size = Math.abs(value)
  if (size < TINY) return trimmed(value.toExponential(DIGITS - 1))
  return trimmed(size < 1 ? value.toPrecision(DIGITS) : value.toFixed(DIGITS))
}

/** 小到一位小数写不出来的百分数，改写成「不到这么多」。 */
const PERCENT_FLOOR = 0.01

/**
 * 四舍五入把 99.99 推到 100 时退半格。
 *
 * ⚠ 「全部」与「几乎全部」是两回事：印成 100% 会被读成一行不剩。
 * Args: value 原值；text 已经定点化的写法。
 */
function capped(value: number, text: string): string {
  const shown = Number(text)
  if (Math.abs(value) >= 100 || Math.abs(shown) < 100) return text
  return value > 0 ? '99.9' : '-99.9'
}

/**
 * 百分数：整数不带小数点，一位小数封顶（不到 1 的给两位）。
 *
 * ⚠ 不走 `niceNumber`：那一档是系数与统计量的四位有效数字口径，套到百分数上
 * 会把 8/360 印成 2.2222%——那四位是假精度。
 * Args: value 已经乘过 100 的百分数值，不是 0–1 的比率。
 */
export function percentText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  if (value === 0) return '0%'
  const size = Math.abs(value)
  if (size < PERCENT_FLOOR) {
    return `${value > 0 ? '<' : '>-'}${PERCENT_FLOOR}%`
  }
  return `${capped(value, trimmed(value.toFixed(size < 1 ? 2 : 1)))}%`
}

/** 千分位。⚠ 不用 `toLocaleString`：CI 与开发机 locale 不同，会本地绿 CI 红。 */
export function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
