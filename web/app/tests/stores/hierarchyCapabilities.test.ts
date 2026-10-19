/** @fileoverview 导航与页面共享能力探测，完成后下一次仍重新检查。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/api/hierarchy'
import { useHierarchyCapabilitiesStore } from '@/stores/hierarchyCapabilities'
import { deferred } from '../../src/testing/hierarchyHarness'
import type { HierarchyCapabilities } from '@dt/contracts'
vi.mock('@/api/hierarchy')
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.resetAllMocks())
const result: HierarchyCapabilities = {
  is_enabled: true,
  max_nodes: 300,
  max_edges: 2000,
  history_limit: 50,
}
it('合并同时发出的探测，后续请求不会复用在线状态', async () => {
  const first = deferred<HierarchyCapabilities>()
  vi.mocked(api.capabilities)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(result)
  const store = useHierarchyCapabilitiesStore(),
    navigation = store.load(),
    page = store.load()
  expect(api.capabilities).toHaveBeenCalledTimes(1)
  first.resolve(result)
  expect(await Promise.all([navigation, page])).toEqual([result, result])
  await store.load()
  expect(api.capabilities).toHaveBeenCalledTimes(2)
  store.$dispose()
})
it('失败释放在途请求并保留真实失败，允许明确重新检查', async () => {
  vi.mocked(api.capabilities)
    .mockRejectedValueOnce(new Error('服务不可用'))
    .mockResolvedValueOnce(result)
  const store = useHierarchyCapabilitiesStore()
  await expect(store.load()).rejects.toThrow('服务不可用')
  expect(await store.load()).toEqual(result)
  store.$dispose()
})
