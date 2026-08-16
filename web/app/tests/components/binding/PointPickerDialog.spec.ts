/**
 * @fileoverview 契约：挑点弹窗打开时搜一次、关闭与卸载时把在途请求掐掉，
 * 选中的点位抛出去并顺手关掉弹窗。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { Page } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import type { CollectPoint } from '@dt/contracts'
import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'

function point(code: string): CollectPoint {
  return {
    id: code,
    source_id: 's1',
    node_key: `s1:${code}`,
    code,
    name: `点位 ${code}`,
    address: `ns=2;s=${code}`,
    data_type: 'float',
    unit: null,
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60000,
    archive_retention_days: null,
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T00:00:00.000Z',
  }
}

function page(items: CollectPoint[]): Page<CollectPoint> {
  return { items, total: items.length, page: 1, size: 50 }
}

function mountDialog(open: boolean) {
  return mount(PointPickerDialog, {
    props: { modelValue: open, fieldKey: 'value' },
    global: { stubs: { Teleport: true } },
  })
}

beforeEach(() => {
  vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([point('temp')]))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('打开与关闭', () => {
  it('关着的时候不去搜', () => {
    mountDialog(false)

    expect(collectApi.listPoints).not.toHaveBeenCalled()
  })

  it('打开时搜一次并列出结果', async () => {
    const wrapper = mountDialog(false)

    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(collectApi.listPoints).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('点位 temp')
  })

  it('弹窗标题里带上正在绑的槽键', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(wrapper.text()).toContain('value')
  })

  it('一个都没搜到时给空态而不是空白', async () => {
    vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([]))
    const wrapper = mountDialog(false)

    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(wrapper.text()).toContain('没有匹配的点位')
  })

  it('搜失败时把原因显示出来', async () => {
    vi.spyOn(collectApi, 'listPoints').mockRejectedValue(new Error('炸了'))
    const wrapper = mountDialog(false)

    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(wrapper.text()).toContain('请求失败')
  })
})

describe('选中', () => {
  it('点一个点位抛出它并关掉弹窗', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    await wrapper.find('.dt-pick__item').trigger('click')

    expect(wrapper.emitted('pick')?.[0]?.[0]).toMatchObject({
      node_key: 's1:temp',
    })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('取消键关掉弹窗', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((item) => item.text().trim() === '取消')
      ?.trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })
})
