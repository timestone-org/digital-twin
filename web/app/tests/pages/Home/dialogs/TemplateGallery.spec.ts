/**
 * @fileoverview 契约：模板网格的选中态、缩略图占位，以及连着开关时的防竞态——
 * 慢的那次后返回不许盖掉快的那次的结果。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { DashboardTemplateSummary, Page } from '@dt/contracts'

import * as templatesApi from '@/api/dashboardTemplates'
import TemplateGallery from '@/pages/Home/components/TemplateGallery.vue'

function template(
  id: string,
  name: string,
  thumbnail: string | null = null,
): DashboardTemplateSummary {
  return {
    id,
    name,
    description: null,
    category: null,
    thumbnail,
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

beforeEach(() => {
  vi.spyOn(templatesApi, 'listDashboardTemplates').mockResolvedValue(
    page([template('t1', '光伏总览')]),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('呈现', () => {
  it('有缩略图就画缩略图', async () => {
    vi.spyOn(templatesApi, 'listDashboardTemplates').mockResolvedValue(
      page([template('t1', '光伏总览', 'data:image/png;base64,AAA')]),
    )
    const wrapper = mount(TemplateGallery, { props: { active: true } })
    await flushPromises()

    expect(wrapper.find('img').attributes('src')).toBe(
      'data:image/png;base64,AAA',
    )
  })

  it('没有缩略图时给占位格而不是破图', async () => {
    const wrapper = mount(TemplateGallery, { props: { active: true } })
    await flushPromises()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.dt-tpl__shot--blank').exists()).toBe(true)
  })

  it('选中的那张标出来，供新建大屏时看清挑了谁', async () => {
    const wrapper = mount(TemplateGallery, {
      props: { active: true, selectedId: 't1' },
    })
    await flushPromises()

    expect(wrapper.find('.dt-tpl--on').exists()).toBe(true)
    expect(wrapper.find('[aria-pressed="true"]').exists()).toBe(true)
  })

  it('分类为空时写「未分类」，不是留一行空白', async () => {
    const wrapper = mount(TemplateGallery, { props: { active: true } })
    await flushPromises()

    expect(wrapper.text()).toContain('未分类')
  })
})

describe('防竞态', () => {
  it('先发的那次后返回也不许盖掉后发的结果', async () => {
    const slow = page([template('old', '旧结果')])
    const fast = page([template('new', '新结果')])
    let releaseSlow: () => void = () => undefined
    vi.spyOn(templatesApi, 'listDashboardTemplates')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSlow = () => resolve(slow)
          }),
      )
      .mockResolvedValueOnce(fast)

    const wrapper = mount(TemplateGallery, { props: { active: true } })
    wrapper.vm.reload()
    await flushPromises()
    releaseSlow()
    await flushPromises()

    expect(wrapper.text()).toContain('新结果')
    expect(wrapper.text()).not.toContain('旧结果')
  })
})
