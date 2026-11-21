/** @fileoverview 画布节点按关键词、选中范围和稳定顺序分页读取。 */
import type { AssistantToolCall } from '@dt/contracts'
import { bindingReportQuery } from '@/features/ai/bindingReportQuery'
import { nodeLabelOf } from '@/features/dashboard/nodeLabel'
import type { EditorToolDeps } from './aiSurfaceTypes'

export function runCanvasRead(
  deps: EditorToolDeps,
  call: AssistantToolCall,
): unknown {
  if (call.name !== 'dashboard.list_nodes') return null
  const query = bindingReportQuery(call.arguments)
  const selected = deps.editor.selectedIds.value
  const wanted = deps.editor.nodes.value.filter(
    (node) =>
      (call.arguments.selected_only !== true || selected.includes(node.id)) &&
      `${node.id} ${nodeLabelOf(node, deps.getManifest)} ${node.moduleType}`
        .toLocaleLowerCase()
        .includes(query.keyword),
  )
  const nodes = wanted
    .slice(query.offset, query.offset + query.limit)
    .map((node) => ({
      id: node.id,
      module_type: node.moduleType,
      label: nodeLabelOf(node, deps.getManifest),
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      is_selected: selected.includes(node.id),
      binding_count: node.bindings.length,
    }))
  const next = query.offset + nodes.length
  return {
    nodes,
    total: wanted.length,
    offset: query.offset,
    returned: nodes.length,
    has_more: next < wanted.length,
    next_offset: next < wanted.length ? next : null,
  }
}
