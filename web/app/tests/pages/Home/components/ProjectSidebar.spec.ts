/**
 * @fileoverview 项目栏的选中、计数与内联重命名契约。
 * ⚠ 计数取的是服务端给的 `dashboardCount`，不是本地已加载的条数：
 * 工作台一次只加载当前项目的大屏，按本地条数算会让其余项目全显示 0。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

import type { ProjectSummary } from '@/api/dashboardWire'
import ProjectSidebar from '@/pages/Home/components/ProjectSidebar.vue'

function project(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'p-1',
    name: '一号厂区',
    description: null,
    themeJson: {},
    brandJson: {},
    dashboardCount: 3,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

const PROJECTS = [
  project(),
  project({ id: 'p-2', name: '二号厂区', dashboardCount: 0 }),
]

function render(canManage = true, selectedProjectId: string | null = 'p-1') {
  return mount(ProjectSidebar, {
    props: { projects: PROJECTS, selectedProjectId, canManage },
  })
}

function rows(wrapper: VueWrapper) {
  return wrapper.findAll('[data-test="project-row"]')
}

describe('项目列表', () => {
  it('逐个列出项目名与它的大屏计数', () => {
    const [first, second] = rows(render())
    expect(first?.text()).toContain('一号厂区')
    expect(first?.text()).toContain('3')
    expect(second?.text()).toContain('二号厂区')
    expect(second?.text()).toContain('0')
  })

  it('顶部写出项目总数', () => {
    expect(render().text()).toContain('项目')
    expect(render().text()).toContain('2')
  })

  it('点一行发 select', async () => {
    const wrapper = render()
    await rows(wrapper)[1]?.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['p-2']])
  })

  it('一个项目都没有时给一句空态，而不是空白', () => {
    const wrapper = mount(ProjectSidebar, {
      props: { projects: [], selectedProjectId: null },
    })
    expect(wrapper.text()).toContain('暂无项目')
  })
})

describe('新建项目入口', () => {
  it('有 manage 权时头部与底部各给一个入口，都发 create', async () => {
    const wrapper = render()
    await wrapper.get('[data-test="sidebar-create-project"]').trigger('click')
    await wrapper
      .get('[data-test="sidebar-create-project-wide"]')
      .trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(2)
  })

  it('没有 manage 权时两个入口都不画', () => {
    const wrapper = render(false)
    expect(wrapper.find('[data-test="sidebar-create-project"]').exists()).toBe(
      false,
    )
    expect(
      wrapper.find('[data-test="sidebar-create-project-wide"]').exists(),
    ).toBe(false)
  })
})

describe('内联重命名', () => {
  it('双击项目名进重命名，Enter 提交时带上项目 id', async () => {
    const wrapper = render()
    await rows(wrapper)[0]
      ?.get('[data-test="project-name"]')
      .trigger('dblclick')
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('新厂区')
    await field.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')).toEqual([['p-1', '新厂区']])
  })

  it('✎ 按钮同样进重命名，输入框带着当前名字与可读名称', async () => {
    const wrapper = render()
    await rows(wrapper)[0]?.get('[data-test="project-rename"]').trigger('click')
    const field = wrapper.get<HTMLInputElement>('[data-test="inline-rename"]')
    expect(field.element.value).toBe('一号厂区')
    expect(field.attributes('aria-label')).toBe('项目名称')
  })

  it('Esc 取消后随后的失焦不许再提交一遍', async () => {
    const wrapper = render()
    await rows(wrapper)[0]?.get('[data-test="project-rename"]').trigger('click')
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('新厂区')
    await field.trigger('keyup', { key: 'Escape' })
    await field.trigger('blur')
    expect(wrapper.emitted('rename')).toBeUndefined()
  })

  it('没有 manage 权时双击不进重命名，✎ 也不画', async () => {
    const wrapper = render(false)
    await rows(wrapper)[0]
      ?.get('[data-test="project-name"]')
      .trigger('dblclick')
    expect(wrapper.find('[data-test="inline-rename"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="project-rename"]').exists()).toBe(false)
  })
})

describe('选中态与计数', () => {
  // ⚠ 选中行与未选中行的底色差别在暗色主题下很弱，竖条是「哪个被选中」的主信号
  it('只有选中的那一行画发光竖条', () => {
    const wrapper = render()
    const bars = rows(wrapper).map((row) =>
      row.find('[data-test="project-active-bar"]').exists(),
    )

    expect(bars).toEqual([true, false])
  })

  it('每一行都带自己的大屏计数', () => {
    const counts = rows(render()).map((row) =>
      row.get('[data-test="project-count"]').text(),
    )

    expect(counts).toEqual(['3', '0'])
  })
})
