/**
 * @fileoverview 编辑器的动作集：把界面上的一次操作翻成一次文档改动 + 一个合并键。
 * 改动本身全是 `features/dashboard/editorDoc.ts` 的纯函数，这里只决定
 * 「这一笔算不算连续输入」。
 *
 * ⚠ 合并键是 `(节点, 字段)`：少了节点这一段，在 A 上输入完切到 B 再输入会并成一笔，
 * 一次撤销把两个节点的改动一起撤掉。
 */
import type { BindingPayload, ModuleManifest } from '@dt/contracts'
import type { DesignSize, GetModuleManifest } from '@dt/runtime'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import {
  arrayRowCount,
  withRowRemoved,
} from '@/features/dashboard/bindingSlots'
import type { ConfigPath } from '@/features/dashboard/configPath'
import * as doc from '@/features/dashboard/editorDoc'
import {
  acceptsChildren,
  isPinnedRegion,
} from '@/features/dashboard/moduleLibrary'

export interface EditorActionDeps {
  editor: DashboardEditor
  /** 当前大屏 id；还没加载出来时给 null。 */
  dashboardId: () => string | null
  getManifest: GetModuleManifest
  /** 顶层设计尺寸；钉位模块的几何按它铺满横向。 */
  design: () => DesignSize
}

export interface NodeActions {
  /**
   * 添加模块；钉位模块（页头/页脚）每屏最多一个，撞单例时不加并返回 false，
   * 由调用方提示——静默不加的表现是「点了没反应」。
   */
  addModule: (manifest: ModuleManifest) => boolean
  /** 拖到画布某个落点添加；`parentId` 是命中的容器，顶层给 null。 */
  addModuleAt: (
    manifest: ModuleManifest,
    at: { parentId: string | null; x: number; y: number },
  ) => boolean
  removeNode: (nodeId: string) => void
  toggleVisible: (nodeId: string, isVisible: boolean) => void
  changeGeometry: (
    nodeId: string,
    geometry: doc.NodeGeometry,
    isContinuous: boolean,
  ) => void
  changeConfig: (
    path: ConfigPath,
    value: unknown,
    isContinuous: boolean,
  ) => void
}

export interface BindingActions {
  writeBinding: (binding: BindingPayload) => void
  bindSlot: (fieldKey: string) => void
  dropSlot: (fieldKey: string) => void
  addBindingRow: (slotKey: string) => void
  removeBindingRow: (slotKey: string, rowIndex: number) => void
  /** 把挑到的点位写进某条绑定。 */
  applyPickedPoint: (fieldKey: string, pointKey: string) => void
}

export type EditorActions = NodeActions & BindingActions

/** 连续输入的合并键。 */
function mergeKeyOf(nodeId: string, field: string): string {
  return `${nodeId}:${field}`
}

/** 新节点的落点：选中的是容器就进它，否则落到顶层。 */
function hostOf(deps: EditorActionDeps): string | null {
  const host = deps.editor.selected.value
  if (host === null) return null
  return acceptsChildren(deps.getManifest(host.moduleType)) ? host.id : null
}

/**
 * 钉位模块的落位几何：横向铺满、页头钉顶、页脚钉底，只留高度可调。
 */
function pinnedGeometry(
  manifest: ModuleManifest,
  design: DesignSize,
): doc.NodeGeometry {
  const h = manifest.defaultSize.height
  return {
    x: 0,
    y: manifest.region === 'footer' ? Math.max(0, design.height - h) : 0,
    w: design.width,
    h,
  }
}

/** 插入一个新节点；钉位撞单例时不插并返回 false。 */
function insertModule(
  deps: EditorActionDeps,
  manifest: ModuleManifest,
  at: { parentId: string | null; x: number; y: number } | null,
): boolean {
  const dashboardId = deps.dashboardId()
  if (dashboardId === null) return false
  const pinned = isPinnedRegion(manifest)
  if (
    pinned &&
    deps.editor.nodes.value.some(
      (node) => deps.getManifest(node.moduleType)?.region === manifest.region,
    )
  ) {
    return false
  }
  // 钉位模块永远落顶层：钉进容器既没有「顶」也没有「底」可言
  const parentId = pinned ? null : (at?.parentId ?? hostOf(deps))
  deps.editor.apply((nodes) => {
    const created = doc.createNode({
      dashboardId,
      manifest,
      parentId,
      siblingCount: doc.siblingCount(nodes, parentId),
      zIndex: doc.nextZIndex(nodes, parentId),
    })
    const geometry = pinned
      ? pinnedGeometry(manifest, deps.design())
      : at === null
        ? null
        : { x: at.x, y: at.y, w: created.w, h: created.h }
    return doc.setGeometry(
      [...nodes, created],
      created.id,
      geometry ?? { x: created.x, y: created.y, w: created.w, h: created.h },
    )
  })
  return true
}

