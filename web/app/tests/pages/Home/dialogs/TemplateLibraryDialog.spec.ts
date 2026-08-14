/**
 * @fileoverview 契约：模板库弹窗自己取数（打开才取）、`use` / `delete` 抛得出
 * 选中的模板，`reload` 透出给父页面——删完不刷，被删的那张会一直挂在网格里。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { DashboardTemplateSummary, Page } from '@dt/contracts'

import * as templatesApi from '@/api/dashboardTemplates'
import TemplateLibraryDialog from '@/pages/Home/components/TemplateLibraryDialog.vue'

function template(id: string, name: string): DashboardTemplateSummary {
  return {
    id,
    name,
    description: null,
    category: null,
    thumbnail: null,
    sourceProjectId: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

function page(
  items: DashboardTemplateSummary[],
): Page<DashboardTemplateSummary> {
  return { items, total: items.length, page: 1, size: 100 }
}

function mountDialog(open: boolean, canDelete = true) {
  return mount(TemplateLibraryDialog, {
    props: { open, canDelete },
    global: { stubs: { Teleport: true } },
  })
}

beforeEach(() => {
  vi.spyOn(templatesApi, 'listDashboardTemplates').mockResolvedValue(
    page([template('t1', '光伏总览')]),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('取数', () => {
  it('关着的时候不取数', () => {
    mountDialog(false)

    expect(templatesApi.listDashboardTemplates).not.toHaveBeenCalled()
  })

  it('打开时取一次并把模板列出来', async () => {
    const wrapper = mountDialog(false)

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(templatesApi.listDashboardTemplates).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('光伏总览')
  })

  it('一张模板都没有时给空态而不是空白', async () => {
    vi.spyOn(templatesApi, 'listDashboardTemplates').mockResolvedValue(page([]))
    const wrapper = mountDialog(true)

    await flushPromises()

    expect(wrapper.text()).toContain('还没有模板')
  })

  it('取数失败时把原因摆出来', async () => {
    vi.spyOn(templatesApi, 'listDashboardTemplates').mockRejectedValue(
      new Error('网关炸了'),
    )
    const wrapper = mountDialog(true)

    await flushPromises()

    expect(wrapper.text()).toContain('网关炸了')
  })

  it('父页面删完调 reload，会再取一次', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    wrapper.vm.reload()
    await flushPromises()

    expect(templatesApi.listDashboardTemplates).toHaveBeenCalledTimes(2)
  })
})

describe('事件', () => {
  it('点模板卡片抛 use', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    const card = wrapper
      .findAll('button')
      .find((button) => button.text().includes('光伏总览'))
    await card?.trigger('click')

    expect(wrapper.emitted('use')?.[0]?.[0]).toMatchObject({ id: 't1' })
  })

  it('点删除键抛 delete', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await wrapper.find('[aria-label="删除模板"]').trigger('click')

    expect(wrapper.emitted('delete')?.[0]?.[0]).toMatchObject({ id: 't1' })
  })

  it('没有删除码时不渲染删除键，也不承诺右上角可删', async () => {
    const wrapper = mountDialog(true, false)
    await flushPromises()

    expect(wrapper.find('[aria-label="删除模板"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('可删除模板')
  })
})

describe('弹窗自带的关闭路径', () => {
  it('点弹窗右上角的关闭键把 update:open(false) 转出去', async () => {
    const wrapper = mountDialog(true)

    await wrapper.find('[aria-label="关闭"]').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
