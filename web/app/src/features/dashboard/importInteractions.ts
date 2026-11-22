/** @fileoverview 导入包里需要确认的本屏联动引用及各自涉及的规则。 */
import type { DashboardExportPayload, DtSelectOption } from '@dt/contracts'
import { getModule } from '@dt/modules'
import { isRecord } from '@/api/dashboardWire'
import { INTERACTIONS_CHROME_KEY } from './interactionRules'
import { nodeLabelOf } from './nodeLabel'

export interface ImportInteractionReview {
  options: DtSelectOption[]
  references: { value: string; uses: string[] }[]
  problems: string[]
}

const visibilityRoles: ReadonlyMap<unknown, string> = new Map([
  ['show', '显示目标'],
  ['hide', '隐藏目标'],
  ['toggle', '切换显隐目标'],
])

interface Inspection {
  check: (value: unknown, location: string) => void
  problems: Set<string>
}

/** Python UUID 接受省略或变位的连字符、URN、花括号以及十六进制整数写法。 */
function isRuntimeId(value: string): boolean {
  const hex = value
    .replaceAll('urn:', '')
    .replaceAll('uuid:', '')
    .replace(/^[{}]+|[{}]+$/g, '')
    .replaceAll('-', '')
  return hex.length === 32 && /^(?:0x_?)?[a-f0-9]+(?:_[a-f0-9]+)*$/i.test(hex)
}

/** 包内唯一节点，展示编辑器别名和稳定键以区分同名节点。 */
function nodeOptions(payload: DashboardExportPayload): DtSelectOption[] {
  const counts = new Map<string, number>()
  for (const { clientKey } of payload.nodes)
    counts.set(clientKey, (counts.get(clientKey) ?? 0) + 1)
  return payload.nodes
    .filter((node) => counts.get(node.clientKey) === 1)
    .map((node) => ({
      value: node.clientKey,
      label: `${nodeLabelOf(node, getModule)} · ${node.clientKey}`,
    }))
}

/** 目标列表的每个成员都是本屏的节点引用。 */
function inspectTargets(
  targets: unknown,
  label: string,
  inspection: Inspection,
): void {
  if (!Array.isArray(targets)) {
    inspection.problems.add(`${label}：目标列表格式无效`)
    return
  }
  for (const target of targets) inspection.check(target, label)
}

/** 遍历动作中明确属于本屏的字段。 */
function inspectAction(
  action: Record<string, unknown>,
  rule: string,
  inspection: Inspection,
): void {
  const role = visibilityRoles.get(action.type)
  if (role !== undefined) {
    inspectTargets(action.targets, `${rule} · ${role}`, inspection)
    return
  }
  if (action.type === 'openModal')
    inspection.check(action.target, `${rule} · 弹窗目标`)
  if (action.type !== 'setActive') return
  if (!Array.isArray(action.groups)) {
    inspection.problems.add(`${rule}：激活组列表格式无效`)
    return
  }
  action.groups.forEach((group: unknown, index: number) => {
    inspectTargets(
      isRecord(group) ? group.targets : undefined,
      `${rule} · 第 ${index + 1} 个激活组`,
      inspection,
    )
  })
}

function inspectRules(rules: unknown, inspection: Inspection): void {
  if (!Array.isArray(rules)) {
    if (rules !== undefined) inspection.problems.add('联动规则必须是列表')
    return
  }
  rules.forEach((raw: unknown, index: number) => {
    const rule = `规则 ${index + 1}`
    if (!isRecord(raw)) {
      inspection.problems.add(`${rule}：规则格式无效`)
      return
    }
    const name =
      rule +
      (typeof raw.id === 'string' && raw.id !== '' ? `（${raw.id}）` : '')
    if ('source' in raw)
      inspection.check(
        isRecord(raw.source) ? raw.source.nodeId : undefined,
        `${name} · 触发节点`,
      )
    if (isRecord(raw.action)) inspectAction(raw.action, name, inspection)
  })
}

/** 按旧引用汇总它在各规则中的用途，保持包中原始数据。 */
export function inspectImportInteractions(
  payload: DashboardExportPayload,
): ImportInteractionReview {
  const options = nodeOptions(payload)
  const keys = new Set(options.map((item) => item.value))
  const uses = new Map<string, Set<string>>()
  const problems = new Set<string>()
  const check: Inspection['check'] = (value, location) => {
    if (typeof value === 'string') {
      if (keys.has(value) && !isRuntimeId(value)) return
      const places = uses.get(value) ?? new Set<string>()
      places.add(location)
      uses.set(value, places)
    } else if (
      !isRecord(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.client_key !== 'string' ||
      !keys.has(value.client_key)
    ) {
      problems.add(`${location}：节点标记无效或没有唯一对应的包内节点`)
    }
  }
  inspectRules(payload.chromeJson[INTERACTIONS_CHROME_KEY], { check, problems })
  return {
    options,
    references: Array.from(uses, ([value, places]) => ({
      value,
      uses: [...places],
    })),
    problems: [...problems],
  }
}
