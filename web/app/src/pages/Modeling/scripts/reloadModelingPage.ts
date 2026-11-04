/** @fileoverview 模型管理写入后刷新当前后端页，并有界纠正已删除的末页。 */
import type { AsyncList } from '@/composables/useAsyncList'

export async function reloadModelingPage<TRow>(
  list: AsyncList<TRow>,
): Promise<void> {
  await list.reload()
  if (list.loading.value || list.error.value !== null) return
  const { page, size } = list.pager.value
  const lastPage = Math.max(1, Math.ceil(list.total.value / size))
  if (page > lastPage) await list.goToPage(lastPage)
}
