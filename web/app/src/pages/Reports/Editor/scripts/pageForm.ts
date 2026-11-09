/**
 * @fileoverview 页面设置弹窗里数字字段的校验；取值范围照服务端的 PageSettings
 * （platform-server apps/report/schemas/document.py），超出的值存模板时会被拒。
 */

/** 正文字号的取值范围，磅。 */
export const FONT_SIZE_RANGE = { min: 6, max: 72 } as const
/** 页边距的取值范围，厘米。 */
export const MARGIN_RANGE = { min: 0, max: 10 } as const

/**
 * 把一格文本读成范围内的数。
 * ⚠ 空串不算 0：清空字号再应用会把正文排成 0 磅。
 * @param text 输入框里的文本
 * @param range 允许的闭区间
 * @returns 合法时给数，否则给 null
 */
export function boundedNumber(
  text: string,
  range: { min: number; max: number },
): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  return value >= range.min && value <= range.max ? value : null
}

/**
 * 一格的报错文案；合法给空串。
 * @param text 输入框里的文本
 * @param range 允许的闭区间
 */
export function boundedError(
  text: string,
  range: { min: number; max: number },
): string {
  return boundedNumber(text, range) === null
    ? `填 ${range.min}～${range.max} 之间的数`
    : ''
}
