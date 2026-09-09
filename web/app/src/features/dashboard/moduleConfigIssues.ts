/**
 * @fileoverview 汇总画布节点由 manifest 声明的跨字段配置错误。
 */
import type { BindingView, DashboardNodePayload } from '@dt/contracts'
import { resolveModuleConfig, type GetModuleManifest } from '@dt/runtime'

import { nodeLabelOf } from './nodeLabel'

/** 浏览器是否认识这个 IANA 时区。 */
export function isValidIanaTimezone(timezone: string): boolean {
  if (timezone === '' || timezone !== timezone.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
    return true
  } catch {
    return false
  }
}

/** 所有模块共用的绑定取数说明校验。 */
export function bindingConfigIssues(
  bindings: readonly BindingView[],
): string[] {
  return bindings.flatMap((binding) => {
    const detail = binding.detailJson
    if (
      binding.sourceKind !== 'archive' ||
      detail === null ||
      !('timezone' in detail) ||
      typeof detail.timezone !== 'string' ||
      detail.timezone === '' ||
      isValidIanaTimezone(detail.timezone)
    ) {
      return []
    }
    return [`绑定 ${binding.fieldKey} 的分桶时区不是有效的 IANA 时区`]
  })
}

/** 返回带节点显示名的配置错误；未注册模块交给服务端的模块校验处理。 */
export function moduleConfigIssues(
  nodes: readonly DashboardNodePayload[],
  getManifest: GetModuleManifest,
): string[] {
  return nodes.flatMap((node) => {
    const manifest = getManifest(node.moduleType)
    if (manifest === undefined) return []
    const config = resolveModuleConfig(manifest, node.configJson)
    const errors = [
      ...bindingConfigIssues(node.bindings),
      ...(manifest.validateConfig?.(config) ?? []),
      ...(manifest.validateBindings?.(config, node.bindings) ?? []),
    ]
    const label = nodeLabelOf(node, getManifest)
    return errors.map((message) => `${label}：${message}`)
  })
}
