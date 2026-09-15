/** @fileoverview 采集点位的交互与数据完整性契约。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import type { CollectPoint } from '@dt/contracts'
import { fetchPointAggregate } from '@/api/pointHistories'
import { usePointHistory } from '@/pages/Collect/Opcua/scripts/usePointHistory'

vi.mock('@/api/pointHistories', () => ({ fetchPointAggregate: vi.fn() }))
const point: CollectPoint = {
  id: 'p1',
  source_id: 's1',
  node_key: 's1:p1',
  code: 'p1',
  name: '温度',
  address: 'ns=2;s=Temp',
  data_type: 'float',
  unit: '℃',
  sampling_interval_ms: 1000,
  deadband: 0,
  archive_enabled: true,
  archive_max_interval_ms: 60000,
  archive_retention_days: null,
  created_at: '',
  updated_at: '',
}
afterEach(() => vi.restoreAllMocks())

describe('点位历史详情', () => {
  it('按所选点位查询并保留服务端截断提示', async () => {
    vi.mocked(fetchPointAggregate).mockResolvedValue({
      items: [
        {
          node_key: 's1:p1',
          bucket_start: '2026-09-11T01:00:00Z',
          value: 25,
          sample_count: 1,
        },
      ],
      interval: '1m',
      aggregate: 'avg',
      timezone: 'UTC',
      is_truncated: true,
    })
    let state: ReturnType<typeof usePointHistory> | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          state = usePointHistory(ref(point))
          return () => null
        },
      }),
    )
    await flushPromises()
    expect(fetchPointAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ nodeKeys: ['s1:p1'], interval: '1m' }),
      expect.any(AbortSignal),
    )
    expect(state?.result.value?.is_truncated).toBe(true)
    expect(state?.series.value[0]?.name).toBe('温度')
    wrapper.unmount()
  })
  it('未选点位时不查询', async () => {
    vi.mocked(fetchPointAggregate).mockClear()
    const wrapper = mount(
      defineComponent({
        setup() {
          usePointHistory(ref<CollectPoint | null>(null))
          return () => null
        },
      }),
    )
    await flushPromises()
    expect(fetchPointAggregate).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

it('关闭详情会中止在途请求，迟到结果不能覆盖新窗口', async () => {
  let finish:
    | ((result: Awaited<ReturnType<typeof fetchPointAggregate>>) => void)
    | undefined
  vi.mocked(fetchPointAggregate)
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue({
      items: [],
      interval: '15m',
      aggregate: 'avg',
      timezone: 'UTC',
      is_truncated: false,
    })
  let history: ReturnType<typeof usePointHistory> | undefined
  const selected = ref<CollectPoint | null>(point)
  const wrapper = mount(
    defineComponent({
      setup() {
        history = usePointHistory(selected)
        return () => null
      },
    }),
  )
  await flushPromises()
  const signal = vi.mocked(fetchPointAggregate).mock.calls[0]?.[1]
  if (!history) throw new Error('未创建查询状态')
  history.windowMinutes.value = '1440'
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  finish?.({
    items: [],
    interval: '1m',
    aggregate: 'avg',
    timezone: 'UTC',
    is_truncated: true,
  })
  await flushPromises()
  expect(history.result.value?.interval).toBe('15m')
  selected.value = null
  await flushPromises()
  expect(history.result.value).toBeNull()
  wrapper.unmount()
})

it('历史查询错误明确展示且不保留旧曲线', async () => {
  vi.mocked(fetchPointAggregate)
    .mockReset()
    .mockRejectedValue(new Error('offline'))
  let history: ReturnType<typeof usePointHistory> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        history = usePointHistory(ref(point))
        return () => null
      },
    }),
  )
  await flushPromises()
  expect(history?.error.value).toBeTruthy()
  expect(history?.series.value).toEqual([])
  expect(history?.loading.value).toBe(false)
  wrapper.unmount()
})
