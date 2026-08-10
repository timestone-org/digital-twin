/**
 * @fileoverview DtPageState 与 DtNotice 的行为契约。
 *
 * 三态的优先级是有意的：加载中盖过空态。反过来的话，首屏那一瞬间会闪一下
 * 「暂无数据」，而那时候根本还不知道有没有数据。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtNotice from '../../src/components/DtNotice/DtNotice.vue'
import DtPageState from '../../src/components/DtPageState/DtPageState.vue'

const CONTENT = { default: '<p class="body">数据</p>' }

describe('DtPageState', () => {
  it('加载中只出加载态，不闪空态', () => {
    const wrapper = mount(DtPageState, {
      props: { loading: true, error: null, empty: true },
      slots: CONTENT,
    })
    expect(wrapper.find('.dt-spinner').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('暂无数据')
  })

  it('出错时给原因，并带重试入口', async () => {
    const wrapper = mount(DtPageState, {
      props: { loading: false, error: '网络不可达', empty: true },
      slots: CONTENT,
    })
    expect(wrapper.text()).toContain('加载失败')
    expect(wrapper.text()).toContain('网络不可达')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('出错时不渲染正文——半截数据比没有数据更误导', () => {
    const wrapper = mount(DtPageState, {
      props: { loading: false, error: '炸了', empty: false },
      slots: CONTENT,
    })
    expect(wrapper.find('.body').exists()).toBe(false)
  })

  it('空列表给空态与可选的提示', () => {
    const wrapper = mount(DtPageState, {
      props: {
        loading: false,
        error: null,
        empty: true,
        emptyHint: '换个筛选条件',
      },
      slots: CONTENT,
    })
    expect(wrapper.text()).toContain('暂无数据')
    expect(wrapper.text()).toContain('换个筛选条件')
  })

  it('空态标题与图标可以按场景改', () => {
    const wrapper = mount(DtPageState, {
      props: {
        loading: false,
        error: null,
        empty: true,
        emptyTitle: '还没有账号',
        emptyIcon: 'users',
      },
      slots: CONTENT,
    })
    expect(wrapper.text()).toContain('还没有账号')
    expect(wrapper.find('.dt-icon').exists()).toBe(true)
  })

  it('三态都不成立时才渲染正文', () => {
    const wrapper = mount(DtPageState, {
      props: { loading: false, error: null, empty: false },
      slots: CONTENT,
    })
    expect(wrapper.find('.body').exists()).toBe(true)
  })
})

describe('DtNotice', () => {
  it('danger 用 alert：失败要立刻打断读屏', () => {
    const wrapper = mount(DtNotice, { props: { intent: 'danger' } })
    expect(wrapper.attributes('role')).toBe('alert')
  })

  it('其余用 status：成功提示不该打断当前朗读', () => {
    for (const intent of ['info', 'success', 'warning'] as const) {
      const wrapper = mount(DtNotice, { props: { intent } })
      expect(wrapper.attributes('role'), intent).toBe('status')
    }
  })

  it('内容走默认插槽', () => {
    const wrapper = mount(DtNotice, { slots: { default: '已保存' } })
    expect(wrapper.text()).toBe('已保存')
  })
})
