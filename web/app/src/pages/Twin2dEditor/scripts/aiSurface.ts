/**
 * @fileoverview 2D 孪生编辑器作为助手的工作面：读画布、读绑定、写绑定、
 * 照抄绑定、读实时读数、落库。
 *
 * ⚠ **不给 `dashboard.capture`**：这一页的舞台是 SVG/DOM，截图那条链路只在
 * 大屏与 3D 替身上验过。没验过的工具摆出来就是每次调都失败，而模型看得见它，
 * 于是每一轮都要先撞一次墙。
 *
 * ⚠ 数组绑定的行号是**文档序**，实体本身不在 fieldKey 里露面。所以读绑定时
 * 必须把每一行对应的实体名字一起给出去，让模型**按名字对**。按行号猜的结果是
 * 每一条绑定都有值、却全接错了对象，而界面上看不出来。
 *
 * ⚠ 快照带的是**整批**选中：这一页的画布选中本来就是多选，只给一个的话，
 * 用户说「把我选的这几个接上」时，模型只动得了其中一个。
 */
import type { AssistantToolCall } from '@dt/contracts'
import { twin2dBindingRows, type Twin2dConfig } from '@dt/twin2d'

import { withSource } from '@/features/ai/bindingSource'
import type { AiSurface, SurfaceSnapshot } from '@/features/ai/surfaces'
import { createBinding } from '@/features/dashboard/editorDoc'

import {
  runTwin2dBindingTool,
  twin2dConfigOf,
  twin2dSameNodeOrThrow,
  TWIN_2D_BINDING_TOOLS,
} from './aiSurfaceBindings'
import type { Twin2dSurfaceDeps } from './aiSurfaceTypes'
import type { Twin2dPick, Twin2dPickKind } from './editorSelection'
import { twin2dOutlineRows } from './outlineRows'

export type { Twin2dSurfaceDeps }

/** 这一页实现了哪些客户端工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const TWIN_2D_TOOLS = [
  'dashboard.read_canvas',
  'dashboard.write_binding',
  'dashboard.remove_binding',
  ...TWIN_2D_BINDING_TOOLS,
] as const

/**
 * 三类画布实体在快照里的单数写法（规格书 §2.5 的 `Brief.kind`）。
 * ⚠ 与画布上的集合名分开写而不是就地削掉尾巴：靠削尾巴定规则，加第四类实体时
 * 会安静地错。
 */
const BRIEF_KINDS: Readonly<Record<Twin2dPickKind, string>> = {
  nodes: 'node',
  edges: 'edge',
  marks: 'mark',
}

/** 快照里选中的一个。 */
interface Twin2dBrief {
  kind: string
  id: string
  /** 用户在大纲里看到的那个名字。 */
  name: string
}

/** 造出 2D 孪生编辑器这个工作面。 */
export function createTwin2dSurface(deps: Twin2dSurfaceDeps): AiSurface {
  return {
    kind: 'twin2d-editor',
    label: '2D 孪生编辑器',
    tools: TWIN_2D_TOOLS,
    snapshot: () => snapshotOf(deps),
    run: (call) => settle(deps, call),
  }
}

function snapshotOf(deps: Twin2dSurfaceDeps): SurfaceSnapshot {
  const config = deps.config()
  if (config === null) return { is_ready: false }
  const selected = briefsOf(deps, config)
  return {
    is_ready: true,
    node_id: deps.nodeId(),
    node_label: deps.nodeLabel(),
    canvas: {
      width: config.canvas.width,
      height: config.canvas.height,
      grid: config.canvas.grid,
    },
    node_count: config.nodes.length,
    edge_count: config.edges.length,
    mark_count: config.marks.length,
    style_count: config.styles.length,
    bound_count: deps.bindings().length,
    // ⚠ 单选那一格**留着**：会话是跨版本的，删掉它会让老前端发来的快照
    //   在后端连选中项都读不出来（规格书 §2.5）。多选时给最后点的那一个,
    //   与右栏检查器画的是同一个
    selected_id: selected.at(-1)?.id ?? null,
    selected_ids: selected.map((one) => one.id),
    selected: selected,
  }
}

/**
 * 画布上此刻选中的那一批名片，按选中次序。
 * ⚠ 只读画布那一条轴：并行的 `styleFocus`（正在编哪份样式）不是画布选中，
 * 混进来的话，用户说「就动我选的这几个」时会连一份样式一起改。
 * @param deps 工作面句柄
 * @param config 归一化后的 2D 孪生配置
 */
function briefsOf(
  deps: Twin2dSurfaceDeps,
  config: Twin2dConfig,
): Twin2dBrief[] {
  const pick: Twin2dPick | null = deps.selection.pick.value
  if (pick === null) return []
  const rows = twin2dOutlineRows(config, deps.selection, pick.kind)
  return pick.ids.map((id) => ({
    kind: BRIEF_KINDS[pick.kind],
    id,
    // 大纲那一行的主名，就是用户嘴里的「这个」；查不到退回 id
    name: rows.find((row) => row.key === id)?.title ?? id,
  }))
}

/**
 * 把同步的分派收成一个 Promise。
 * ⚠ 必须接住同步抛：`Promise.resolve(dispatch(...))` 会在建出 Promise 之前
 * 就把异常扔出去，于是只挂了 `.catch()` 的调用方一个都收不到。
 */
function settle(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): Promise<unknown> {
  try {
    return Promise.resolve(dispatch(deps, call))
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error('执行失败'),
    )
  }
}

function dispatch(deps: Twin2dSurfaceDeps, call: AssistantToolCall): unknown {
  if (call.name === 'dashboard.read_canvas') return snapshotOf(deps)
  if (call.name === 'dashboard.write_binding') return writeBinding(deps, call)
  if (call.name === 'dashboard.remove_binding') return dropBinding(deps, call)
  const bound = runTwin2dBindingTool(deps, call)
  if (bound !== null) return bound
  throw new Error(`当前页面没有实现 ${call.name}`)
}

function writeBinding(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  twin2dSameNodeOrThrow(deps, call)
  const config = twin2dConfigOf(deps)
  const fieldKey = textArg(call, 'field_key')
  // 认不出的槽键一律拒：写进去会多出一条谁都不喂的绑定，而它在界面上不显示
  const row = twin2dBindingRows(config).find((one) => one.fieldKey === fieldKey)
  if (row === undefined) {
    throw new Error(`这张图里没有 ${fieldKey} 这一行，先读一次绑定`)
  }
  const current = deps.bindings().find((one) => one.fieldKey === fieldKey)
  // 常量与点位是同一条绑定的两种取数方式，口径三个工作面共用一份
  const written = withSource(
    current ?? createBinding(deps.nodeId(), fieldKey),
    call,
  )
  deps.write(written)
  return {
    ok: true,
    field_key: fieldKey,
    entity: row.label,
    source_kind: written.sourceKind,
  }
}

/** 解掉一条绑定。⚠ 换点位不要用它——直接重写那一条，绑定 id 要沿用。 */
function dropBinding(
  deps: Twin2dSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  twin2dSameNodeOrThrow(deps, call)
  const fieldKey = textArg(call, 'field_key')
  if (!deps.bindings().some((one) => one.fieldKey === fieldKey)) {
    throw new Error(`这张图里没有 ${fieldKey} 这条绑定`)
  }
  deps.drop(fieldKey)
  return { ok: true, node_id: deps.nodeId(), field_key: fieldKey }
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}
