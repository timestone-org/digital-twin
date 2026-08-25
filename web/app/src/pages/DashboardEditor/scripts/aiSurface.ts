/**
 * @fileoverview 大屏编辑器作为助手的工作面：它能读什么、能被要求做什么。
 *
 * ⚠ 每一件事都落到已有的 `EditorActions` 上，于是三件事是白拿的：改动立刻
 * 显示在画布上、一次 Ctrl+Z 撤掉一步、不保存就能预览（ADR-0023）。
 *
 * ⚠ 动手之前**先选中那个画布节点**。不只是因为动作层按选中项写——更因为用户
 * 得看见助手在动哪一个。改了一个屏幕外的节点而没有任何指示，是这套东西最容易
 * 让人失去信任的地方。
 *
 * ⚠ 快照是**摘要**不是整棵树。一屏最多 2000 个画布节点，整份塞进去会把上下文
 * 占满，而被挤掉的是技能正文与工具结果。
 */
import type { AssistantToolCall, ModuleManifest } from '@dt/contracts'

import type { ConfigPath } from '@/features/dashboard/configPath'
import { createBinding } from '@/features/dashboard/editorDoc'
import { nodeLabelOf } from '@/features/dashboard/nodeLabel'
import type { AiSurface, SurfaceSnapshot } from '@/features/ai/surfaces'
import { COMPOSE_TOOLS, runCompose } from './aiSurfaceCompose'
import type { ComposeDeps, EditorSurfaceDeps } from './aiSurfaceTypes'

export type { ComposeDeps, EditorSurfaceDeps }

/** 快照里最多列几个画布节点。再多就只给计数——列到第 200 个也没人读得完。 */
const MAX_LISTED = 120

/** 模块级卡片外观住在配置袋子的这一段。 */
const CARD_STYLE = '__cardStyle'

/** 这一页实现了哪些客户端工具。⚠ 与技能清单里声明的名字逐字相同。 */
export const EDITOR_TOOLS = [
  'dashboard.read_canvas',
  'dashboard.read_bindings',
  'dashboard.write_binding',
  'dashboard.set_config',
  ...COMPOSE_TOOLS,
] as const

/** 造出大屏编辑器这个工作面。 */
export function createEditorSurface(deps: ComposeDeps): AiSurface {
  return {
    kind: 'dashboard-editor',
    label: '大屏编辑器',
    tools: EDITOR_TOOLS,
    snapshot: () => snapshotOf(deps),
    run: (call) => settle(deps, call),
  }
}

function snapshotOf(deps: EditorSurfaceDeps): SurfaceSnapshot {
  const nodes = deps.editor.nodes.value
  return {
    node_count: nodes.length,
    selected_id: deps.editor.selectedId.value,
    nodes: nodes.slice(0, MAX_LISTED).map((node) => ({
      id: node.id,
      module_type: node.moduleType,
      label: nodeLabelOf(node, deps.getManifest),
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      binding_count: node.bindings.length,
    })),
    is_truncated: nodes.length > MAX_LISTED,
  }
}

/**
 * 把同步的分派收成一个 Promise。
 * ⚠ 必须接住同步抛：`Promise.resolve(dispatch(...))` 会在建出 Promise 之前
 * 就把异常扔出去，于是只挂了 `.catch()` 的调用方一个都收不到——而那正是
 * 「工具失败要如实回给模型」这条最容易断的地方。
 */
function settle(
  deps: ComposeDeps,
  call: AssistantToolCall,
): Promise<unknown> {
  try {
    return Promise.resolve(dispatch(deps, call))
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('执行失败'))
  }
}

function dispatch(deps: ComposeDeps, call: AssistantToolCall): unknown {
  if (call.name === 'dashboard.read_canvas') return snapshotOf(deps)
  if (call.name === 'dashboard.read_bindings') return readBindings(deps, call)
  if (call.name === 'dashboard.write_binding') return writeBinding(deps, call)
  if (call.name === 'dashboard.set_config') return setConfig(deps, call)
  const composed = runCompose(deps, call)
  if (composed !== null) return composed
  throw new Error(`当前页面没有实现 ${call.name}`)
}

