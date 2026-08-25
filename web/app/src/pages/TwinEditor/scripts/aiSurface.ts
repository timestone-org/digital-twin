/**
 * @fileoverview 孪生编辑器作为助手的工作面：读场景、读绑定行、写绑定、截视口。
 *
 * ⚠ 截图与大屏同一份口径（`captureWithGl`）：视口是 WebGL，截图库直接读不到
 * 它的缓冲，靠场景登记的「先画一帧再拷」快照插替身截进去。
 *
 * ⚠ 数组绑定的行号是**文档序**，实体本身不在 fieldKey 里露面。所以读绑定时
 * 必须把每一行对应的实体名字一起给出去，让模型**按名字对**。按行号猜的结果是
 * 每一条绑定都有值、却全接错了对象，而界面上看不出来。
 */
import type { AssistantToolCall, BindingPayload } from '@dt/contracts'
import { twinBindingRows, type TwinConfig } from '@dt/twin-config'

import { createBinding } from '@/features/dashboard/editorDoc'
import { withSource } from '@/features/ai/bindingSource'
import { captureCanvas } from '@/features/ai/captureWithGl'
import type { AiSurface, SurfaceSnapshot } from '@/features/ai/surfaces'

/** 这一页实现了哪些客户端工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const TWIN_TOOLS = [
  'dashboard.read_canvas',
  'dashboard.read_bindings',
  'dashboard.write_binding',
  'dashboard.capture',
] as const

/** 快照里最多列几行。一份大场景能有几百行，整份塞进去会占满上下文。 */
const MAX_ROWS = 150

export interface TwinSurfaceDeps {
  /** 归一化后的孪生配置；还没读出来时给 null。 */
  config: () => TwinConfig | null
  bindings: () => readonly BindingPayload[]
  write: (binding: BindingPayload) => void
  /** 这段孪生所在的大屏节点 id；新建的绑定挂在它上面。 */
  nodeId: () => string
  /** 3D 视口的宿主元素，截图的根；还没挂载时给 null。 */
  stage: () => HTMLElement | null
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
  return {
    is_ready: true,
    node_id: deps.nodeId(),
    anchor_count: config.anchors.length,
    panel_count: config.panels.length,
    arrow_count: config.arrows.length,
    flow_count: config.flows.length,
    hier_node_count: config.hierNodes.length,
    bound_count: deps.bindings().length,
  }
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
  if (call.name === 'dashboard.read_bindings') return readRows(deps)
  if (call.name === 'dashboard.write_binding') return writeBinding(deps, call)
  if (call.name === 'dashboard.capture') return captureCanvas(deps.stage())
  throw new Error(`当前页面没有实现 ${call.name}`)
}

function readRows(deps: TwinSurfaceDeps): SurfaceSnapshot {
  const config = deps.config()
  if (config === null) throw new Error('孪生配置还没读出来')
  const bound = new Map(
    deps.bindings().map((one) => [one.fieldKey, one.nodeKey]),
  )
  const rows = twinBindingRows(config)
  return {
    node_id: deps.nodeId(),
    row_count: rows.length,
    rows: rows.slice(0, MAX_ROWS).map((row) => ({
      field_key: row.fieldKey,
      // 这一行喂的是哪个实体。⚠ 按它对，不要按行号猜
      entity: row.label,
      entity_id: row.entityId,
      node_key: bound.get(row.fieldKey) ?? null,
    })),
    is_truncated: rows.length > MAX_ROWS,
  }
}

function writeBinding(
  deps: TwinSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
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

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}
