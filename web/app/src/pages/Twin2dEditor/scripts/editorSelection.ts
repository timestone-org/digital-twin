/**
 * @fileoverview 编辑器的选中：画布上那一条（节点 / 连线 / 标注，三者互斥、可多选）
 * 与「正在编辑哪个样式」那一条，两条**并行**。
 *
 * ⚠ 两条轴故意不合成一个 union：合了之后「选中一个节点」与「正在编辑一个样式」就
 * 只能二选一，而样式面板本来就要在选着节点的时候开着。
 * ⚠ 画布那一条恒定「要么没有、要么是同一类的一批 id」：允许一批里混着节点与连线的
 * 话，右栏就得同时画两种检查器，而那是没有的。
 */
import { computed, shallowRef } from 'vue'
import type { ComputedRef, ShallowRef } from 'vue'

import { TWIN_2D_SELECT_CANVAS } from './types'
import type { Twin2dEntityKind, Twin2dSelection } from './types'

/**
 * 画布上可框选的三类。
 * ⚠ 从 `Twin2dEntityKind` 里取，不另写字面量：五类实体的名字改了这里跟着编译期红。
 */
export type Twin2dPickKind = Extract<
  Twin2dEntityKind,
  'nodes' | 'edges' | 'marks'
>

/** 样式那一条轴上的两类。 */
export type Twin2dStyleKind = Extract<Twin2dEntityKind, 'styles' | 'edgeStyles'>

/**
 * 画布上选中的一批同类实体。
 * ⚠ `ids` 恒非空：一批选空了就是「没有选中」，那一档用 null 表达。
 */
export interface Twin2dPick {
  kind: Twin2dPickKind
  ids: readonly string[]
}

/** 正在编辑哪个样式；与画布选中并行，互不清空。 */
export interface Twin2dStyleFocus {
  kind: Twin2dStyleKind
  id: string
}

export interface Twin2dEditorSelection {
  /** 画布上选中的那一批；null = 一个都没选。 */
  pick: ComputedRef<Twin2dPick | null>
  /** 正在编辑的样式；null = 样式面板落到空态。 */
  styleFocus: ComputedRef<Twin2dStyleFocus | null>
  /**
   * 右栏该画哪一段：没选中时落到画布那一段。
   * ⚠ 多选时取**最后**选中的那个——用户最后点的那一下才是他要看的东西。
   */
  inspect: ComputedRef<Twin2dSelection>
  /** 这一类当前选中的 id；轴上停着别的类时为空表。 */
  idsOf: (kind: Twin2dPickKind) => readonly string[]
  isPicked: (kind: Twin2dPickKind, id: string) => boolean
  /** 单选：整条轴换成这一个。 */
  select: (kind: Twin2dPickKind, id: string) => void
  /**
   * 框选落定：`additive` 为真且同类时并集，否则整批顶替。
   * @param kind 这一批的类别
   * @param ids 命中的 id
   * @param additive 加选（框选时按住 Shift / ⌘）
   */
  selectMany: (
    kind: Twin2dPickKind,
    ids: readonly string[],
    additive: boolean,
  ) => void
  /** ⌘/Ctrl 点击：同类就切换这一个的去留，异类整条轴换过去。 */
  toggle: (kind: Twin2dPickKind, id: string) => void
  /** 点空白：清掉画布那一条，样式那一条不动。 */
  clear: () => void
  focusStyle: (kind: Twin2dStyleKind, id: string) => void
  clearStyleFocus: () => void
  /**
   * 实体被删之后摘掉悬空的 id，两条轴一起扫。
   * ⚠ 不摘的表现是右栏画着一个已经不存在的东西，改哪一项都写不回去且不报错。
   * @param exists 这个 id 还在不在
   */
  prune: (exists: (kind: Twin2dEntityKind, id: string) => boolean) => void
}

/** 轴上停着别的类时交出去的空表；不每次现造，免得下游的 computed 白重算。 */
const NO_IDS: readonly string[] = Object.freeze([])

