/**
 * @fileoverview 撤销重做栈：结构性改动立即成一笔，连续输入按合并键并成一笔。
 *
 * ⚠ 撤销前必须**先关掉待合并的那一笔**（`flush`）：不关的话，撤销之后用户接着
 * 输入，那一笔会并进已经被撤销的状态里，等于把刚撤掉的一步又悄悄改了回去。
 * ⚠ 快照存的是**引用**：文档操作全是不可变的，所以一笔撤销就是换回旧引用；
 * 哪怕有一处就地改，撤销就会「回到自己」而且不报任何错。
 * ⚠ 两条栈是普通数组、深度另用 ref 暴露：塞进 ref 会让读出来的快照退化成
 * `any`，撤销栈里存的是什么就再也没人检查了。
 */

import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue'
import type { DashboardNodePayload } from '@dt/contracts'

/** 一笔快照就是一份完整的节点表。 */
export type EditorSnapshot = readonly DashboardNodePayload[]

/** 栈深上限：编辑器开一整天也不该无限攒快照。 */
const DEFAULT_LIMIT = 100

export interface EditorHistory {
  present: ShallowRef<EditorSnapshot>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /**
   * 记一笔。
   * @param next 新状态
   * @param mergeKey 合并键：与上一笔相同则并进上一笔，`null` 表示结构性改动
   */
  commit: (next: EditorSnapshot, mergeKey?: string | null) => void
  /** 关掉当前的合并窗口，下一笔一定另起一步。 */
  flush: () => void
  undo: () => void
  redo: () => void
  /** 丢掉全部历史，从一个新的基线重新开始（加载完与保存完各一次）。 */
  reset: (value: EditorSnapshot) => void
}

interface HistoryState {
  present: ShallowRef<EditorSnapshot>
  undoDepth: ShallowRef<number>
  redoDepth: ShallowRef<number>
  past: EditorSnapshot[]
  future: EditorSnapshot[]
  openKey: string | null
  limit: number
}

function sync(state: HistoryState): void {
  state.undoDepth.value = state.past.length
  state.redoDepth.value = state.future.length
}

function pushPast(state: HistoryState, value: EditorSnapshot): void {
  state.past.push(value)
  if (state.past.length > state.limit) state.past.shift()
}

function commitTo(
  state: HistoryState,
  next: EditorSnapshot,
  mergeKey: string | null,
): void {
  if (next === state.present.value) return
  if (mergeKey !== null && mergeKey === state.openKey) {
    state.present.value = next
    return
  }
  pushPast(state, state.present.value)
  state.future.length = 0
  state.present.value = next
  state.openKey = mergeKey
  sync(state)
}

function undoIn(state: HistoryState): void {
  // ⚠ 见文件头：不 flush 的话，撤销之后的下一笔输入会并进被撤销的状态
  state.openKey = null
  const previous = state.past.pop()
  if (previous === undefined) return
  state.future.unshift(state.present.value)
  state.present.value = previous
  sync(state)
}

function redoIn(state: HistoryState): void {
  state.openKey = null
  const next = state.future.shift()
  if (next === undefined) return
  pushPast(state, state.present.value)
  state.present.value = next
  sync(state)
}

function resetIn(state: HistoryState, value: EditorSnapshot): void {
  state.past.length = 0
  state.future.length = 0
  state.openKey = null
  state.present.value = value
  sync(state)
}

/**
 * @param initial 初始状态
 * @param limit 栈深上限
 */
export function useEditorHistory(
  initial: EditorSnapshot,
  limit: number = DEFAULT_LIMIT,
): EditorHistory {
  const state: HistoryState = {
    present: shallowRef<EditorSnapshot>(initial),
    undoDepth: shallowRef(0),
    redoDepth: shallowRef(0),
    past: [],
    future: [],
    openKey: null,
    limit,
  }
  return {
    present: state.present,
    canUndo: computed(() => state.undoDepth.value > 0),
    canRedo: computed(() => state.redoDepth.value > 0),
    commit: (next, mergeKey = null) => commitTo(state, next, mergeKey),
    flush: () => {
      state.openKey = null
    },
    undo: () => undoIn(state),
    redo: () => redoIn(state),
    reset: (value) => resetIn(state, value),
  }
}
