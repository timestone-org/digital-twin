/** @fileoverview 已建点位索引的分页、降级与取消。 */
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { CollectPoint } from '@dt/contracts'
import * as collectApi from '@/api/collect'
import { useBrowseTaken } from '@/pages/Collect/scripts/useBrowseTaken'

function point(code: string): CollectPoint {
  return {
    id: code,
    source_id: 's1',
    node_key: `s1:${code}`,
    code,
    name: code,
    address: `ns=2;s=${code}`,
    data_type: 'float',
    unit: null,
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60000,
    archive_retention_days: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }
}

function render() {
  return mount(
    defineComponent({
      setup() {
        const taken = useBrowseTaken(() => 's1')
        void taken.load()
        return taken
      },
      template:
        '<p>{{ [...addresses].join(",") }}|{{ [...codes].join(",") }}</p>',
    }),
  )
}

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

describe('已建点位索引', () => {
  it('读完所有分页后才发布完整地址与编码集合', async () => {
    vi.spyOn(collectApi, 'listPoints')
      .mockResolvedValueOnce({
        items: [point('a')],
        page: 1,
        size: 100,
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [point('b')],
        page: 2,
        size: 100,
        total: 2,
      })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toBe('ns=2;s=a,ns=2;s=b|a,b')
    expect(collectApi.listPoints).toHaveBeenLastCalledWith(
      { sourceId: 's1', page: 2, size: 100 },
      expect.any(AbortSignal),
    )
  })

  it('读取失败留下空索引，浏览本身仍可继续', async () => {
    vi.spyOn(collectApi, 'listPoints').mockRejectedValue(new Error('读取失败'))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toBe('|')
  })

  it('卸载后中止未完成的已有点位请求', () => {
    let requested: AbortSignal | undefined
    vi.spyOn(collectApi, 'listPoints').mockImplementation((_query, signal) => {
      requested = signal
      return new Promise(() => {})
    })
    const wrapper = render()
    expect(requested?.aborted).toBe(false)
    wrapper.unmount()
    expect(requested?.aborted).toBe(true)
  })
})
