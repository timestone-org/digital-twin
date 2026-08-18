/**
 * @fileoverview 排布与剪贴板动作：对齐/分布/整理/层序/批量拖动/复制粘贴再制。
 * 与 `editorActions.ts` 同构——改动全是纯函数，这里只翻译界面操作并定合并键。
 * ⚠ 对齐与分布只对**同父**选中集生效：跨父层坐标系不同，硬算出来的是错位。
 */
import type { DesignSize, GetModuleManifest } from '@dt/runtime'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import {
  alignRects,
  clampRect,
  distributeRects,
  tidyRects,
  type AlignKind,
  type PlacedRect,
} from '@/features/dashboard/canvasAlign'
import * as clipboard from '@/features/dashboard/editorClipboard'
import * as doc from '@/features/dashboard/editorDoc'
import { contentSizeOf } from '@/features/dashboard/editorLayout'
import {
  acceptsChildren,
  isPinnedRegion,
} from '@/features/dashboard/moduleLibrary'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'

export interface ArrangeDeps {
  editor: DashboardEditor
  getManifest: GetModuleManifest
  /** 顶层设计尺寸。 */
  design: () => DesignSize
  /** 整理与找空位的扫描步距，通常取吸附步长。 */
  steps: () => { x: number; y: number }
  /** 当前大屏 id；还没加载出来时给 null。 */
  dashboardId: () => string | null
}

export interface ArrangeActions {
  /** 选中集是否同父且 ≥2 / ≥3，工具栏据此亮灯。 */
  alignReady: () => boolean
  distributeReady: () => boolean
  alignSelected: (kind: AlignKind) => void
  distributeSelected: (axis: 'x' | 'y') => void
  /** 整理顶层布局：消重叠、钳回边界；子层不动。 */
  tidyTopLevel: () => void
  bringSelectedToFront: () => void
  sendSelectedToBack: () => void
  /** 逐层挪：只与紧邻的兄弟换位，到头了就什么都不做。 */
  bringSelectedForward: () => void
  sendSelectedBackward: () => void
  moveNode: (nodeId: string, parentId: string | null, at?: number) => void
  /** 方向键微调：动选中集里的最上层节点，子树跟着根走。 */
  nudgeSelected: (dx: number, dy: number) => void
  /** 画布批量拖动的一帧：per-node 新几何一次落一笔。 */
  changeGeometryBatch: (
    changes: ReadonlyMap<string, NodeGeometry>,
    isContinuous: boolean,
  ) => void
  /** 选中集里有没有可复制的根；右键菜单据此置灰「复制」。 */
  canCopy: () => boolean
  /** 剪贴板里有没有东西；右键菜单据此置灰「粘贴」。 */
  canPaste: () => boolean
  copySelected: () => boolean
  /** 粘贴到目标层（选中容器则粘入其中）；返回是否粘出了东西。 */
  pasteClipboard: () => boolean
  duplicateSelected: () => void
  selectAllTop: () => void
  /** 删掉选中集的最上层节点连各自子树，一次 apply 一步撤销；确认弹窗归页面。 */
  removeSelected: () => void
}

/** 选中集里同父才能对齐；返回同父的选中节点，父不一致给 null。 */
function sameParentSelection(
  editor: DashboardEditor,
): readonly { id: string; geometry: NodeGeometry }[] | null {
  const nodes = editor.selectedNodes.value
  if (nodes.length === 0) return null
  const parent = nodes[0]?.parentId ?? null
  if (nodes.some((node) => (node.parentId ?? null) !== parent)) return null
  return nodes.map((node) => ({
    id: node.id,
    geometry: { x: node.x, y: node.y, w: node.w, h: node.h },
  }))
}

function applyRects(
  editor: DashboardEditor,
  ids: readonly string[],
  rects: readonly NodeGeometry[],
): void {
  const changes = new Map<string, NodeGeometry>()
  ids.forEach((id, index) => {
    const rect = rects[index]
    if (rect !== undefined) changes.set(id, rect)
  })
  editor.apply((nodes) => doc.setGeometryBatch(nodes, changes))
}

/** 粘贴/再制的目标层：选中的是容器就进它，否则顶层。 */
function pasteTarget(deps: ArrangeDeps): {
  parentId: string | null
  bounds: DesignSize
} {
  const host = deps.editor.selected.value
  if (host !== null && acceptsChildren(deps.getManifest(host.moduleType))) {
    return {
      parentId: host.id,
      bounds: contentSizeOf(host, deps.getManifest(host.moduleType)),
    }
  }
  return { parentId: null, bounds: deps.design() }
}

