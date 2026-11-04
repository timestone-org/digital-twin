/** @fileoverview 写操作刷新后仅纠正失效末页，错误或新请求期间不重复读取。 */
import { expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { AsyncList } from '@/composables/useAsyncList'
import { reloadModelingPage } from '@/pages/Modeling/scripts/reloadModelingPage'

function list(page: number, count: number): AsyncList<{ id: string }> {
  const total = ref(count)
  return {
    items: ref<{ id: string }[]>([]),
    total,
    loading: ref(false),
    error: ref<string | null>(null),
    pager: computed(() => ({ page, size: 20, total: total.value })),
    reload: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    goToPage: vi
      .fn<(value: number) => Promise<void>>()
      .mockResolvedValue(undefined),
    setSize: vi
      .fn<(value: number) => Promise<void>>()
      .mockResolvedValue(undefined),
    reloadFromFirstPage: vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
  }
}

it('普通刷新保留仍有效的当前页', async () => {
  const source = list(2, 35)
  await reloadModelingPage(source)
  expect(source.reload).toHaveBeenCalledTimes(1)
  expect(source.goToPage).not.toHaveBeenCalled()
})

it.each([
  [4, 60, 3],
  [9, 0, 1],
])('失效末页%j修正到真实最后页', async (page, total, expected) => {
  const source = list(page, total)
  await reloadModelingPage(source)
  expect(source.reload).toHaveBeenCalledTimes(1)
  expect(source.goToPage).toHaveBeenCalledExactlyOnceWith(expected)
})

it.each(['error', 'loading'])(
  '读取%s时不做自动重试或改写新查询的页码',
  async (kind) => {
    const source = list(4, 0)
    if (kind === 'error') source.error.value = '服务暂时不可用'
    else source.loading.value = true
    await reloadModelingPage(source)
    expect(source.reload).toHaveBeenCalledTimes(1)
    expect(source.goToPage).not.toHaveBeenCalled()
  },
)
