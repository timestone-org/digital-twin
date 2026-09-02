/**
 * @fileoverview 结果视图里数字的写法。三个视图共用一份，免得同一个数在两处显示
 * 出不同的位数。
 */

/** 保留四位有效小数，整数不补零。空值写成「—」而不是 0。 */
export function niceNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

/** 千分位。⚠ 不用 `toLocaleString`：CI 与开发机 locale 不同，会本地绿 CI 红。 */
export function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
