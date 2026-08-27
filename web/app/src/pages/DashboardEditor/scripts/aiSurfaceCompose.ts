/**
 * @fileoverview 组态那一半的客户端工具：摆模块、删节点、改几何、对齐排布。
 *
 * ⚠ 与绑点那一半同一条铁律：每一件事都落到已有的 `EditorActions` /
 * `ArrangeActions` 上，于是改动立刻显示在画布上、一次 Ctrl+Z 撤掉一步
 * （ADR-0023）。这里一行都不许直接改 `editor.nodes`。
 *
 * ⚠ 几何一律**整数**。带小数的几何后端直接 422，而那时报出来的是一句字段
 * 校验错，看不出是助手算出来的坐标带了小数。
 */
import type { AssistantToolCall } from '@dt/contracts'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import { ALIGN_KINDS, type AlignKind } from '@/features/dashboard/canvasAlign'
import { acceptsChildren } from '@/features/dashboard/moduleLibrary'
import type { SurfaceSnapshot } from '@/features/ai/surfaces'
import type { ComposeDeps } from './aiSurfaceTypes'

/** 这一半实现了哪些工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const COMPOSE_TOOLS = [
  'dashboard.add_module',
  'dashboard.remove_node',
  'dashboard.set_geometry',
  'dashboard.arrange',
] as const

/** 分布与整理这三个不在 `ALIGN_KINDS` 里，单列。 */
const DISTRIBUTE_X = 'distribute-x'
const DISTRIBUTE_Y = 'distribute-y'
const TIDY = 'tidy'

/** 跑一个组态工具；认不出名字给 null，由调用方接着往下问。 */
export function runCompose(
  deps: ComposeDeps,
  call: AssistantToolCall,
): SurfaceSnapshot | null {
  if (call.name === 'dashboard.add_module') return addModule(deps, call)
  if (call.name === 'dashboard.remove_node') return removeNode(deps, call)
  if (call.name === 'dashboard.set_geometry') return setGeometry(deps, call)
  if (call.name === 'dashboard.arrange') return arrange(deps, call)
  return null
}

function addModule(
  deps: ComposeDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const type = textArg(call, 'module_type')
  const manifest = deps.getManifest(type)
  // 认不出就直说：模型下一轮会去查清单，而静默落一个别的模块无从发现
  if (manifest === undefined) {
    throw new Error(`没有 ${type} 这个模块类型，先查 modules.catalog`)
  }
  const parentId = hostArg(deps, call)
  const before = new Set(deps.editor.nodes.value.map((node) => node.id))
  // 先选中落点：动作层按选中项决定新节点进哪个容器，而用户也要看见落在哪
  deps.editor.select(parentId)
  deps.editor.flush()
  const at = pointArg(call)
  const added =
    at === null
      ? deps.actions.addModule(manifest)
      : deps.actions.addModuleAt(manifest, { parentId, ...at })
  if (!added) {
    throw new Error('没能加上：页头/页脚每屏只有一个，或大屏还没加载完')
  }
  const created = deps.editor.nodes.value.find((node) => !before.has(node.id))
  if (created === undefined) throw new Error('加上了但找不回新节点')
  deps.editor.select(created.id)
  deps.editor.flush()
  return { ok: true, node_id: created.id, module_type: created.moduleType }
}

function removeNode(
  deps: ComposeDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  // ⚠ 先数清子孙再删：删完再数是零，而用户要知道刚才连带没了几个
  const removed = 1 + descendantCount(deps.editor, node.id)
  deps.actions.removeNode(node.id)
  return { ok: true, node_id: node.id, removed_count: removed }
}

function setGeometry(
  deps: ComposeDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  const geometry = {
    x: intArg(call, 'x') ?? node.x,
    y: intArg(call, 'y') ?? node.y,
    w: intArg(call, 'w') ?? node.w,
    h: intArg(call, 'h') ?? node.h,
  }
  deps.editor.select(node.id)
  deps.editor.flush()
  // 不连续：这一步就是完整的一笔，用户一次 Ctrl+Z 应当整个退回
  deps.actions.changeGeometry(node.id, geometry, false)
  // ⚠ 回执报**落库后**的几何而不是入参：钉位模块（页头 / 页脚）的 x/y/宽会被
  // 动作层按钉边重算，照抄入参的话模型手里那份坐标与画布上的不是一回事，
  // 接着它会对着一个并不存在的位置继续算下一步
  const placed = nodeOf(deps, call)
  return {
    ok: true,
    node_id: node.id,
    x: placed.x,
    y: placed.y,
    w: placed.w,
    h: placed.h,
  }
}

