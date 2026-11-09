/**
 * @fileoverview 把绑定里的点位身份 `{source_id}:{code}` 解析成「点位名 · 数据源」。
 * 查不到或查失败就给 null，调用方退回原始身份串——宁可难看，也不能显示错的名字。
 */
import {
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  watch,
  type ShallowRef,
} from 'vue'

import { getSource, listPoints } from '@/api/collect'
import { useRacedFetch } from '@/composables/useRacedFetch'

// 按编码搜一页；同源下编码唯一，前缀相近的点位也很难多过这一页
const LOOKUP_PAGE_SIZE = 200
const SEPARATOR = ':'

export interface PointLabel {
  name: string
  /** 数据源名；数据源读不到时为空串。 */
  source: string
}

/**
 * 按身份串查点位名与数据源名。
 * @param nodeKey 点位身份
 * @param signal 换点位或卸载时中止
 */
async function lookup(
  nodeKey: string,
  signal: AbortSignal,
): Promise<PointLabel | null> {
  // ⚠ 只切第一个冒号：source_id 是 UUID 不含冒号，而点位编码可以含
  const at = nodeKey.indexOf(SEPARATOR)
  if (at <= 0) return null
  const sourceId = nodeKey.slice(0, at)
  const code = nodeKey.slice(at + 1)
  const [points, source] = await Promise.all([
    listPoints({ sourceId, q: code, page: 1, size: LOOKUP_PAGE_SIZE }, signal),
    getSource(sourceId, signal).catch(() => null),
  ])
  const point = points.items.find((one) => one.node_key === nodeKey)
  return point === undefined
    ? null
    : { name: point.name, source: source?.name ?? '' }
}

/**
 * @param nodeKey 读当前点位身份的取值函数；空串 = 还没挑
 */
export function usePointLabel(
  nodeKey: () => string,
): ShallowRef<PointLabel | null> {
  const label = shallowRef<PointLabel | null>(null)
  const raced = useRacedFetch()
  if (getCurrentScope() !== undefined) onScopeDispose(raced.cancel)

  watch(
    nodeKey,
    (key) => {
      label.value = null
      if (key === '') {
        raced.cancel()
        return
      }
      void raced.run((signal) => lookup(key, signal), {
        ok: (found) => (label.value = found),
        fail: () => (label.value = null),
        settled: () => undefined,
      })
    },
    { immediate: true },
  )
  return label
}
