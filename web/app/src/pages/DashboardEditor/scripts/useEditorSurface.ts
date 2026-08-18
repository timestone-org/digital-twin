/**
 * @fileoverview 画布与图层树的事件接线：把两个组件抛上来的操作翻成
 * `editorActions` / `editorArrange` 的调用。收在一处，页面模板只做绑定。
 */
import type { ModuleManifest } from '@dt/contracts'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import { configWithLabel } from '@/features/dashboard/nodeLabel'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import * as doc from '@/features/dashboard/editorDoc'
import type { EditorActions } from './editorActions'
import type { ArrangeActions } from './editorArrange'

export interface EditorSurfaceDeps {
  editor: DashboardEditor
  actions: EditorActions
  arrange: ArrangeActions
  getManifest: (moduleType: string) => ModuleManifest | undefined
  /** 钉位撞单例时的提示出口。 */
  onRejected: (message: string) => void
}

export interface EditorSurface {
  onSelect: (nodeId: string | null, additive: boolean) => void
  onMarquee: (ids: readonly string[], additive: boolean) => void
  onChangeBatch: (
    changes: ReadonlyMap<string, NodeGeometry>,
    isContinuous: boolean,
  ) => void
  onDropNode: (
    nodeId: string,
    parentId: string | null,
    geometry: NodeGeometry,
  ) => void
  onAddAt: (
    moduleType: string,
    at: { parentId: string | null; x: number; y: number },
  ) => void
  onRename: (nodeId: string, name: string) => void
  onMove: (nodeId: string, parentId: string | null, at?: number) => void
  onFront: (nodeId: string) => void
  onBack: (nodeId: string) => void
  onForward: (nodeId: string) => void
  onBackward: (nodeId: string) => void
}

/** 画布抛上来的四个事件：选中、框选、批量几何、跨层拖放。 */
function canvasHandlers(
  deps: EditorSurfaceDeps,
): Pick<
  EditorSurface,
  'onSelect' | 'onMarquee' | 'onChangeBatch' | 'onDropNode'
> {
  const { editor, arrange } = deps

  return {
    onSelect: (nodeId, additive) => {
      if (nodeId === null) {
        editor.select(null)
        return
      }
      if (additive) editor.toggleSelect(nodeId)
      else editor.select(nodeId)
    },
    onMarquee: (ids, additive) => {
      editor.setSelection(
        additive ? [...editor.selectedIds.value, ...ids] : ids,
      )
    },
    onChangeBatch: (changes, isContinuous) => {
      arrange.changeGeometryBatch(changes, isContinuous)
    },
    onDropNode: (nodeId, parentId, geometry) => {
      // 换父与落位是同一笔：拆成两笔的话一次撤销只退一半，节点悬在旧层新位置
      editor.apply((nodes) =>
        doc.setGeometry(
          doc.moveNode(nodes, nodeId, parentId),
          nodeId,
          geometry,
        ),
      )
    },
  }
}

/** 图层树与模块落位：新增、改名、换父、层序。 */
function treeHandlers(
  deps: EditorSurfaceDeps,
): Pick<
  EditorSurface,
  | 'onAddAt'
  | 'onRename'
  | 'onMove'
  | 'onFront'
  | 'onBack'
  | 'onForward'
  | 'onBackward'
> {
  const { editor, actions, arrange } = deps

  return {
    onAddAt: (moduleType, at) => {
      const manifest = deps.getManifest(moduleType)
      if (manifest === undefined) return
      if (!actions.addModuleAt(manifest, at)) {
        deps.onRejected('这类钉位模块每张大屏最多一个')
      }
    },
    onRename: (nodeId, name) => {
      const node = editor.nodes.value.find((item) => item.id === nodeId)
      if (node === undefined) return
      const next = configWithLabel(node, name)
      if (next !== null) {
        editor.apply((nodes) => doc.setConfig(nodes, nodeId, next))
      }
    },
    onMove: (nodeId, parentId, at) => {
      arrange.moveNode(nodeId, parentId, at)
    },
    onFront: (nodeId) => {
      editor.apply((nodes) => doc.bringToFront(nodes, nodeId))
    },
    onBack: (nodeId) => {
      editor.apply((nodes) => doc.sendToBack(nodes, nodeId))
    },
    onForward: (nodeId) => {
      editor.apply((nodes) => doc.bringForward(nodes, nodeId))
    },
    onBackward: (nodeId) => {
      editor.apply((nodes) => doc.sendBackward(nodes, nodeId))
    },
  }
}

export function createEditorSurface(deps: EditorSurfaceDeps): EditorSurface {
  return { ...canvasHandlers(deps), ...treeHandlers(deps) }
}