function pasteInto(
  deps: ArrangeDeps,
  payload: clipboard.ClipboardPayload,
  offset: number,
): boolean {
  const dashboardId = deps.dashboardId()
  if (dashboardId === null) return false
  const target = pasteTarget(deps)
  let pastedIds: readonly string[] = []
  deps.editor.apply((nodes) => {
    const result = clipboard.pasteNodes({
      nodes,
      payload,
      dashboardId,
      targetParentId: target.parentId,
      offset,
      zIndexStart: doc.nextZIndex(nodes, target.parentId),
    })
    pastedIds = result.pastedIds
    // 根钳回目标层边界，免得反复粘贴把节点排到画布外找不回来
    const clamped = new Map<string, NodeGeometry>()
    for (const id of result.pastedIds) {
      const node = result.nodes.find((item) => item.id === id)
      if (node === undefined) continue
      clamped.set(
        id,
        clampRect(
          { x: node.x, y: node.y, w: node.w, h: node.h },
          target.bounds,
        ),
      )
    }
    return doc.setGeometryBatch(result.nodes, clamped)
  })
  if (pastedIds.length > 0) deps.editor.setSelection(pastedIds)
  return pastedIds.length > 0
}

/** 钉位单例：整理与复制都要把它排除在外。 */
function isRegionType(deps: ArrangeDeps, moduleType: string): boolean {
  return isPinnedRegion(deps.getManifest(moduleType))
}

/** 整理顶层布局：消重叠、钳回边界；子层与钉位区不动。 */
function tidyTop(deps: ArrangeDeps): void {
  const steps = deps.steps()
  deps.editor.apply((nodes) => {
    const top: PlacedRect[] = nodes
      .filter(
        (node) =>
          node.parentId === null && !isRegionType(deps, node.moduleType),
      )
      .map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
      }))
    const tidied = tidyRects(top, deps.design(), steps.x, steps.y)
    return doc.setGeometryBatch(
      nodes,
      new Map(tidied.map((rect) => [rect.id, rect])),
    )
  })
}

/** 对齐、分布与整理：只对同父选中集生效。 */
function alignActions(
  deps: ArrangeDeps,
): Pick<
  ArrangeActions,
  | 'alignReady'
  | 'distributeReady'
  | 'alignSelected'
  | 'distributeSelected'
  | 'tidyTopLevel'
> {
  const { editor } = deps

  return {
    alignReady: () => {
      const selection = sameParentSelection(editor)
      return selection !== null && selection.length >= 2
    },
    distributeReady: () => {
      const selection = sameParentSelection(editor)
      return selection !== null && selection.length >= 3
    },
    alignSelected: (kind) => {
      const selection = sameParentSelection(editor)
      if (selection === null || selection.length < 2) return
      applyRects(
        editor,
        selection.map((item) => item.id),
        alignRects(
          selection.map((item) => item.geometry),
          kind,
        ),
      )
    },
    distributeSelected: (axis) => {
      const selection = sameParentSelection(editor)
      if (selection === null || selection.length < 3) return
      applyRects(
        editor,
        selection.map((item) => item.id),
        distributeRects(
          selection.map((item) => item.geometry),
          axis,
        ),
      )
    },
    tidyTopLevel: () => {
      tidyTop(deps)
    },
  }
}

/** 方向键微调：只动选中集里的最上层节点，子树跟着根走，连按并成一笔。 */
function nudgeBy(editor: DashboardEditor, dx: number, dy: number): void {
  const ids = doc.topMostIds(editor.nodes.value, editor.selectedIds.value)
  if (ids.length === 0) return
  const wanted = new Set(ids)
  editor.apply(
    (nodes) =>
      doc.setGeometryBatch(
        nodes,
        new Map(
          nodes
            .filter((node) => wanted.has(node.id))
            .map((node) => [
              node.id,
              { x: node.x + dx, y: node.y + dy, w: node.w, h: node.h },
            ]),
        ),
      ),
    'nudge',
  )
}

/**
 * 逐层挪整个选中集。
 * ⚠ 先动挪向那一头最外侧的那个：反过来的话，同层的两个选中节点会在换位时
 * 互相顶掉一格，看起来像「按一下只动了一个」。
 * @param step 1 = 上移一层，-1 = 下移一层
 */
