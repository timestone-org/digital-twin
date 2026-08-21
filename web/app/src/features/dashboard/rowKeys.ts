/**
 * @fileoverview 一列「落库里没有 id」的行的本地稳定 key。
 *
 * ⚠ 拿行内容当 key 会在改字的那一刻整行重挂、输入框当场丢焦点——联动的互斥组
 * （`{value, targets}`）与跳转路由（`{value, target}`）都是这种行。
 * ⚠ 删中间一行必须连着把它那把 uid 也删掉：只靠按长度补齐的话，尾部会被截掉，
 * 余下各行拿到的是前一行的 key，本地状态整体错位。
 */
import { ref, watch, type Ref } from 'vue'

import { newClientUuid } from '@/api/idempotency'

export interface RowKeys {
  /** 与行等长的一串本地 uid，`v-for` 的 key 取它。 */
  keys: Ref<string[]>
  /** 这把 uid 现在是第几行；找不到给 -1。 */
  indexOf: (key: string) => number
  /** 删掉第 index 行那把 uid。 */
  removeAt: (index: number) => void
  /** 交换第 a、b 行的 uid，配合行数据换位使用；任一越界不动。 */
  swapAt: (a: number, b: number) => void
}

/**
 * 造一列跟着行数增减的本地 key。须在 setup 内调用。
 * @param count 当前有几行
 */
export function useRowKeys(count: () => number): RowKeys {
  const keys = ref<string[]>([])

  watch(
    count,
    (next) => {
      while (keys.value.length < next) keys.value.push(newClientUuid())
      if (keys.value.length > next) keys.value.splice(next)
    },
    { immediate: true },
  )

  return {
    keys,
    indexOf: (key) => keys.value.indexOf(key),
    removeAt: (index) => keys.value.splice(index, 1),
    swapAt: (a, b) => {
      const left = keys.value[a]
      const right = keys.value[b]
      if (left === undefined || right === undefined) return
      keys.value[a] = right
      keys.value[b] = left
    },
  }
}
