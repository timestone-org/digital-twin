/**
 * @fileoverview 顶栏的契约：返回入口缺省不显示、给了就是一条真实链接（不是按钮）、
 * 标题与 actions 槽、时钟首帧就有值且卸载时清定时器。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import AppTopbar from '@/components/layout/AppTopbar.vue'

vi.mock('vue-router', () => ({
  RouterLink: {
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppTopbar · 返回入口', () => {
  it('缺省不显示——大多数页面是从导航直接进来的，没有「上一层」', () => {
    expect(
      mount(AppTopbar, { props: { title: '用户管理' } })
        .find('a')
        .exists(),
    ).toBe(false)
  })

  it('给了目标就渲染成链接：中键新标签与复制链接都该照常可用', () => {
    const wrapper = mount(AppTopbar, {
      props: { title: '用户详情', backTo: '/system/users' },
    })
    expect(wrapper.get('a').attributes('href')).toBe('/system/users')
    // 顶栏另有换肤器这类真按钮，所以按「没有一个叫『返回』的按钮」来断言
    expect(
      wrapper
        .findAll('button')
        .some((node) => node.attributes('aria-label') === '返回'),
    ).toBe(false)
  })

  it('图标按钮要有可读名称，缺省是「返回」', () => {
    const wrapper = mount(AppTopbar, { props: { backTo: '/system/users' } })
    expect(wrapper.get('a').attributes('aria-label')).toBe('返回')
    expect(wrapper.get('a').attributes('title')).toBe('返回')
  })

  it('可读名称可以按去处改写', () => {
    const wrapper = mount(AppTopbar, {
      props: { backTo: '/system/users', backLabel: '返回用户列表' },
    })
    expect(wrapper.get('a').attributes('aria-label')).toBe('返回用户列表')
  })

  it('返回入口排在标题左侧', () => {
    const wrapper = mount(AppTopbar, {
      props: { title: '用户详情', backTo: '/system/users' },
    })
    const html = wrapper.html()
    expect(html.indexOf('aria-label="返回"')).toBeLessThan(
      html.indexOf('用户详情'),
    )
  })
})

describe('AppTopbar · 标题与插槽', () => {
  it('没给标题时不渲染空标题元素', () => {
    expect(mount(AppTopbar).find('h1').exists()).toBe(false)
  })

  it('标题与副标题各就各位', () => {
    const wrapper = mount(AppTopbar, {
      props: { title: '用户管理', subtitle: '账号与角色' },
    })
    expect(wrapper.get('h1').text()).toBe('用户管理')
    expect(wrapper.get('p').text()).toBe('账号与角色')
  })

  it('actions 槽落在右侧', () => {
    const wrapper = mount(AppTopbar, {
      slots: { actions: '<span class="probe">新建</span>' },
    })
    expect(wrapper.find('.probe').exists()).toBe(true)
  })
})

describe('AppTopbar · 换肤入口', () => {
  it('常驻顶栏：换肤是外壳功能，不该占用归页面所有的 actions 槽', () => {
    const wrapper = mount(AppTopbar, { props: { title: '用户管理' } })
    expect(
      wrapper
        .findAll('button')
        .some((node) => node.attributes('aria-label')?.includes('主题外观')),
    ).toBe(true)
  })

  it('页面自己的 actions 与换肤入口并存', () => {
    const wrapper = mount(AppTopbar, {
      props: { title: '用户管理' },
      slots: { actions: '<button aria-label="新建">新建</button>' },
    })
    const labels = wrapper
      .findAll('button')
      .map((node) => node.attributes('aria-label') ?? '')
    expect(labels).toContain('新建')
    expect(labels.some((label) => label.includes('主题外观'))).toBe(true)
  })
})

describe('AppTopbar · 时钟', () => {
  it('首帧就有值：只在 onMounted 之后赋值的话时钟位置会空一帧', () => {
    expect(mount(AppTopbar).text()).toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  it('卸载时清掉定时器——顶栏常驻整个会话，漏一个就持续累积', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    mount(AppTopbar).unmount()
    expect(clearSpy).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
