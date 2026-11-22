/** @fileoverview 给大屏宿主装载联动规则和图元的实际初选。 */
import type { DashboardNodePayload } from '@dt/contracts'
import {
  resolveModuleConfig,
  type GetModuleManifest,
  type InteractionRuntime,
  type InitialSelection,
} from '@dt/runtime'
import { parseInteractionRules } from './interactionRules'

type SourceNode = Pick<
  DashboardNodePayload,
  'id' | 'isVisible' | 'moduleType' | 'configJson'
>

/** 装载运行、公开或预览文档；进场只重放选择类控件的互斥规则。 */
export function loadInteractions(
  runtime: InteractionRuntime,
  chrome: Record<string, unknown>,
  nodes: readonly SourceNode[],
  getManifest: GetModuleManifest,
): void {
  const rules = parseInteractionRules(chrome)
  const sources = new Set(
    rules
      .filter(
        (rule) =>
          rule.source.event === 'select' && rule.action.type === 'setActive',
      )
      .map((rule) => rule.source.nodeId),
  )
  runtime.init(
    rules,
    nodes.map((node) => ({ nodeId: node.id, isVisible: node.isVisible })),
    () => {
      const selections: InitialSelection[] = []
      for (const node of nodes) {
        if (!sources.has(node.id)) continue
        const manifest = getManifest(node.moduleType)
        const value = manifest?.initialSelection?.(
          resolveModuleConfig(manifest, node.configJson),
          runtime.activeValueOf(node.id),
        )
        if (value !== undefined) selections.push({ nodeId: node.id, value })
      }
      return selections
    },
  )
}