/** 两条轴的可变状态。 */
interface SelectionState {
  pick: ShallowRef<Twin2dPick | null>
  focus: ShallowRef<Twin2dStyleFocus | null>
}

/**
 * 写画布那一条轴；空表一律归成 null。
 * @param state 两条轴
 * @param kind 类别
 * @param ids 这一批 id
 */
function setPick(
  state: SelectionState,
  kind: Twin2dPickKind,
  ids: readonly string[],
): void {
  state.pick.value = ids.length === 0 ? null : { kind, ids: [...ids] }
}

/**
 * 这一类当前选中的 id。
 * @param state 两条轴
 * @param kind 类别
 */
function pickedIds(
  state: SelectionState,
  kind: Twin2dPickKind,
): readonly string[] {
  const current = state.pick.value
  return current !== null && current.kind === kind ? current.ids : NO_IDS
}

/**
 * ⌘/Ctrl 点击一个实体。
 * @param state 两条轴
 * @param kind 类别
 * @param id 被点的 id
 */
function togglePick(
  state: SelectionState,
  kind: Twin2dPickKind,
  id: string,
): void {
  const current = state.pick.value
  if (current === null || current.kind !== kind) {
    setPick(state, kind, [id])
    return
  }
  const kept = current.ids.filter((item) => item !== id)
  const hit = kept.length !== current.ids.length
  setPick(state, kind, hit ? kept : [...current.ids, id])
}

/**
 * 框选落定。
 * @param state 两条轴
 * @param kind 这一批的类别
 * @param ids 命中的 id
 * @param additive 加选
 */
function mergePick(
  state: SelectionState,
  kind: Twin2dPickKind,
  ids: readonly string[],
  additive: boolean,
): void {
  const current = state.pick.value
  if (!additive || current === null || current.kind !== kind) {
    setPick(state, kind, ids)
    return
  }
  const fresh = ids.filter((id) => !current.ids.includes(id))
  setPick(state, kind, [...current.ids, ...fresh])
}

/**
 * 两条轴一起摘掉悬空的 id。
 * @param state 两条轴
 * @param exists 这个 id 还在不在
 */
function prunePick(
  state: SelectionState,
  exists: (kind: Twin2dEntityKind, id: string) => boolean,
): void {
  const current = state.pick.value
  if (current !== null) {
    setPick(
      state,
      current.kind,
      current.ids.filter((id) => exists(current.kind, id)),
    )
  }
  const style = state.focus.value
  if (style !== null && !exists(style.kind, style.id)) state.focus.value = null
}

/**
 * 右栏该画哪一段。
 * @param pick 画布那一条轴
 */
function inspectOf(pick: Twin2dPick | null): Twin2dSelection {
  const last = pick?.ids.at(-1)
  if (pick === null || last === undefined) return TWIN_2D_SELECT_CANVAS
  return { kind: pick.kind, id: last }
}

/** 造一份选中态。 */
export function createTwin2dSelection(): Twin2dEditorSelection {
  const state: SelectionState = {
    pick: shallowRef<Twin2dPick | null>(null),
    focus: shallowRef<Twin2dStyleFocus | null>(null),
  }

  return {
    pick: computed(() => state.pick.value),
    styleFocus: computed(() => state.focus.value),
    inspect: computed(() => inspectOf(state.pick.value)),
    idsOf: (kind) => pickedIds(state, kind),
    isPicked: (kind, id) => pickedIds(state, kind).includes(id),
    select: (kind, id) => setPick(state, kind, [id]),
    selectMany: (kind, ids, additive) => mergePick(state, kind, ids, additive),
    toggle: (kind, id) => togglePick(state, kind, id),
    clear: () => {
      state.pick.value = null
    },
    focusStyle: (kind, id) => {
      state.focus.value = { kind, id }
    },
    clearStyleFocus: () => {
      state.focus.value = null
    },
    prune: (exists) => prunePick(state, exists),
  }
}