function createNodeActions(deps: EditorActionDeps): NodeActions {
  const { editor } = deps
  return {
    addModule: (manifest) => insertModule(deps, manifest, null),
    addModuleAt: (manifest, at) => insertModule(deps, manifest, at),
    removeNode: (nodeId) => {
      editor.apply((nodes) => doc.removeSubtree(nodes, nodeId))
      if (editor.selectedId.value === nodeId) editor.select(null)
    },
    toggleVisible: (nodeId, isVisible) => {
      editor.apply((nodes) => doc.setVisible(nodes, nodeId, isVisible))
    },
    // ⚠ 松手那一下也并进同一笔再关窗口：把它当成独立的一笔会让一次拖动留下
    // 两条历史，第一次撤销只退回松手前那一帧，看着就像「撤销没反应」
    changeGeometry: (nodeId, geometry, isContinuous) => {
      editor.apply(
        (nodes) => doc.setGeometry(nodes, nodeId, geometry),
        mergeKeyOf(nodeId, 'geometry'),
      )
      if (!isContinuous) editor.flush()
    },
    changeConfig: (path, value, isContinuous) => {
      const nodeId = editor.selectedId.value
      if (nodeId === null) return
      editor.apply(
        (nodes) => doc.setConfigValue(nodes, nodeId, path, value),
        isContinuous ? mergeKeyOf(nodeId, path.join('.')) : null,
      )
    },
  }
}

/** 写一条绑定；同一个槽的连续输入并成一笔。 */
function writeBindingIn(deps: EditorActionDeps, binding: BindingPayload): void {
  const nodeId = deps.editor.selectedId.value
  if (nodeId === null) return
  deps.editor.apply(
    (nodes) => doc.upsertBinding(nodes, nodeId, binding),
    mergeKeyOf(nodeId, `binding:${binding.fieldKey}`),
  )
}

/** 把挑到的点位写进某条绑定：历史序列写 `detailJson`，其余写 `nodeKey`。 */
function applyPickedPointIn(
  deps: EditorActionDeps,
  fieldKey: string,
  pointKey: string,
): void {
  const node = deps.editor.selected.value
  const current = node?.bindings.find((item) => item.fieldKey === fieldKey)
  if (current === undefined) return
  writeBindingIn(
    deps,
    current.sourceKind === 'archive'
      ? {
          ...current,
          detailJson: {
            nodeKey: pointKey,
            range: current.detailJson?.range ?? { lastWindow: '1h' },
          },
        }
      : { ...current, nodeKey: pointKey },
  )
}

/**
 * 数组槽加一行：把这一行的全部子槽一次建出来，行号紧接现有行。
 * ⚠ 一次建全：只建一个子槽的话，这一行在面板上只出来半行，
 * 而缺的那半行在保存时会被服务端按「索引不连续」整批拒掉。
 */
function addBindingRowIn(deps: EditorActionDeps, slotKey: string): void {
  const node = deps.editor.selected.value
  if (node === null) return
  const spec = deps
    .getManifest(node.moduleType)
    ?.bindings.find((item) => item.key === slotKey)
  if (spec === undefined) return
  const index = arrayRowCount(node.bindings, slotKey)
  deps.editor.apply((nodes) =>
    (spec.arrayFields ?? []).reduce(
      (acc, sub) =>
        doc.upsertBinding(
          acc,
          node.id,
          doc.createBinding(node.id, `${slotKey}[${index}].${sub.key}`),
        ),
      [...nodes],
    ),
  )
}

function createBindingActions(deps: EditorActionDeps): BindingActions {
  const { editor } = deps
  return {
    writeBinding: (binding) => writeBindingIn(deps, binding),
    bindSlot: (fieldKey) => {
      const nodeId = editor.selectedId.value
      if (nodeId === null) return
      editor.apply((nodes) =>
        doc.upsertBinding(nodes, nodeId, doc.createBinding(nodeId, fieldKey)),
      )
    },
    dropSlot: (fieldKey) => {
      const nodeId = editor.selectedId.value
      if (nodeId === null) return
      editor.apply((nodes) => doc.removeBinding(nodes, nodeId, fieldKey))
    },
    addBindingRow: (slotKey) => addBindingRowIn(deps, slotKey),
    removeBindingRow: (slotKey, rowIndex) => {
      const node = editor.selected.value
      if (node === null) return
      editor.apply((nodes) =>
        doc.setBindings(
          nodes,
          node.id,
          withRowRemoved(node.bindings, slotKey, rowIndex),
        ),
      )
    },
    applyPickedPoint: (fieldKey, pointKey) =>
      applyPickedPointIn(deps, fieldKey, pointKey),
  }
}

export function createEditorActions(deps: EditorActionDeps): EditorActions {
  return { ...createNodeActions(deps), ...createBindingActions(deps) }
}
