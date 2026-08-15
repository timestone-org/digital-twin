/**
 * @fileoverview 归一化吞不掉的那类错：重复 id。
 * 归一化只管形状，这一样必须响亮报出去——静默降级对人尚可忍受，对 Agent 是致命的（ADR-0012 四）。
 */
import type { TwinConfig } from './types'

/** 问题种类。 */
export const TWIN_CONFIG_ISSUE_KINDS = ['duplicate-id'] as const
export type TwinConfigIssueKind = (typeof TWIN_CONFIG_ISSUE_KINDS)[number]

/** 一条配置问题。`path` 是出问题的字段路径，如 `anchors[2].id`。 */
export interface TwinConfigIssue {
  kind: TwinConfigIssueKind
  entityId: string
  path: string
  detail: string
}

function duplicateIds(
  section: string,
  items: readonly { id: string }[],
): TwinConfigIssue[] {
  const seen = new Set<string>()
  const out: TwinConfigIssue[] = []
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      out.push({
        kind: 'duplicate-id',
        entityId: item.id,
        path: `${section}[${index}].id`,
        detail: '同一个 id 出现两次，缝合实时值时后者会覆盖前者',
      })
    }
    seen.add(item.id)
  })
  return out
}

/**
 * 收齐一份归一化配置里的全部问题，按 parts → anchors 的顺序；没有问题返回空数组。
 * @param config 归一化后的配置
 */
export function collectTwinConfigIssues(config: TwinConfig): TwinConfigIssue[] {
  return [
    ...duplicateIds('parts', config.parts),
    ...duplicateIds('anchors', config.anchors),
  ]
}
