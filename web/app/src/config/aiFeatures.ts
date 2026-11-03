/** @fileoverview AI 功能开关校验与对应页面的统一可用性判定。 */

const AI_PAGE_PATHS: readonly string[] = [
  '/knowledge',
  '/knowledge/chat',
  '/system/models',
  '/system/assistant',
]

/** 严格读取 AI 功能开关，缺省保留完整功能。
 * @param raw 构建配置中的功能开关
 */
export function parseAiEnabled(raw: unknown): boolean {
  if (raw === undefined || raw === 'true') return true
  if (raw === 'false') return false
  throw new Error('VITE_AI_ENABLED 必须是 true 或 false')
}

/** 按同一开关收敛 AI 页面与导航，其他业务页面始终保留。
 * @param path 应用内页面路径
 * @param isEnabled AI 功能开关
 */
export function isAiPageEnabled(
  path: string | undefined,
  isEnabled: boolean,
): boolean {
  return isEnabled || !AI_PAGE_PATHS.includes(path ?? '')
}
