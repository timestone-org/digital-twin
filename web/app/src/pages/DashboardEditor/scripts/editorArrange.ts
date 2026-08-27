/**
 * @fileoverview 排布与剪贴板动作：对齐/分布/整理/层序/批量拖动/复制粘贴再制。
 * 复制粘贴同时搬两条轴：节点树在编辑器里，联动规则在大屏级 chromeJson 里。
 * 与 `editorActions.ts` 同构——改动全是纯函数，这里只翻译界面操作并定合并键。
 * ⚠ 对齐与分布只对**同父**选中集生效：跨父层坐标系不同，硬算出来的是错位。
 */
import type { InteractionRule } from '@dt/contracts'
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
import type {
  EditorGridConfig,
  SnapConfig,
} from '@/features/dashboard/canvasSnap'
import * as clipboard from '@/features/dashboard/editorClipboard'
import * as doc from '@/features/dashboard/editorDoc'
import { contentSizeOf } from '@/features/dashboard/editorLayout'
import {
  acceptsChildren,
  isPinnedRegion,
} from '@/features/dashboard/moduleLibrary'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import type { EditorChrome } from './useEditorChrome'

/** 外观轴要用到的那一小片：规则表读写给剪贴板，吸附/栅格 setter 给草稿恢复。 */
export type ArrangeChrome = Pick<
  EditorChrome,
  'rules' | 'setInteractions' | 'setSnap' | 'setGrid'
>

/** 统一尺寸的三档：等宽 / 等高 / 等尺寸。 */
export type SizeMatchMode = 'width' | 'height' | 'both'

/** 右键菜单粘贴的落点：目标层与该层局部坐标（包围盒左上角要挪到的位置）。 */
export interface PastePoint {
  parentId: string | null
  x: number
  y: number
  layer: DesignSize
}

export interface ArrangeDeps {
  editor: DashboardEditor
  getManifest: GetModuleManifest
  /** 顶层设计尺寸。 */
  design: () => DesignSize
  /** 整理与找空位的扫描步距，通常取吸附步长。 */
  steps: () => { x: number; y: number }
  /** 当前大屏 id；还没加载出来时给 null。 */
  dashboardId: () => string | null
  /** 大屏级外观轴：复制粘贴要连联动规则一起搬。 */
  chrome: ArrangeChrome
  /** 复制/粘贴结果的提示出口，页面接 toast。 */
  notify: (message: string) => void
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
  /** 统一选中集的尺寸到主选中（选中集末位），只改 w/h 不动 x/y。 */
  matchSelectedSize: (mode: SizeMatchMode) => void
  /** 选中集里有没有可复制的根；右键菜单据此置灰「复制」。 */
  canCopy: () => boolean
  /** 剪贴板里有没有东西；右键菜单据此置灰「粘贴」。 */
  canPaste: () => boolean
  copySelected: () => boolean
  /**
   * 粘贴；没粘出东西时提示并返回 false。
   * @param at 右键菜单给的落点：粘到该层该点；不给时按选中容器/顶层加序号偏移
   */
  pasteClipboard: (at?: PastePoint) => boolean
  duplicateSelected: () => void
  selectAllTop: () => void
  /** 删掉选中集的最上层节点连各自子树，一次 apply 一步撤销；确认弹窗归页面。 */
  removeSelected: () => void
  /** 草稿恢复的回灌口：chromeJson.editor 段（吸附/栅格）经 chrome 的归一化 setter 写回。 */
  restoreEditorSection: (section: unknown) => void
}

/** 选中集里同父才能对齐；返回同父的选中节点，父不一致给 null。 */
function sameParentSelection(
  deps: ArrangeDeps,
): readonly { id: string; geometry: NodeGeometry }[] | null {
  // 钉位节点整个排除在外：对齐一次就能把页头从顶部挪走，而钉位的意思正是挪不走
  const nodes = deps.editor.selectedNodes.value.filter(
    (node) => !isRegionType(deps, node.moduleType),
  )
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

/** 落点粘贴的整组平移量：载荷里根节点的包围盒左上角对齐到落点，组内相对位置不变。 */
function pasteShift(
  payload: clipboard.ClipboardPayload,
  at: PastePoint,
): { dx: number; dy: number } {
  const roots = payload.nodes.filter((node) => node.parentCk === null)
  if (roots.length === 0) return { dx: 0, dy: 0 }
  const left = Math.min(...roots.map((node) => node.x))
  const top = Math.min(...roots.map((node) => node.y))
  return { dx: at.x - left, dy: at.y - top }
}

function pasteInto(
  deps: ArrangeDeps,
  payload: clipboard.ClipboardPayload,
  offset: number,
  at?: PastePoint,
): boolean {
  const dashboardId = deps.dashboardId()
  if (dashboardId === null) return false
  const target =
    at === undefined
      ? pasteTarget(deps)
      : { parentId: at.parentId, bounds: at.layer }
  const shift = at === undefined ? { dx: 0, dy: 0 } : pasteShift(payload, at)
  let pastedIds: readonly string[] = []
  let pastedRules: readonly InteractionRule[] = []
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
    pastedRules = result.rules
    // 根钳回目标层边界，免得反复粘贴把节点排到画布外找不回来
    const clamped = new Map<string, NodeGeometry>()
    for (const id of result.pastedIds) {
      const node = result.nodes.find((item) => item.id === id)
      if (node === undefined) continue
      clamped.set(
        id,
        clampRect(
          { x: node.x + shift.dx, y: node.y + shift.dy, w: node.w, h: node.h },
          target.bounds,
        ),
      )
    }
    return doc.setGeometryBatch(result.nodes, clamped)
  })
  if (pastedIds.length > 0) deps.editor.setSelection(pastedIds)
  // ⚠ 规则走的是元数据轴，与节点各记各的撤销：撤销粘贴只退掉节点，规则留在表里
  // 指向已不存在的节点——与「删掉一个被联动指向的节点」是同一种既有状态，不渲染也不报错
  if (pastedRules.length > 0) {
    deps.chrome.setInteractions([...deps.chrome.rules.value, ...pastedRules])
  }
  return pastedIds.length > 0
}

