/**
 * @fileoverview 契约：脏着才拦关页、干净了就放行、卸载后不再拦全站。
 *
 * ⚠ 常驻挂着 `beforeunload` 是两个坑合一个：一是干净的文档也弹「确定离开」，
 * 二是页面从此进不了 bfcache。所以这条闸守的是**装拆的时机**，不只是「拦住了」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'

import { useUnsavedGuard } from '@/pages/TwinEditor/useUnsavedGuard'

// ⚠ 监听挂在全局 window 上，用例之间会互相串门：挂了不拆的话，第一条用例
// 留下的那个拦截器会让后面每一条都「拦住了」
const mounted: ReturnType<typeof mount>[] = []

function mountGuard(initial = false) {
  const isDirty = ref(initial)
  const host = defineComponent({
    setup() {
      useUnsavedGuard(() => isDirty.value)
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  mounted.push(wrapper)
  return { wrapper, isDirty }
}

/** 真发一次关页事件，回答「浏览器这次会不会问」。 */
function isBlocked(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.restoreAllMocks()
})

describe('关页拦截', () => {
  it('脏着时拦住关页', async () => {
    const { isDirty } = mountGuard()

    isDirty.value = true
    await nextTick()

    expect(isBlocked()).toBe(true)
  })

  it('干净时不拦：没改过还弹一句「确定离开」是纯打扰', () => {
    mountGuard()

    expect(isBlocked()).toBe(false)
  })

  it('存过之后立刻放行，不必等下一次跳转', async () => {
    const { isDirty } = mountGuard(true)

    isDirty.value = false
    await nextTick()

    expect(isBlocked()).toBe(false)
  })

  it('卸载后不再拦：留着的话整个站点都在被这一页挡', async () => {
    const { wrapper, isDirty } = mountGuard(true)

    isDirty.value = true
    await nextTick()
    wrapper.unmount()

    expect(isBlocked()).toBe(false)
  })

  it('干净时连监听都不挂，页面才进得了 bfcache', () => {
    const add = vi.spyOn(window, 'addEventListener')

    mountGuard()

    expect(add.mock.calls.some(([name]) => name === 'beforeunload')).toBe(false)
  })
})
