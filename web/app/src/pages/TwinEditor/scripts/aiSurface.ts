/**
 * @fileoverview 孪生编辑器作为助手的工作面：读场景、读绑定、写绑定、照抄绑定、
 * 读实时读数、落库、截视口。
 *
 * ⚠ 截图与大屏同一份口径（`captureWithGl`）：视口是 WebGL，截图库直接读不到
 * 它的缓冲，靠场景登记的「先画一帧再拷」快照插替身截进去。
 *
 * ⚠ 数组绑定的行号是**文档序**，实体本身不在 fieldKey 里露面。所以读绑定时
 * 必须把每一行对应的实体名字一起给出去，让模型**按名字对**。按行号猜的结果是
 * 每一条绑定都有值、却全接错了对象，而界面上看不出来。
 *
 * ⚠ 快照必须带上「用户此刻选中了谁」：用户在大纲里点了一块信息牌说「把这个
 * 接上」，快照里没有选中的话，模型只能挑一个它自己觉得像的去改。
 */
import type { AssistantToolCall } from '@dt/contracts'
import { twinBindingRows, type TwinConfig } from '@dt/twin-config'

import { createBinding } from '@/features/dashboard/editorDoc'
import { withSource } from '@/features/ai/bindingSource'
import { captureCanvas } from '@/features/ai/captureWithGl'
import type { AiSurface, SurfaceSnapshot } from '@/features/ai/surfaces'

import {
  runTwinBindingTool,
  sameNodeOrThrow,
  TWIN_BINDING_TOOLS,
} from './aiSurfaceBindings'
import type { TwinSurfaceDeps } from './aiSurfaceTypes'
import { buildTwinOutline } from './outlineNodes'
import type { TwinEntityKind, TwinSelection } from './types'

export type { TwinSurfaceDeps }

/** 这一页实现了哪些客户端工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const TWIN_TOOLS = [
  'dashboard.read_canvas',
  'dashboard.write_binding',
  'dashboard.remove_binding',
  'dashboard.capture',
  ...TWIN_BINDING_TOOLS,
] as const

/**
 * 六类实体在快照里的单数写法（规格书 §2.5 的 `Brief.kind`）。
 * ⚠ 与大纲的集合名分开写而不是就地削掉尾巴：`flows` 削出来是 `flow` 纯属巧合，
 * 靠这个巧合定规则，加第七类实体时会安静地错。
 */
const BRIEF_KINDS: Readonly<Record<TwinEntityKind, string>> = {
  parts: 'part',
  anchors: 'anchor',
  cameras: 'camera',
  panels: 'panel',
  arrows: 'arrow',
  flows: 'flow',
}

/** 快照里选中的那一个。 */
interface TwinBrief {
  kind: string
  id: string
  /** 用户在大纲里看到的那个名字。 */
  name: string
}

/** 造出孪生编辑器这个工作面。 */
export function createTwinSurface(deps: TwinSurfaceDeps): AiSurface {
  return {
    kind: 'twin-editor',
    label: '孪生编辑器',
    tools: TWIN_TOOLS,
    snapshot: () => snapshotOf(deps),
    run: (call) => settle(deps, call),
  }
}

function snapshotOf(deps: TwinSurfaceDeps): SurfaceSnapshot {
  const config = deps.config()
  if (config === null) return { is_ready: false }
  const selection = deps.selection()
  const brief = briefOf(config, selection)
  return {
    is_ready: true,
    node_id: deps.nodeId(),
    node_label: deps.nodeLabel(),
    part_count: config.parts.length,
    anchor_count: config.anchors.length,
    panel_count: config.panels.length,
    arrow_count: config.arrows.length,
    flow_count: config.flows.length,
    bound_count: deps.bindings().length,
    // ⚠ 单选那一格**留着**：会话是跨版本的，删掉它会让老前端发来的快照
    //   在后端连选中项都读不出来（规格书 §2.5）
    selected_id: brief?.id ?? null,
    selected_ids: brief === null ? [] : [brief.id],
    selected: brief === null ? [] : [brief],
    // ⚠ 单例段没有 id，如实说是哪一档、不硬造一个：造一个的话模型会拿它当实体
    //   去绑，而那个 id 谁都不喂
    selected_section: 'id' in selection ? null : selection.kind,
  }
}

/**
 * 选中的那个实体的名片；选中的是单例段时为 null。
 * @param config 归一化后的孪生配置
 * @param selection 当前选中
 */
function briefOf(
  config: TwinConfig,
  selection: TwinSelection,
): TwinBrief | null {
  if (!('id' in selection)) return null
  return {
    kind: BRIEF_KINDS[selection.kind],
    id: selection.id,
    name: outlineNameOf(config, selection.kind, selection.id),
  }
}

/**
 * 一个实体在大纲里显示的那个名字；查不到退回 id。
 * ⚠ 走大纲那一份而不是就地读 `name`：用户嘴里的「那块信息牌」指的是他在左栏
 * 看到的那一行，两处各算各的名字时，他说的与模型改的对不上。
 * @param config 归一化后的孪生配置
 * @param kind 实体集合名
 * @param id 实体 id
 */
function outlineNameOf(
  config: TwinConfig,
  kind: TwinEntityKind,
  id: string,
): string {
  const section = buildTwinOutline(config, new Set<string>()).find(
    (one) => one.kind === kind,
  )
  const rows = [
    ...(section?.folders.flatMap((folder) => folder.rows) ?? []),
    ...(section?.rows ?? []),
  ]
  return rows.find((row) => row.id === id)?.label ?? id
}

/**
 * 把同步的分派收成一个 Promise。
 * ⚠ 必须接住同步抛：`Promise.resolve(dispatch(...))` 会在建出 Promise 之前
 * 就把异常扔出去，于是只挂了 `.catch()` 的调用方一个都收不到。
 */
function settle(
  deps: TwinSurfaceDeps,
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

function dispatch(deps: TwinSurfaceDeps, call: AssistantToolCall): unknown {
  if (call.name === 'dashboard.read_canvas') return snapshotOf(deps)
  if (call.name === 'dashboard.write_binding') return writeBinding(deps, call)
  if (call.name === 'dashboard.remove_binding') return dropBinding(deps, call)
  if (call.name === 'dashboard.capture') return captureCanvas(deps.stage())
  const bound = runTwinBindingTool(deps, call)
  if (bound !== null) return bound
  throw new Error(`当前页面没有实现 ${call.name}`)
}

function writeBinding(
  deps: TwinSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  sameNodeOrThrow(deps, call)
  const config = deps.config()
  if (config === null) throw new Error('孪生配置还没读出来')
  const fieldKey = textArg(call, 'field_key')
  // 认不出的槽键一律拒：写进去会多出一条谁都不喂的绑定，而它在界面上不显示
  const row = twinBindingRows(config).find((one) => one.fieldKey === fieldKey)
  if (row === undefined) {
    throw new Error(`这段孪生里没有 ${fieldKey} 这一行，先读一次绑定行`)
  }
  const current = deps.bindings().find((one) => one.fieldKey === fieldKey)
  // 常量与点位是同一条绑定的两种取数方式，口径两页共用一份
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
  deps: TwinSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  sameNodeOrThrow(deps, call)
  const fieldKey = textArg(call, 'field_key')
  if (!deps.bindings().some((one) => one.fieldKey === fieldKey)) {
    throw new Error(`这段孪生里没有 ${fieldKey} 这条绑定`)
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