function stepSelected(deps: ArrangeDeps, step: 1 | -1): void {
  const { editor } = deps
  const nodes = editor.nodes.value
  const indexOf = (id: string): number =>
    doc.layerPositionOf(nodes, id)?.index ?? 0
  const ids = [...doc.topMostIds(nodes, editor.selectedIds.value)].sort(
    (left, right) =>
      step > 0
        ? indexOf(right) - indexOf(left)
        : indexOf(left) - indexOf(right),
  )
  editor.apply((current) =>
    ids.reduce(
      (acc, id) =>
        step > 0 ? doc.bringForward(acc, id) : doc.sendBackward(acc, id),
      [...current],
    ),
  )
}

/** 层序与换父。 */
function orderActions(
  deps: ArrangeDeps,
): Pick<
  ArrangeActions,
  | 'bringSelectedToFront'
  | 'sendSelectedToBack'
  | 'bringSelectedForward'
  | 'sendSelectedBackward'
  | 'moveNode'
> {
  const { editor } = deps

  return {
    bringSelectedForward: () => {
      stepSelected(deps, 1)
    },
    sendSelectedBackward: () => {
      stepSelected(deps, -1)
    },
    bringSelectedToFront: () => {
      const ids = doc.topMostIds(editor.nodes.value, editor.selectedIds.value)
      editor.apply((nodes) =>
        ids.reduce((acc, id) => doc.bringToFront(acc, id), [...nodes]),
      )
    },
    sendSelectedToBack: () => {
      const ids = doc.topMostIds(editor.nodes.value, editor.selectedIds.value)
      editor.apply((nodes) =>
        ids.reduce((acc, id) => doc.sendToBack(acc, id), [...nodes]),
      )
    },
    moveNode: (nodeId, parentId, at) => {
      editor.apply((nodes) => doc.moveNode(nodes, nodeId, parentId, at))
    },
  }
}

/** 批量：方向键微调、拖动落笔、整层选中与删除。 */
function batchActions(
  deps: ArrangeDeps,
): Pick<
  ArrangeActions,
  'nudgeSelected' | 'changeGeometryBatch' | 'selectAllTop' | 'removeSelected'
> {
  const { editor } = deps

  return {
    nudgeSelected: (dx, dy) => {
      nudgeBy(editor, dx, dy)
    },
    changeGeometryBatch: (changes, isContinuous) => {
      editor.apply(
        (nodes) => doc.setGeometryBatch(nodes, changes),
        'geometry-batch',
      )
      if (!isContinuous) editor.flush()
    },
    selectAllTop: () => {
      editor.setSelection(
        editor.nodes.value
          .filter((node) => node.parentId === null)
          .map((node) => node.id),
      )
    },
    removeSelected: () => {
      const ids = doc.topMostIds(editor.nodes.value, editor.selectedIds.value)
      if (ids.length === 0) return
      editor.apply((nodes) =>
        ids.reduce((acc, id) => doc.removeSubtree(acc, id), [...nodes]),
      )
    },
  }
}

/** 由当前选中集构建剪贴板 payload；没有可复制的根时给 null。 */
function payloadOf(deps: ArrangeDeps): clipboard.ClipboardPayload | null {
  return clipboard.buildClipboardPayload(
    deps.editor.nodes.value,
    deps.editor.selectedIds.value,
    (moduleType) => isRegionType(deps, moduleType),
  )
}

/** 复制、粘贴与再制。 */
function clipboardActions(
  deps: ArrangeDeps,
): Pick<
  ArrangeActions,
  | 'canCopy'
  | 'canPaste'
  | 'copySelected'
  | 'pasteClipboard'
  | 'duplicateSelected'
> {
  return {
    canCopy: () => payloadOf(deps) !== null,
    canPaste: () => clipboard.readClipboard() !== null,
    copySelected: () => {
      const payload = payloadOf(deps)
      if (payload === null) return false
      clipboard.writeClipboard(payload)
      return true
    },
    pasteClipboard: () => {
      const payload = clipboard.readClipboard()
      if (payload === null) return false
      return pasteInto(deps, payload, clipboard.nextPasteOffset())
    },
    duplicateSelected: () => {
      // 再制不动剪贴板：⌘C 复制的东西在 ⌘D 之后还应当粘得出来
      const payload = payloadOf(deps)
      if (payload !== null) pasteInto(deps, payload, 16)
    },
  }
}

export function createArrangeActions(deps: ArrangeDeps): ArrangeActions {
  return {
    ...alignActions(deps),
    ...orderActions(deps),
    ...batchActions(deps),
    ...clipboardActions(deps),
  }
}
