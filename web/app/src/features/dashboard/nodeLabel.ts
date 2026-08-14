/**
 * @fileoverview 节点显示名：图层树、属性面板标题与联动目标列表共用一份。
 * 用户别名存 `configJson.__label`（双下划线 = schema 外私有键，随导入导出、
 * 撤销与草稿自动透传），缺省回落模块 displayName，再落原始 type。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'

/** 节点别名在 configJson 里的私有键。 */
export const NODE_LABEL_KEY = '__label'

type Labeled = Pick<DashboardNodePayload, 'moduleType' | 'configJson'>

/** 已存别名；非字符串或全空白视为未设置。 */
function rawLabel(node: Labeled): string | undefined {
  const raw = node.configJson[NODE_LABEL_KEY]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 节点显示名：用户别名 > 模块 displayName > 原始 type。 */
export function nodeLabelOf(
  node: Labeled,
  getManifest: GetModuleManifest,
): string {
  return (
    rawLabel(node) ??
    getManifest(node.moduleType)?.displayName ??
    node.moduleType
  )
}

/**
 * 提交别名后的新配置；空白 = 清除别名（删键而不是存空串，导出的 JSON 不留噪声）。
 * 与当前别名相同返回 null，调用方据此跳过——否则每次失焦都往撤销栈压一笔空步骤。
 */
export function configWithLabel(
  node: Labeled,
  raw: string,
): Record<string, unknown> | null {
  const next = raw.trim() === '' ? undefined : raw.trim()
  if (next === rawLabel(node)) return null
  if (next === undefined) {
    const rest = { ...node.configJson }
    delete rest[NODE_LABEL_KEY]
    return rest
  }
  return { ...node.configJson, [NODE_LABEL_KEY]: next }
}
