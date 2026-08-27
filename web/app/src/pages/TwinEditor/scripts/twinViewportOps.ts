/**
 * @fileoverview 页面与 3D 视口之间的那几个来回：视口里拾取节点 / 位置、
 * 取当前机位存进视点或部件的取景快照、试飞漫游。
 *
 * ⚠ 拾取是**两段式**的：先记下「点完写回哪个实体的哪个字段」（或「点完落一张
 * 新信息牌」），等视口回调再落。不记的话，视口只知道用户点了模型上的哪个东西，
 * 不知道那一下是给谁点的。
 */
import type { TwinConfig, Vec3 } from '@dt/twin-config'
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { TwinEditorActions } from './twinEditorActions'
import type { TwinEntityKind, TwinSelection } from './types'

/** 相机快照：位置、目标点与视场角。 */
type CameraPose = { position: Vec3; target: Vec3; fov: number }

/**
 * 视口对外的那几个命令。
 * ⚠ 手工与 `TwinViewport` 的 `defineExpose` 对齐：`InstanceType<typeof 组件>`
 * 取不到 `defineExpose` 的类型（会塌成 any），写错了 typecheck 与 lint 都不拦。
 */
export interface TwinViewportHandle {
  focus: (selection: TwinSelection) => void
  snapshot: () => CameraPose
  playRoamPreview: () => boolean
  stopRoamPreview: () => void
  /** 视口的宿主元素；助手截图拿它当截图根。 */
  stageEl: () => HTMLElement | null
}

export interface TwinViewportOps {
  /** 挂到 `TwinViewport` 上的 ref。 */
  viewportRef: Ref<TwinViewportHandle | null>
  /** 当前正在等哪种拾取；null = 没在等。 */
  pickMode: ComputedRef<'node' | 'position' | null>
  /** 正在等视口里点一下。 */
  isPicking: ComputedRef<boolean>
  /** 正在等「点一下落新牌」；提示语与写回目标都和普通位置拾取不同。 */
  isPlacingPanel: ComputedRef<boolean>
  focus: (selection: TwinSelection) => void
  requestPick: (what: 'node' | 'position') => void
  /** 进入「先点位置再落牌」：下一次位置拾取新建信息牌而不是写回选中实体。 */
  requestPlacePanel: () => void
  cancelPick: () => void
  onPickNode: (name: string) => void
  onPickPosition: (position: Vec3) => void
  /** 把 Shift 点选或框选的节点追加到当前选中的部件。 */
  onSelectNodes: (names: readonly string[]) => void
  captureCamera: (id: string) => void
  capturePartView: (id: string) => void
  previewRoam: () => void
  stopRoamPreview: () => void
}

export interface TwinViewportDeps {
  config: () => TwinConfig | null
  actions: () => TwinEditorActions | null
  selection: () => TwinSelection
  /** 轨迹上可用站点不足两个，飞不起来。 */
  onRoamUnavailable: () => void
}

/** 正在等的那一次拾取：写回已有实体的某个字段。 */
interface PendingPatchPick {
  kind: TwinEntityKind
  id: string
  what: 'node' | 'position'
}

/** 正在等的那一次拾取：按拾取点新建一张信息牌。 */
interface PendingPlacePick {
  what: 'position'
  place: 'panels'
}

type PendingPick = PendingPatchPick | PendingPlacePick

/** 换掉某一类实体里指定 id 的那一项，其余原样。 */
function patchEntity(
  deps: TwinViewportDeps,
  kind: TwinEntityKind,
  id: string,
  patch: Record<string, unknown>,
): void {
  const act = deps.actions()
  const config = deps.config()
  if (act === null || config === null) return
  const list: readonly { id: string }[] = config[kind]
  if (!list.some((item) => item.id === id)) return
  act.patchConfig({
    [kind]: list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  })
}