function readBindings(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  const manifest = deps.getManifest(node.moduleType)
  return {
    node_id: node.id,
    module_type: node.moduleType,
    slots: (manifest?.bindings ?? []).map((slot) => ({
      key: slot.key,
      label: slot.label,
      data_type: slot.dataType,
      is_array: slot.isArray === true,
      is_required: slot.isRequired === true,
    })),
    bound: node.bindings.map((one) => ({
      field_key: one.fieldKey,
      source_kind: one.sourceKind,
      node_key: one.nodeKey,
    })),
  }
}

function writeBinding(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  const fieldKey = textArg(call, 'field_key')
  const pointKey = textArg(call, 'node_key')
  // 先选中：动作层按选中项写，而用户也要看见助手在动哪一个
  deps.editor.select(node.id)
  deps.editor.flush()
  // ⚠ **一次写完**，不走「先建槽再挑点」那两步。两步的话一次 Ctrl+Z 只退回
  // 点位、留下一条空绑定，而「助手的一步 = 用户的一次撤销」是这套东西的
  // 基本承诺（ADR-0023）。
  // ⚠ 也不能直接调 `applyPickedPoint`：它是为「用户先点绑点、再挑点位」那条路
  // 写的，对不存在的绑定**静默返回**——助手每次都「成功」而一条都没写出来。
  const current = node.bindings.find((one) => one.fieldKey === fieldKey)
  deps.actions.writeBinding({
    ...(current ?? createBinding(node.id, fieldKey)),
    sourceKind: 'opcua',
    nodeKey: pointKey,
  })
  return { ok: true, node_id: node.id, field_key: fieldKey }
}

function setConfig(
  deps: EditorSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const node = nodeOf(deps, call)
  const path = pathArg(call)
  refuseSilentNoop(deps.getManifest(node.moduleType), path)
  deps.editor.select(node.id)
  deps.editor.flush()
  deps.actions.changeConfig(path, call.arguments.value, false)
  return { ok: true, node_id: node.id, path }
}

/**
 * 拦下那些「写得进去、但一定不生效」的键。
 *
 * ⚠ 这是本页最该做的一件事：配置是一只自由袋子，写一个清单里没有的键既不报错
 * 也不渲染，画面上表现为「配了没反应」，而配置确实存下去了。服务端的模块目录
 * 又不带 `chromeConfigurable` / `unsupportedChromeKeys` 两格——只有浏览器手里的
 * 这份清单知道哪几个外观键这个模块画不出来。
 */
function refuseSilentNoop(
  manifest: ModuleManifest | undefined,
  path: ConfigPath,
): void {
  const head = path[0]
  if (manifest === undefined || typeof head !== 'string') return
  if (head !== CARD_STYLE) {
    const declared = manifest.configSchema.some((field) => field.key === head)
    if (!declared && !head.startsWith('__')) {
      throw new Error(`${manifest.type} 没有 ${head} 这个配置字段`)
    }
    return
  }
  if (manifest.chromeConfigurable === false) {
    throw new Error(`${manifest.type} 自绘外壳，统一外观键对它没有效果`)
  }
  const key = path[1]
  const unsupported = manifest.unsupportedChromeKeys ?? []
  // ⚠ `some` 而不是 `includes`：清单那格是 `ChromeKey[]`，而模型给的是裸串，
  // `includes` 会因为两边类型对不上而编译失败
  if (typeof key === 'string' && unsupported.some((one) => one === key)) {
    throw new Error(`${manifest.type} 画不出 ${key}，写了也看不见`)
  }
}

function nodeOf(deps: EditorSurfaceDeps, call: AssistantToolCall) {
  const nodeId = textArg(call, 'node_id')
  const node = deps.editor.nodes.value.find((one) => one.id === nodeId)
  // 认不出就抛：把「这个画布节点不在这一屏上」如实告诉模型，它下一轮会重读画布
  if (node === undefined) throw new Error(`画布上没有 ${nodeId} 这个节点`)
  return node
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}

function pathArg(call: AssistantToolCall): ConfigPath {
  const given = call.arguments.path
  if (!Array.isArray(given)) throw new Error('set_config 的 path 必须是数组')
  const parts: unknown[] = given
  return parts.map((one) => (typeof one === 'number' ? one : String(one)))
}
