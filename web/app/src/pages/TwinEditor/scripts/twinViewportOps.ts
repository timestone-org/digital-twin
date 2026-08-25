/**
 * @fileoverview 页面与 3D 视口之间的那几个来回：视口里拾取节点 / 位置、
 * 取当前机位存进视点或钻取快照、试飞漫游。
 *
 * ⚠ 拾取是**两段式**的：先记下「点完写回哪个实体的哪个字段」，等视口回调再落。
 * 不记的话，视口只知道用户点了模型上的哪个东西，不知道那一下是给谁点的。
 */
import type { TwinConfig, Vec3 } from '@dt/twin-config'
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { TwinEditorActions } from './twinEditorActions'
import type { TwinEntityKind, TwinSelection } from './types'

/** 相机快照：位置、目标点与视场角。 */
type CameraPose = { position: Vec3; target: Vec3; fov: number }

/**
 * 视口对外的四个命令。
 * ⚠ 手工与 `TwinViewport` 的 `defineExpose` 对齐：`InstanceType<typeof 组件>`
 * 取不到 `defineExpose` 的类型（会塌成 any），写错了 typecheck 与 lint 都不拦。
 */
export interface TwinViewportHandle {
  focus: (selection: TwinSelection) => void
  snapshot: () => CameraPose
  playRoamPreview: () => boolean
  stopRoamPreview: () => void
}

export interface TwinViewportOps {
  /** 挂到 `TwinViewport` 上的 ref。 */
  viewportRef: Ref<TwinViewportHandle | null>
  /** 当前正在等哪种拾取；null = 没在等。 */
  pickMode: ComputedRef<'node' | 'position' | null>
  /** 正在等视口里点一下。 */
  isPicking: ComputedRef<boolean>
  focus: (selection: TwinSelection) => void
  requestPick: (what: 'node' | 'position') => void
  cancelPick: () => void
  onPickNode: (name: string) => void
  onPickPosition: (position: Vec3) => void
  /** 把 Shift 点选或框选的节点追加到当前选中的部件。 */
  onSelectNodes: (names: readonly string[]) => void
  captureCamera: (id: string) => void
  captureHierView: (id: string) => void
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

/** 正在等的那一次拾取。 */
interface PendingPick {
  kind: TwinEntityKind
  id: string
  what: 'node' | 'position'
}

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

/** 带 `nodes` 的两类：部件与钻取节点。其余种类拾取节点名没有意义。 */
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
  if (kind === 'hierNodes') {
    return config.hierNodes.find((item) => item.id === id)?.nodes ?? null
  }
  return null
}

/** 拾取那一路：记下要写回谁，等视口回调再落。 */
function createPicking(
  deps: TwinViewportDeps,
  pending: Ref<PendingPick | null>,
): Pick<
  TwinViewportOps,
  'requestPick' | 'cancelPick' | 'onPickNode' | 'onPickPosition'
> {
  function applyPick(patch: Record<string, unknown>): void {
    const target = pending.value
    pending.value = null
    if (target !== null) patchEntity(deps, target.kind, target.id, patch)
  }

  return {
    requestPick: (what) => {
      const current = deps.selection()
      if (!('id' in current)) return
      pending.value = { kind: current.kind, id: current.id, what }
    },
    cancelPick: () => {
      pending.value = null
    },
    onPickNode: (name) => {
      const target = pending.value
      const nodes =
        target === null ? null : nodesOf(deps, target.kind, target.id)
      if (nodes === null) return
      // 同一个节点点两次不该塞两条进去
      applyPick({ nodes: nodes.includes(name) ? [...nodes] : [...nodes, name] })
    },
    onPickPosition: (position) => applyPick({ position }),
  }
}

/** 取当前机位那一路：存进视点，或存进钻取节点的取景快照。 */
function createCapture(
  deps: TwinViewportDeps,
  viewportRef: Ref<TwinViewportHandle | null>,
): Pick<TwinViewportOps, 'captureCamera' | 'captureHierView'> {
  return {
    captureCamera: (id) => {
      const pose = viewportRef.value?.snapshot()
      if (pose !== undefined) patchEntity(deps, 'cameras', id, { ...pose })
    },
    captureHierView: (id) => {
      const pose = viewportRef.value?.snapshot()
      if (pose !== undefined) patchEntity(deps, 'hierNodes', id, { view: pose })
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
