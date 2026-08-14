/**
 * @fileoverview 归一化吞不掉的三类跨实体错误：重复 id、悬空部件引用、gradient 规则缺区间。
 * 归一化只管形状，这三样必须响亮报出去——静默降级对人尚可忍受，对 Agent 是致命的（ADR-0012 四）。
 */
import type { TwinConfig, TwinTintRule } from './types'

/** 问题种类。 */
export const TWIN_CONFIG_ISSUE_KINDS = [
  'duplicate-id',
  'dangling-part',
  'gradient-without-range',
] as const
export type TwinConfigIssueKind = (typeof TWIN_CONFIG_ISSUE_KINDS)[number]

/** 一条配置问题。`path` 是出问题的字段路径，如 `tints[2].partIds[0]`。 */
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

function tintIssues(
  rule: TwinTintRule,
  index: number,
  partIds: ReadonlySet<string>,
): TwinConfigIssue[] {
  const out: TwinConfigIssue[] = rule.partIds
    .map((partId, slot) => ({ partId, slot }))
    .filter((ref) => !partIds.has(ref.partId))
    .map((ref) => ({
      kind: 'dangling-part' as const,
      entityId: rule.id,
      path: `tints[${index}].partIds[${ref.slot}]`,
      detail: `找不到部件 ${ref.partId}，这条规则会少染一组节点`,
    }))
  if (rule.mode === 'gradient' && rule.gradient === null) {
    out.push({
      kind: 'gradient-without-range',
      entityId: rule.id,
      path: `tints[${index}].gradient`,
      detail: 'gradient 模式缺合法的 lo/hi 区间，这条规则永远不染色',
    })
  }
  return out
}

/**
 * 收齐一份归一化配置里的全部问题，按 parts → anchors → tints 的顺序；没有问题返回空数组。
 * @param config 归一化后的配置
 */
export function collectTwinConfigIssues(config: TwinConfig): TwinConfigIssue[] {
  const partIds = new Set(config.parts.map((part) => part.id))
  return [
    ...duplicateIds('parts', config.parts),
    ...duplicateIds('anchors', config.anchors),
    ...duplicateIds('tints', config.tints),
    ...config.tints.flatMap((rule, index) => tintIssues(rule, index, partIds)),
  ]
}
