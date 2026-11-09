/**
 * @fileoverview 契约：已绑的点位按「点位名 · 数据源」显示，全串留在悬停里；
 * 查不到时退回原始身份串，不把绑定说成没挑。
 */
import type { CollectPoint, CollectSource } from '@dt/contracts'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as collect from '@/api/collect'
import PointRefField from '@/components/binding/PointRefField.vue'

const SOURCE_ID = '01a1bfe5-0000-7000-8000-000000000001'
const NODE_KEY = `${SOURCE_ID}:running`

function point(over: Partial<CollectPoint> = {}): CollectPoint {
  return {
    id: 'p1',
    source_id: SOURCE_ID,
    node_key: NODE_KEY,
    code: 'running',
    name: 'Running',
    address: 'ns=2;s=Running',
    data_type: 'bool',
    unit: null,
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: false,
    archive_max_interval_ms: 60_000,
    archive_retention_days: null,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  vi.spyOn(collect, 'listPoints').mockResolvedValue({
    items: [point({ id: 'p0', node_key: `${SOURCE_ID}:running2` }), point()],
    page: 1,
    size: 200,
    total: 2,
  })
  vi.spyOn(collect, 'getSource').mockResolvedValue({
    id: SOURCE_ID,
    name: '审计模拟工厂',
  } as CollectSource)
})

describe('PointRefField · 点位显示', () => {
  it('已绑点位显示点位名与数据源，全串放进悬停', async () => {
    const wrapper = mount(PointRefField, { props: { nodeKey: NODE_KEY } })
    await flushPromises()

    const value = wrapper.get('.dt-point-ref__value')
    expect(value.text()).toBe('Running · 审计模拟工厂')
    expect(value.attributes('title')).toBe(NODE_KEY)
    expect(collect.listPoints).toHaveBeenCalledWith(
      { sourceId: SOURCE_ID, q: 'running', page: 1, size: 200 },
      expect.any(AbortSignal),
    )
  })

  it('查不到这个点位时退回原始身份串', async () => {
    vi.mocked(collect.listPoints).mockRejectedValueOnce(new Error('断网'))
    const wrapper = mount(PointRefField, { props: { nodeKey: NODE_KEY } })
    await flushPromises()

    expect(wrapper.get('.dt-point-ref__value').text()).toBe(
      `${SOURCE_ID}:running`,
    )
  })

  it('没挑点位时不发请求', async () => {
    const wrapper = mount(PointRefField, { props: { nodeKey: '' } })
    await flushPromises()

    expect(wrapper.text()).toContain('还没挑点位')
    expect(collect.listPoints).not.toHaveBeenCalled()
  })

  it('换点位时丢掉上一个点位的名字', async () => {
    const wrapper = mount(PointRefField, { props: { nodeKey: NODE_KEY } })
    await flushPromises()
    vi.mocked(collect.listPoints).mockResolvedValueOnce({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    await wrapper.setProps({ nodeKey: `${SOURCE_ID}:other` })
    await flushPromises()

    expect(wrapper.get('.dt-point-ref__value').text()).toBe(
      `${SOURCE_ID}:other`,
    )
  })
})
