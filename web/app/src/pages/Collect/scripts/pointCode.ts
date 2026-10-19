/** @fileoverview 点位创建与导入共用的编码校验提示。 */
import {
  COLLECT_POINT_CODE_MAX_LENGTH,
  isCollectPointCode,
} from '@dt/contracts'

/** 返回已去首尾空白的点位编码的校验提示。 */
export function pointCodeProblem(code: string): string | null {
  if (code === '') return '点位编码不能为空'
  if (code.length > COLLECT_POINT_CODE_MAX_LENGTH)
    return `点位编码不能超过 ${COLLECT_POINT_CODE_MAX_LENGTH} 个字符`
  if (!isCollectPointCode(code))
    return '点位编码只接受可见英文字符，不能含空白、控制字符或冒号'
  return null
}
