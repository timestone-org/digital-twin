/**
 * @fileoverview 页面与 3D 视口之间的两段式拾取、新实体放置与机位快照。
 */
import type {
  TwinConfig,
  TwinDistanceRef,
  TwinFocusView,
  Vec3,
} from '@dt/twin-config'
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

import type { TwinEditorActions } from './twinEditorActions'
import { TWIN_ENTITY_LABELS } from './types'
import type { TwinEntityKind, TwinPlaceableKind, TwinSelection } from './types'

/** 相机快照：位置、目标点与视场角。 */
type CameraPose = { position: Vec3; target: Vec3; fov: number }

/**
 * 视口对外的那几个命令。
 * ⚠ 手工与 `TwinViewport` 的 `defineExpose` 对齐：`InstanceType<typeof 组件>`
 * 取不到 `defineExpose` 的类型（会塌成 any），写错了 typecheck 与 lint 都不拦。
 */
export interface TwinViewportHandle {
  isolatePart?: (id: string | null) => void
  restoreView?: (pose: CameraPose) => void
  focus: (selection: TwinSelection) => void
  snapshot: () => CameraPose
  measureDistance: (ref: TwinDistanceRef) => number | null
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
  /** 新建实体的放置提示；普通拾取沿用视口默认文案。 */
  placementHint: ComputedRef<string | undefined>
  requestPick: (what: 'node' | 'position') => void
  /** 先拾取位置，再新建实体并归入请求时指定的文件夹。 */
  requestPlace: (kind: TwinPlaceableKind, folderId?: string) => void
  cancelPick: () => void
  onPickNode: (name: string) => void
  onPickPosition: (position: Vec3) => void
  /** 把 Shift 点选或框选的节点追加到当前选中的部件。 */
  onSelectNodes: (names: readonly string[]) => void
  captureCamera: (id: string) => void
  capturePartView: (id: string) => void
  savePartDetailView: (change: {
    partId: string
    view: TwinFocusView | null
  }) => void
  /** 按参考系量当前相机离选中实体多远；量不出给 null。 */
  measureDistance: (ref: TwinDistanceRef) => number | null
}

export interface TwinViewportDeps {
  config: () => TwinConfig | null
  actions: () => Pick<TwinEditorActions, 'patchConfig' | 'addAt'> | null
  selection: () => TwinSelection
}

/** 正在等的那一次拾取：写回已有实体的某个字段。 */
interface PendingPatchPick {
  kind: TwinEntityKind
  id: string
  what: 'node' | 'position'
}

/** 正在等的那一次拾取：按拾取点新建实体。 */
interface PendingPlacePick {
  what: 'position'
  place: TwinPlaceableKind
  folderId: string | undefined
}

type PendingPick = PendingPatchPick | PendingPlacePick

/** 拾取位置保留的小数位数：毫单位，够摆放又不把射线的满精度浮点写进库。 */
const PICK_SCALE = 1000

/**
 * 拾取点按毫单位取整；`-0` 归成 0。
 * @param position 射线命中的世界坐标
 */
function roundedPick(position: Vec3): Vec3 {
  const round = (value: number): number =>
    Math.round(value * PICK_SCALE) / PICK_SCALE || 0
  return [round(position[0]), round(position[1]), round(position[2])]
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

/** 记下写回目标或新建种类，等视口回调再写入。 */
function createPicking(
  deps: TwinViewportDeps,
  pending: Ref<PendingPick | null>,
): Pick<
  TwinViewportOps,
  | 'requestPick'
  | 'requestPlace'
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
    requestPlace: (kind, folderId) => {
      pending.value = { what: 'position', place: kind, folderId }
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
    onPickPosition: (picked) => {
      const position = roundedPick(picked)
      const target = pending.value
      pending.value = null
      if (target === null) return
      if ('place' in target) {
        deps.actions()?.addAt(target.place, position, target.folderId)
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
): Pick<
  TwinViewportOps,
  'captureCamera' | 'capturePartView' | 'savePartDetailView'
> {
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
      patchEntity(deps, 'parts', id, {
        click: { ...part.click, view: pose, viewSource: 'snapshot' },
      })
    },
    savePartDetailView: ({ partId, view }) => {
      const part = deps.config()?.parts.find((item) => item.id === partId)
      if (part === undefined) return
      patchEntity(deps, 'parts', partId, { detail: { ...part.detail, view } })
    },
  }
}

/**
 * 装上视口这一路的动作。
 * @param deps 配置、动作集与当前选中
 */
export function createTwinViewportOps(deps: TwinViewportDeps): TwinViewportOps {
  const viewportRef = ref<TwinViewportHandle | null>(null)
  const pending = ref<PendingPick | null>(null)
  // ⚠ 写回已有实体的拾取跟着选中走：换了选中还留着的话，检查器里看到的是另一个实体
  //   在拾取，点下去却改了原来那个。放置不受影响——新实体本来就还不在选中里
  watch(
    () => {
      const current = deps.selection()
      return 'id' in current ? `${current.kind}:${current.id}` : current.kind
    },
    () => {
      const target = pending.value
      if (target !== null && !('place' in target)) pending.value = null
    },
  )

  return {
    ...createPicking(deps, pending),
    ...createCapture(deps, viewportRef),
    viewportRef,
    pickMode: computed(() => pending.value?.what ?? null),
    isPicking: computed(() => pending.value !== null),
    placementHint: computed(() => {
      const target = pending.value
      return target !== null && 'place' in target
        ? `点击模型表面或地面，设置新${TWIN_ENTITY_LABELS[target.place]}的位置`
        : undefined
    }),
    measureDistance: (ref) => viewportRef.value?.measureDistance(ref) ?? null,
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
  }
}
