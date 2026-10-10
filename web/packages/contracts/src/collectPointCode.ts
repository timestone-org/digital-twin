/** @fileoverview 采集点位编码的字符与长度契约，见 docs/COLLECT_DESIGN.md §2。 */
export const COLLECT_POINT_CODE_MAX_LENGTH = 64
/** 可见 ASCII，排除身份分隔符冒号。 */
export const COLLECT_POINT_CODE_PATTERN = /^[\x21-\x39\x3b-\x7e]+$/

/** 校验已去首尾空白的点位编码。 */
export function isCollectPointCode(code: string): boolean {
  return (
    code.length > 0 &&
    code.length <= COLLECT_POINT_CODE_MAX_LENGTH &&
    COLLECT_POINT_CODE_PATTERN.test(code)
  )
}