/** 钉位单例：整理、对齐、方向键与复制都要把它排除在外。 */
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
      const selection = sameParentSelection(deps)
      return selection !== null && selection.length >= 2
    },
    distributeReady: () => {
      const selection = sameParentSelection(deps)
      return selection !== null && selection.length >= 3
    },
    alignSelected: (kind) => {
      const selection = sameParentSelection(deps)
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
      const selection = sameParentSelection(deps)
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

/**
 * 方向键微调：只动选中集里的最上层节点，子树跟着根走，连按并成一笔。
 * ⚠ 钉位节点不跟着动——方向键是另一条能把页头从顶部挪走的路。
 */
function nudgeBy(deps: ArrangeDeps, dx: number, dy: number): void {
  const { editor } = deps
  const ids = doc
    .topMostIds(editor.nodes.value, editor.selectedIds.value)
    .filter(
      (id) => !isRegionType(deps, doc.moduleTypeOf(editor.nodes.value, id)),
    )
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

/** 选中集统一到主选中尺寸的几何改动表；基准自己不动。 */
function sizeMatchChanges(
  editor: DashboardEditor,
  mode: SizeMatchMode,
): Map<string, NodeGeometry> {
  const base = editor.selected.value
  const changes = new Map<string, NodeGeometry>()
  if (base === null) return changes
  for (const node of editor.selectedNodes.value) {
    if (node.id === base.id) continue
    changes.set(node.id, {
      x: node.x,
      y: node.y,
      w: mode === 'height' ? node.w : base.w,
      h: mode === 'width' ? node.h : base.h,
    })
  }
  return changes
}

/** 批量：方向键微调、拖动落笔、统一尺寸、整层选中与删除。 */
function batchActions(
  deps: ArrangeDeps,
): Pick<
  ArrangeActions,
  | 'nudgeSelected'
  | 'changeGeometryBatch'
  | 'matchSelectedSize'
  | 'selectAllTop'
  | 'removeSelected'
> {
  const { editor } = deps

  return {
    nudgeSelected: (dx, dy) => {
      nudgeBy(deps, dx, dy)
    },
    changeGeometryBatch: (changes, isContinuous) => {
      editor.apply(
        (nodes) => doc.setGeometryBatch(nodes, changes),
        'geometry-batch',
      )
      if (!isContinuous) editor.flush()
    },
    matchSelectedSize: (mode) => {
      const changes = sizeMatchChanges(editor, mode)
      if (changes.size === 0) return
      editor.apply((nodes) => doc.setGeometryBatch(nodes, changes))
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

/** 由当前选中集构建剪贴板草稿；没有可复制的根时给 null。 */
function draftOf(deps: ArrangeDeps): clipboard.ClipboardDraft | null {
  return clipboard.buildClipboardPayload(
    deps.editor.nodes.value,
    deps.editor.selectedIds.value,
    (moduleType) => isRegionType(deps, moduleType),
    deps.chrome.rules.value,
  )
}

/** 复制的回执：带走了什么，以及有没有联动规则没跟过来。 */
function copyMessage(draft: clipboard.ClipboardDraft): string {
  const roots = draft.payload.nodes.filter(
    (item) => item.parentCk === null,
  ).length
  const rules = draft.payload.rules.length
  const carried = rules === 0 ? '' : `与 ${rules} 条联动规则`
  const dropped =
    draft.droppedRules === 0
      ? ''
      : `；另有 ${draft.droppedRules} 条联动规则指向没一起复制的模块，没跟过来`
  return `已复制 ${roots} 个模块${carried}，可切到其他大屏粘贴${dropped}`
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
    canCopy: () => draftOf(deps) !== null,
    canPaste: () => clipboard.readClipboard() !== null,
    copySelected: () => {
      const draft = draftOf(deps)
      if (draft === null) return false
      clipboard.writeClipboard(draft.payload)
      deps.notify(copyMessage(draft))
      return true
    },
    pasteClipboard: (at) => {
      const payload = clipboard.readClipboard()
      // 落点粘贴不吃序号偏移：包围盒左上角就该落在指的那个点上
      const pasted =
        payload !== null &&
        pasteInto(
          deps,
          payload,
          at === undefined ? clipboard.nextPasteOffset() : 0,
          at,
        )
      if (!pasted) deps.notify('剪贴板里没有可粘贴的模块')
      return pasted
    },
    duplicateSelected: () => {
      // 再制不动剪贴板：⌘C 复制的东西在 ⌘D 之后还应当粘得出来
      const draft = draftOf(deps)
      if (draft !== null) pasteInto(deps, draft.payload, 16)
    },
  }
}

export function createArrangeActions(deps: ArrangeDeps): ArrangeActions {
  return {
    ...alignActions(deps),
    ...orderActions(deps),
    ...batchActions(deps),
    ...clipboardActions(deps),
    restoreEditorSection: (section) => {
      const isBag =
        typeof section === 'object' &&
        section !== null &&
        !Array.isArray(section)
      // 段内深形状交给 normalizeSnapConfig / normalizeEditorGrid 兜底，这里只挡非对象
      const shape: {
        snap?: Partial<SnapConfig>
        grid?: Partial<EditorGridConfig>
      } = isBag ? section : {}
      deps.chrome.setSnap(shape.snap ?? {})
      deps.chrome.setGrid(shape.grid ?? {})
    },
  }
}