function arrange(deps: ComposeDeps, call: AssistantToolCall): SurfaceSnapshot {
  const action = textArg(call, 'action')
  if (action === TIDY) {
    deps.arrange.tidyTopLevel()
    return { ok: true, action }
  }
  const ids = idsArg(deps, call)
  deps.editor.setSelection(ids)
  deps.editor.flush()
  if (action === DISTRIBUTE_X || action === DISTRIBUTE_Y) {
    // ⚠ 就地问一次而不是照做：不足三个时分布是个空动作，静默返回成功会让
    // 模型以为排好了，然后对着一屏没动过的节点接着说
    if (!deps.arrange.distributeReady()) {
      throw new Error('分布要同一层里至少三个节点')
    }
    deps.arrange.distributeSelected(action === DISTRIBUTE_X ? 'x' : 'y')
    return { ok: true, action, node_count: ids.length }
  }
  const kind = alignKindOf(action)
  if (!deps.arrange.alignReady()) {
    throw new Error('对齐要同一层里至少两个节点')
  }
  deps.arrange.alignSelected(kind)
  return { ok: true, action, node_count: ids.length }
}

function alignKindOf(action: string): AlignKind {
  const kind = ALIGN_KINDS.find((one) => one === action)
  if (kind === undefined) throw new Error(`不认识的排布动作 ${action}`)
  return kind
}

/** 一个节点底下有几个子孙。层数不深，逐层扫一遍就够。 */
function descendantCount(editor: DashboardEditor, nodeId: string): number {
  const all = editor.nodes.value
  let frontier = [nodeId]
  let total = 0
  while (frontier.length > 0) {
    const wanted = new Set(frontier)
    const children = all.filter(
      (node) => node.parentId !== null && wanted.has(node.parentId),
    )
    total += children.length
    frontier = children.map((node) => node.id)
  }
  return total
}

function nodeOf(deps: ComposeDeps, call: AssistantToolCall) {
  const nodeId = textArg(call, 'node_id')
  const node = deps.editor.nodes.value.find((one) => one.id === nodeId)
  if (node === undefined) throw new Error(`画布上没有 ${nodeId} 这个节点`)
  return node
}

/** 落点父层：不给就顶层；给了就得真是个装得下子节点的容器。 */
function hostArg(deps: ComposeDeps, call: AssistantToolCall): string | null {
  const given = call.arguments.parent_id
  if (typeof given !== 'string' || given === '') return null
  const host = deps.editor.nodes.value.find((one) => one.id === given)
  if (host === undefined) throw new Error(`画布上没有 ${given} 这个节点`)
  if (!acceptsChildren(deps.getManifest(host.moduleType))) {
    throw new Error(`${given} 装不下子节点`)
  }
  return host.id
}

/** 落点坐标：两维都给才算数，只给一维当没给。 */
function pointArg(call: AssistantToolCall): { x: number; y: number } | null {
  const x = intArg(call, 'x')
  const y = intArg(call, 'y')
  if (x === null || y === null) return null
  return { x, y }
}

function idsArg(deps: ComposeDeps, call: AssistantToolCall): string[] {
  const given = call.arguments.node_ids
  if (!Array.isArray(given)) throw new Error('arrange 少了 node_ids')
  const parts: unknown[] = given
  const known = new Set(deps.editor.nodes.value.map((node) => node.id))
  const ids = parts.map((one) => String(one))
  const missing = ids.filter((id) => !known.has(id))
  if (missing.length > 0) {
    throw new Error(`画布上没有这些节点：${missing.join('、')}`)
  }
  return ids
}

function intArg(call: AssistantToolCall, name: string): number | null {
  const given = call.arguments[name]
  if (given === undefined || given === null) return null
  if (typeof given !== 'number' || !Number.isInteger(given)) {
    throw new Error(`${name} 必须是整数`)
  }
  return given
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}
