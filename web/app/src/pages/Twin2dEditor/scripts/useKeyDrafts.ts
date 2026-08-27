/**
 * @fileoverview 寻址键（端口 id、槽位 key）改名时的草稿：逐键只写草稿，失焦才落。
 *
 * ⚠ 这两处的键都是**寻址键**——连线按端口 id 挂、图元与算式按槽键取值，改名等于换一个
 * 东西。逐键写回除了让引用一路跟着抖，还有第二层坏处：键同时是 `v-for` 的 key，每敲一
 * 个字那一行就整行重建一次，焦点当场丢掉，键盘上根本改不完一个名字。
 * ⚠ 落不下去时草稿一并清掉，框自己拨回文档里的值——框里绝不留下一个文档里并不存在的键。
 * ⚠ 重名不写回而不是「后来者覆盖」：归一化按键去重且**留最先那一条**，覆盖的那一份
 * 会在存盘那一刻凭空消失。
 */
import { ref } from 'vue'

/** 改名落不下去时的两句说明。 */
export interface Twin2dKeyMessages {
  /** 空名。 */
  empty: string
  /** 与同一份表里另一条重名。 */
  taken: string
}

/** 一份表上的改名草稿。 */
export interface Twin2dKeyDrafts {
  /** 这一格现在显示什么：正在改就是草稿，没在改就是文档里的键。 */
  textOf: (key: string) => string
  /** 这一格现在为什么落不下去；落得下去时是空串。 */
  errorOf: (key: string) => string
  /** 逐键写草稿，不碰文档。 */
  edit: (key: string, raw: string) => void
  /** 落定：草稿清掉，改得动就交出新键，改不动交出 null。 */
  commit: (key: string) => string | null
  /** 外面换了一份表时清掉全部草稿。 */
  reset: () => void
}

/**
 * 一份寻址键改名草稿。
 * @param keys 取当前这份表里全部的键（含正在改的那一条）
 * @param messages 落不下去时的说明
 */
export function useKeyDrafts(
  keys: () => readonly string[],
  messages: Twin2dKeyMessages,
): Twin2dKeyDrafts {
  const drafts = ref<Record<string, string>>({})

  function isTaken(key: string, next: string): boolean {
    return next !== key && keys().includes(next)
  }

  function textOf(key: string): string {
    return drafts.value[key] ?? key
  }

  function errorOf(key: string): string {
    const draft = drafts.value[key]
    if (draft === undefined) return ''
    const next = draft.trim()
    if (next === '') return messages.empty
    return isTaken(key, next) ? messages.taken : ''
  }

  function edit(key: string, raw: string): void {
    drafts.value = { ...drafts.value, [key]: raw }
  }

  function commit(key: string): string | null {
    const draft = drafts.value[key]
    if (draft === undefined) return null
    const next = draft.trim()
    const rest = { ...drafts.value }
    delete rest[key]
    drafts.value = rest
    if (next === '' || next === key || isTaken(key, next)) return null
    return next
  }

  function reset(): void {
    drafts.value = {}
  }

  return { textOf, errorOf, edit, commit, reset }
}
