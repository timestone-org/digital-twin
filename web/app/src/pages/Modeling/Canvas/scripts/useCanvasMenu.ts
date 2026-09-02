/**
 * @fileoverview 右键菜单的开合与派发：算条目、记落点、把点中的那一项接到动作上。
 *
 * ⚠ 派发写在这里而不是页面里：菜单项与动作是一一对应的，摆在两个文件里迟早会
 * 有一项只剩菜单没有动作——那一项点下去毫无反应，而 typecheck 与 lint 都不管。
 */
import type { ModelingGraph } from '@dt/contracts'
import type { Ref } from 'vue'
import { ref } from 'vue'

import type { MenuAction, MenuGroup } from './menuItems'
import { groupsFor } from './menuItems'
import type { AlignKind } from './nodeLayout'
import { ALIGN_KINDS } from './nodeLayout'
import type { useCanvasActions } from './useCanvasActions'
import type { useCanvasSelection } from './useCanvasSelection'

/** 右键落在了什么上。 */
export interface MenuTarget {
  nodeId: string | null
  edgeId: string | null
}

/** 菜单开着时的全部状态。 */
export interface MenuState {
  at: { x: number; y: number }
  on: MenuTarget
  groups: MenuGroup[]
}

export interface MenuDeps {
  actions: ReturnType<typeof useCanvasActions>
  selection: ReturnType<typeof useCanvasSelection>
  graph: Ref<ModelingGraph>
  isReadonly: () => boolean
  /** 这个节点有没有结果可看。 */
  hasResult: (nodeId: string) => boolean
  /** 打开改名弹窗。 */
  onRename: (nodeId: string) => void
  onOpenConfig: (nodeId: string) => void
  onOpenResult: (nodeId: string) => void
}

/** Mac 上显示 ⌘，别处显示 Ctrl。 */
export function modLabel(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl'
}

/** `align:left` 这种动作里的那一半。认不出来给 null。 */
function alignKindOf(action: MenuAction): AlignKind | null {
  const name = action.startsWith('align:') ? action.slice('align:'.length) : ''
  return ALIGN_KINDS.find((kind) => kind === name) ?? null
}

/** 在这个落点上，菜单该摆哪些条目。 */
function stateAt(
  deps: MenuDeps,
  at: { x: number; y: number },
  on: MenuTarget,
): MenuState {
  const nodeId = on.nodeId
  return {
    at,
    on,
    groups: groupsFor({
      nodeId,
      edgeId: on.edgeId,
      selectedCount: deps.selection.selectedNodeIds.value.length,
      hasIncoming:
        nodeId !== null &&
        deps.graph.value.edges.some((edge) => edge.to_node === nodeId),
      hasResult: nodeId !== null && deps.hasResult(nodeId),
      canPaste: deps.actions.canPaste(),
      hasNodes: deps.graph.value.nodes.length > 0,
      isReadonly: deps.isReadonly(),
      mod: modLabel(navigator.platform),
    }),
  }
}

/** 落在线上就删那条线，否则删整份选中。 */
function removeOn(deps: MenuDeps, on: MenuTarget): void {
  if (on.edgeId !== null) return deps.actions.removeEdge(on.edgeId)
  deps.actions.removeSelected()
}

/** 只对着某个节点才有意义的那几项。 */
function runOnNode(deps: MenuDeps, action: MenuAction, nodeId: string): void {
  if (action === 'config') deps.onOpenConfig(nodeId)
  if (action === 'result') deps.onOpenResult(nodeId)
  if (action === 'rename') deps.onRename(nodeId)
  if (action === 'disconnect') deps.actions.disconnect(nodeId)
}

/** 对齐与分布那一组。不属于这一组时返回 false，交给下一段。 */
function runArrange(deps: MenuDeps, action: MenuAction): boolean {
  const kind = alignKindOf(action)
  if (kind !== null) {
    deps.actions.align(kind)
    return true
  }
  if (action === 'spread:x') deps.actions.spread('x')
  else if (action === 'spread:y') deps.actions.spread('y')
  else return false
  return true
}

/** 剪贴板与整体性的那几项。 */
function runCanvas(deps: MenuDeps, action: MenuAction): void {
  if (action === 'copy') deps.actions.copy()
  if (action === 'duplicate') deps.actions.duplicate()
  if (action === 'paste') deps.actions.paste()
  if (action === 'select-all') deps.actions.selectAll()
  if (action === 'auto-layout') deps.actions.autoLayout()
  if (action === 'fit') deps.actions.fit()
}

/** 派发一项菜单动作。 */
function dispatch(deps: MenuDeps, action: MenuAction, on: MenuTarget): void {
  if (runArrange(deps, action)) return
  if (on.nodeId !== null) runOnNode(deps, action, on.nodeId)
  runCanvas(deps, action)
  if (action === 'remove') removeOn(deps, on)
}

export function useCanvasMenu(deps: MenuDeps) {
  const menu = ref<MenuState | null>(null)

  return {
    menu,
    open: (at: { x: number; y: number }, on: MenuTarget) => {
      menu.value = stateAt(deps, at, on)
    },
    close: () => {
      menu.value = null
    },
    /** 点中一项。**先收起再执行**，免得动作弹出的对话框被菜单压着。 */
    run: (action: MenuAction) => {
      const on = menu.value?.on ?? { nodeId: null, edgeId: null }
      menu.value = null
      dispatch(deps, action, on)
    },
  }
}
