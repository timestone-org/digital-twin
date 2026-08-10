/**
 * @fileoverview token 的运行时读取面。样式一律走 CSS 变量，这里只给需要
 * 拿到具体数值的场景（画布、图表）用。
 */

/** 控件尺寸轴的像素值，与 tokens.css 的 --ctl-h-* 同源。 */
export const CONTROL_SIZE_PX = {
  sm: 32,
  md: 40,
  lg: 48,
} as const

/**
 * 读一个 CSS 变量的计算值；变量缺席时返回兜底值。
 * @param name 变量名，含前导 `--`
 * @param fallback 变量缺席时的取值
 * @param host 读级联的宿主元素，缺省用文档根
 */
export function readToken(
  name: string,
  fallback: string,
  host?: Element | null,
): string {
  if (typeof window === 'undefined') return fallback
  const target = host ?? document.documentElement
  const value = getComputedStyle(target).getPropertyValue(name).trim()
  return value || fallback
}
