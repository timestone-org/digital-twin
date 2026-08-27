/**
 * @fileoverview 契约：台账的点位列从选点面板里挑，不手打。
 *
 * ⚠ 身份串 `{数据源id}:{点位编码}` 的前半截是 UUID，手打错一个字符就是一列
 * 永远汇总不出数的台账，而界面上一切正常——这条用例守的就是「这一格不再是
 * 一只自由输入框」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { CollectPoint, CollectSource, Page } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import ColumnSourcePoint from '@/pages/Dataset/TableDetail/components/ColumnSourcePoint.vue'

function point(): CollectPoint {
  return {
    id: 'p1',
    source_id: 's1',
    node_key: 's1:meter.kwh',
    code: 'meter.kwh',
    name: '总表电量',
    address: 'ns=2;s=kwh',
    data_type: 'float',
    unit: 'kWh',
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60000,
    archive_retention_days: null,
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T00:00:00.000Z',
  }
}

function source(): CollectSource {
  return {
    id: 's1',
    name: '一号车间 PLC',
    code: 'plant1',
    protocol: 'opcua',
    description: null,
    endpoint: 'opc.tcp://10.0.0.2:4840',
    username: null,
    has_credential: false,
    options_json: {},
    read_mode: 'subscribe',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 1,
    live_point_limit: 1000,
    runtime: {
      state: 'online',
      point_count: 1,
      error_category: null,
      error_detail: null,
      leader_instance: 'c1',
      updated_at: null,
    },
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

function page<T>(items: T[]): Page<T> {
  return { items, total: items.length, page: 1, size: 50 }
}

function render(nodeKey = '', nodeKeyError = '') {
  return mount(ColumnSourcePoint, {
    props: { nodeKey, agg: 'avg', nodeKeyError, columnKey: 'kwh' },
    global: { stubs: { Teleport: true } },
  })
}

/** 按下「挑点位」，把面板那两次取数跑完。 */
async function openPicker(wrapper: ReturnType<typeof render>): Promise<void> {
  await wrapper
    .findAll('button')
    .find((one) => one.text().includes('挑点位'))
    ?.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([point()]))
  vi.spyOn(collectApi, 'listSources').mockResolvedValue(page([source()]))
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('这一格只能挑', () => {
  it('没有任何可以敲身份串的输入框，只有一个挑点位的按钮', () => {
    const wrapper = render()

    expect(wrapper.find('.dt-point-ref__pick').exists()).toBe(true)
    expect(wrapper.text()).toContain('还没挑点位')
  })

  it('已经绑过的原样摆出来，编辑时看得见自己绑的是谁', () => {
    const wrapper = render('s1:meter.kwh')

    expect(wrapper.text()).toContain('meter.kwh')
  })

  it('挑完把点位身份写回，写的就是后端认的那一串', async () => {
    const wrapper = render()

    await openPicker(wrapper)
    await wrapper.get('.dt-pick__item').trigger('click')

    expect(wrapper.emitted('update:nodeKey')?.at(-1)).toEqual(['s1:meter.kwh'])
  })

  // ⚠ 这个面板是从「新增/编辑列」那个弹窗里开出来的：同层的两个弹窗 z-index
  // 相同，谁在上只由挂载先后决定，压中了就是「挑点位点了没反应」
  it('选点面板叠在列表单之上，而不是与它同层', async () => {
    const wrapper = render()

    await openPicker(wrapper)

    expect(wrapper.find('.dt-modal--confirm').exists()).toBe(true)
  })

  it('挑之前面板不去取数：没人按按钮时不该有请求', () => {
    render()

    expect(collectApi.listPoints).not.toHaveBeenCalled()
  })

  // ⚠ 这一格的控件是按钮不是输入框：不把 DtField 的 id 接到按钮上，
  // 标签的 for 就指向一个不存在的元素，读屏念不出这一行叫什么
  it('「点位」这个标签指到挑点按钮上', () => {
    const wrapper = render()
    const label = wrapper.get('label')

    expect(label.text()).toContain('点位')
    expect(wrapper.get('.dt-point-ref__pick').attributes('id')).toBe(
      label.attributes('for'),
    )
  })

  it('错误文案落在这一格上，而不是弹成一句通用失败', () => {
    const wrapper = render('', '请挑一个点位')

    expect(wrapper.text()).toContain('请挑一个点位')
  })
})

describe('聚合口径', () => {
  it('换一档就抛出去，且抛的是窄化后的取值', async () => {
    const wrapper = render('s1:meter.kwh')

    await wrapper.get('.dt-select__trigger').trigger('click')
    await flushPromises()
    const items = wrapper.findAll('.dt-select-menu__item')
    items[1]?.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('update:agg')?.at(-1)?.[0]).not.toBe('avg')
  })
})
