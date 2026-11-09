/**
 * @fileoverview 文本框的选区与「插一段进去」。
 *
 * ⚠ 选区是这一层唯一的状态，而它**记的是某一份文本里的下标**。文本被整条换掉
 * （比如从分段面拼回来）之后旧下标指向的是完全不同的一段，不重置的话下一次插入
 * 会静默吃掉开头几个字符（docs/DATASET_DESIGN.md §7.6）。
 */

import { nextTick, ref, type Ref } from 'vue'

import { spliceText, type InsertPayload } from './formulaText'

export interface TextInsertion {
  selection: Ref<{ start: number; end: number }>
  /** 选区随时会变（点击、方向键、拖选），统一记下来。 */
  sync: () => void
  /** 文本被整条换掉之后把选区挪到末尾。 */
  moveToEnd: (length: number) => void
  /** 当前选中的那一段；工具箱据此决定套住还是插入。 */
  selected: (text: string) => string
  /** 插一段进去：先经 `commit` 写回新文本，再把焦点与光标还给输入框。 */
  insert: (
    text: string,
    payload: InsertPayload,
    commit: (next: string) => void,
  ) => Promise<void>
}

/**
 * 装上一份选区与插入。
 * @param element 取那个原生 textarea；它随编辑面切换会换人，故是个函数
 */
export function useTextInsertion(
  element: () => HTMLTextAreaElement | null,
): TextInsertion {
  const selection = ref({ start: 0, end: 0 })

  function sync(): void {
    const node = element()
    if (node === null) return
    selection.value = { start: node.selectionStart, end: node.selectionEnd }
  }

  function moveToEnd(length: number): void {
    selection.value = { start: length, end: length }
  }

  function selected(text: string): string {
    return text.slice(selection.value.start, selection.value.end)
  }

  /**
   * 插一段进去。
   * ⚠ 新文本必须在等 DOM 之前写回：先设光标再换内容，浏览器会把光标甩到末尾。
   * @param text 插入前的全文
   * @param payload 要插的片段与片段内的光标
   * @param commit 把新全文写回模型
   */
  async function insert(
    text: string,
    payload: InsertPayload,
    commit: (next: string) => void,
  ): Promise<void> {
    const { start, end } = selection.value
    const next = spliceText(text, start, end, payload.snippet, payload.caret)
    selection.value = { start: next.start, end: next.end }
    commit(next.text)
    await nextTick()
    const node = element()
    if (node !== null) {
      node.focus()
      node.setSelectionRange(next.start, next.end)
    }
  }

  return { selection, sync, moveToEnd, selected, insert }
}