/** 只有部件带 `nodes`；其余种类拾取节点名没有意义。 */
function nodesOf(
  deps: TwinViewportDeps,
  kind: TwinEntityKind,
  id: string,
): readonly string[] | null {
  const config = deps.config()
  if (config === null) return null
  if (kind === 'parts') {
    return config.parts.find((item) => item.id === id)?.nodes ?? null
  }
  return null
}

/** 拾取那一路：记下「写回谁」或「要落一张新牌」，等视口回调再落。 */
function createPicking(
  deps: TwinViewportDeps,
  pending: Ref<PendingPick | null>,
): Pick<
  TwinViewportOps,
  | 'requestPick'
  | 'requestPlacePanel'
  | 'cancelPick'
  | 'onPickNode'
  | 'onPickPosition'
> {
  return {
    requestPick: (what) => {
      const current = deps.selection()
      if (!('id' in current)) return
      pending.value = { kind: current.kind, id: current.id, what }
    },
    requestPlacePanel: () => {
      pending.value = { what: 'position', place: 'panels' }
    },
    cancelPick: () => {
      pending.value = null
    },
    onPickNode: (name) => {
      const target = pending.value
      if (target === null || 'place' in target) return
      const nodes = nodesOf(deps, target.kind, target.id)
      if (nodes === null) return
      pending.value = null
      // 同一个节点点两次不该塞两条进去
      patchEntity(deps, target.kind, target.id, {
        nodes: nodes.includes(name) ? [...nodes] : [...nodes, name],
      })
    },
    onPickPosition: (position) => {
      const target = pending.value
      pending.value = null
      if (target === null) return
      if ('place' in target) {
        deps.actions()?.addPanelAt(position)
        return
      }
      patchEntity(deps, target.kind, target.id, { position })
    },
  }
}

/** 取当前机位那一路：存进视点，或存进部件的取景快照。 */
function createCapture(
  deps: TwinViewportDeps,
  viewportRef: Ref<TwinViewportHandle | null>,
): Pick<TwinViewportOps, 'captureCamera' | 'capturePartView'> {
  return {
    captureCamera: (id) => {
      const pose = viewportRef.value?.snapshot()
      if (pose !== undefined) patchEntity(deps, 'cameras', id, { ...pose })
    },
    capturePartView: (id) => {
      const pose = viewportRef.value?.snapshot()
      if (pose === undefined) return
      const part = deps.config()?.parts.find((item) => item.id === id)
      if (part === undefined) return
      // ⚠ 整段 `click` 一起写回：只发一个 `view` 会把远近两档的动作抹成缺省
      patchEntity(deps, 'parts', id, { click: { ...part.click, view: pose } })
    },
  }
}

/**
 * 装上视口这一路的动作。
 * @param deps 配置、动作集、当前选中，以及漫游飞不起来时怎么报
 */
export function createTwinViewportOps(deps: TwinViewportDeps): TwinViewportOps {
  const viewportRef = ref<TwinViewportHandle | null>(null)
  const pending = ref<PendingPick | null>(null)

  return {
    ...createPicking(deps, pending),
    ...createCapture(deps, viewportRef),
    viewportRef,
    pickMode: computed(() => pending.value?.what ?? null),
    isPicking: computed(() => pending.value !== null),
    isPlacingPanel: computed(
      () => pending.value !== null && 'place' in pending.value,
    ),
    focus: (selection) => viewportRef.value?.focus(selection),
    onSelectNodes: (names) => {
      const current = deps.selection()
      if (current.kind !== 'parts') return
      const nodes = nodesOf(deps, current.kind, current.id)
      if (nodes === null) return
      const next = [
        ...new Set([...nodes, ...names.filter((name) => name !== '')]),
      ]
      // 没有新增节点就不制造一条空撤销记录。
      if (next.length === nodes.length) return
      patchEntity(deps, current.kind, current.id, { nodes: next })
    },
    // 飞不起来（站点不够）就直说，不留一个没反应的按钮
    previewRoam: () => {
      if (viewportRef.value?.playRoamPreview() === false) {
        deps.onRoamUnavailable()
      }
    },
    stopRoamPreview: () => viewportRef.value?.stopRoamPreview(),
  }
}
