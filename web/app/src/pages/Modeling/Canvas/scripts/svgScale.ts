/**
 * @fileoverview 画幅数学：一组值的上下界、值到 SVG 用户坐标的投影、一排刻度值。
 *
 * ⚠ 散点与直方各自抄过一份「全等值时人为撑开跨度」，抄漏一处就会除到 0：
 * 整张图的坐标一起变 NaN，浏览器把这些元素静默丢掉，控制台一个字都没有。
 */

/** 一根轴的上下界。 */
export interface Bounds {
  low: number
  high: number
}

// 一个有限值都没有时的兜底轴
const EMPTY: Bounds = { low: 0, high: 1 }

// 刻度根数上限，防止步长算歪时空转
const MAX_TICKS = 64

/** 好看的步长只从这三个档位里挑。 */
function stepScale(normalized: number): number {
  if (normalized > 5) return 10
  if (normalized > 2) return 5
  if (normalized > 1) return 2
  return 1
}

/**
 * 一组值的上下界；全等值时向两侧各撑开半个自身量级。
 *
 * ⚠ 撑开不是为了好看：跨度为 0 时 `project` 会除到 0。
 * Args: values（非有限值直接忽略）。
 */
export function bounds(values: readonly number[]): Bounds {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < low) low = value
    if (value > high) high = value
  }
  if (low > high) return EMPTY
  if (high > low) return { low, high }
  const reach = Math.abs(low) / 2 || 1
  return { low: low - reach, high: high + reach }
}

/**
 * 值 → SVG 用户坐标；跨度非正时一律落在画幅正中。
 *
 * Args: value、at（轴的上下界）、size（画幅边长）、pad（两端各留多少）。
 */
export function project(
  value: number,
  at: Bounds,
  size: number,
  pad: number,
): number {
  const span = at.high - at.low
  const reach = size - pad * 2
  if (!(span > 0)) return pad + reach / 2
  return pad + ((value - at.low) / span) * reach
}

/**
 * 落在 1/2/5×10ⁿ 上的一排刻度值，只给上下界之内的那些。
 *
 * ⚠ 步长比跨度还大时界内一根都排不下，此时给两端本身，不给空数组——
 * 空数组会让轴上一个数字都没有。
 * Args: at、count（想要几根，取整后会有出入）。
 */
export function niceTicks(at: Bounds, count: number): number[] {
  const span = at.high - at.low
  if (!(span > 0) || count < 1) return [at.low]
  const rough = span / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = stepScale(rough / magnitude) * magnitude
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  const first = Math.ceil(at.low / step) * step
  const ticks: number[] = []
  for (let index = 0; index < MAX_TICKS; index += 1) {
    const value = Number((first + index * step).toFixed(decimals)) + 0
    if (value > at.high) break
    ticks.push(value)
  }
  return ticks.length > 0 ? ticks : [at.low, at.high]
}
