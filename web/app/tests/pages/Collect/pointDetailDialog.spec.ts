/** @fileoverview 详情弹窗接线：完整时间、陈旧提示、历史空态与关闭。 */
import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { CollectPoint } from '@dt/contracts'
import PointDetailDialog from '@/pages/Collect/Opcua/components/PointDetailDialog.vue'
import { fetchPointAggregate } from '@/api/pointHistories'

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
  archive_enabled: false,
  archive_max_interval_ms: 60000,
  archive_retention_days: null,
  created_at: '',
  updated_at: '',
}
enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())
it('陈旧读数有完整日期，关闭历史记录后仍可查旧历史', async () => {
  vi.mocked(fetchPointAggregate).mockResolvedValue({
    items: [],
    interval: '1m',
    aggregate: 'avg',
    timezone: 'UTC',
    is_truncated: true,
  })
  const wrapper = mount(PointDetailDialog, {
    props: {
      point,
      sample: {
        state: 'ok',
        quality: 'good',
        value: 12,
        timestampMs: 1789088400000,
      },
      stale: true,
    },
    global: { stubs: { teleport: true, DtLineChart: true } },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('陈旧')
  expect(wrapper.text()).toContain('2026')
  expect(wrapper.text()).toContain('仍可查看此前已保存的历史')
  expect(wrapper.text()).toContain('历史结果未完整返回')
  await wrapper.find('button[aria-label="关闭"]').trigger('click')
  expect(wrapper.emitted('close')).toHaveLength(1)
})
it('非数值点位不会发起数值聚合查询', async () => {
  vi.mocked(fetchPointAggregate).mockClear()
  const wrapper = mount(PointDetailDialog, {
    props: {
      point: { ...point, data_type: 'string' },
      sample: undefined,
      stale: false,
    },
    global: { stubs: { teleport: true, DtLineChart: true } },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('非数值类型')
  expect(fetchPointAggregate).not.toHaveBeenCalled()
})
