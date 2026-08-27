/**
 * @fileoverview 契约：挑点弹窗打开时把数据源与点位各搜一次、关闭与卸载时把
 * 在途请求掐掉，选中的点位抛出去并顺手关掉弹窗；换数据源即重搜；一页列不全
 * 时把总数说出来。
 *
 * ⚠ 最后一条不是装饰：台账的点位列只能从这里挑，列不全又不说，用户会在
 * 清单里找一个明明存在的点位怎么也找不到。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { Page } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import type { CollectPoint, CollectSource } from '@dt/contracts'
import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'

function point(code: string, sourceId = 's1'): CollectPoint {
  return {
    id: code,
    source_id: sourceId,
    node_key: `${sourceId}:${code}`,
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

function source(over: Partial<CollectSource> = {}): CollectSource {
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
    ...over,
  }
}

function page<T>(items: T[], total = items.length): Page<T> {
  return { items, total, page: 1, size: 50 }
}

function mountDialog(open: boolean) {
  return mount(PointPickerDialog, {
    props: { modelValue: open, fieldKey: 'value' },
    global: { stubs: { Teleport: true } },
  })
}

/** 打开弹窗并把两次取数都跑完。 */
async function opened() {
  const wrapper = mountDialog(false)
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([point('temp')]))
  vi.spyOn(collectApi, 'listSources').mockResolvedValue(
    page([source(), source({ id: 's2', name: '二号线', code: 'plant2' })]),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('打开与关闭', () => {
  it('关着的时候不去搜', () => {
    mountDialog(false)

    expect(collectApi.listPoints).not.toHaveBeenCalled()
    expect(collectApi.listSources).not.toHaveBeenCalled()
  })

  it('打开时搜一次并列出结果', async () => {
    const wrapper = await opened()

    expect(collectApi.listPoints).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('点位 temp')
  })

  it('不叠在别的弹窗上时就用普通层级', async () => {
    const wrapper = await opened()

    expect(wrapper.find('.dt-modal--modal').exists()).toBe(true)
  })

  it('弹窗标题里带上正在绑的槽键', async () => {
    const wrapper = await opened()

    expect(wrapper.text()).toContain('value')
  })

  it('一个都没搜到时给空态而不是空白', async () => {
    vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([]))
    const wrapper = await opened()

    expect(wrapper.text()).toContain('没有匹配的点位')
  })

  it('搜失败时把原因显示出来', async () => {
    vi.spyOn(collectApi, 'listPoints').mockRejectedValue(new Error('炸了'))
    const wrapper = await opened()

    expect(wrapper.text()).toContain('请求失败')
  })
})

describe('按数据源筛', () => {
  /** 展开数据源下拉，点第 index 档。 */
  async function chooseSource(
    wrapper: Awaited<ReturnType<typeof opened>>,
    index: number,
  ): Promise<void> {
    await wrapper.get('.dt-select__trigger').trigger('click')
    await flushPromises()
    const options = wrapper.findAll('.dt-select-menu__item')
    options[index]?.element.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await flushPromises()
  }

  it('打开时把数据源清单一起拉来，档位上带它跑的协议', async () => {
    const wrapper = await opened()
    await wrapper.get('.dt-select__trigger').trigger('click')
    await flushPromises()

    expect(collectApi.listSources).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('一号车间 PLC · OPC UA')
  })

  it('换一个数据源就重搜，且这一次带上了它的 id', async () => {
    const wrapper = await opened()

    await chooseSource(wrapper, 2)

    expect(
      vi.mocked(collectApi.listPoints).mock.calls.at(-1)?.[0],
    ).toMatchObject({ sourceId: 's2' })
  })

  it('挑回「全部数据源」时不带 source_id，而不是带一个空串', async () => {
    const wrapper = await opened()

    await chooseSource(wrapper, 2)
    await chooseSource(wrapper, 0)

    expect(
      vi.mocked(collectApi.listPoints).mock.calls.at(-1)?.[0]?.sourceId,
    ).toBeUndefined()
  })

  it('结果行上标出这个点位归哪个数据源', async () => {
    const wrapper = await opened()

    expect(wrapper.get('.dt-pick__item').text()).toContain('一号车间 PLC')
  })

  // ⚠ 数据源清单只用来筛选与认人：它取不到时仍要挑得了点位，
  // 否则一次无关的失败会把整条绑定路堵死
  it('数据源清单取不到也照样挑得到点位，只是说清只能按关键字搜', async () => {
    vi.spyOn(collectApi, 'listSources').mockRejectedValue(new Error('炸了'))
    const wrapper = await opened()

    expect(wrapper.text()).toContain('只能按关键字搜')
    expect(wrapper.text()).toContain('点位 temp')
  })
})

describe('列不全时把总数说出来', () => {
  it('总数比这一页多就摆出来一句', async () => {
    vi.spyOn(collectApi, 'listPoints').mockResolvedValue(
      page([point('temp')], 120),
    )
    const wrapper = await opened()

    expect(wrapper.text()).toContain('共 120 个点位')
  })

  it('列全了就不摆这一句', async () => {
    const wrapper = await opened()

    expect(wrapper.text()).not.toContain('只列出前')
  })
})

describe('选中', () => {
  it('点一个点位抛出它并关掉弹窗', async () => {
    const wrapper = await opened()

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
