/**
 * @fileoverview 缩略图的懒加载契约：不进视口不取图，命中与卸载都要断开 observer。
 * ⚠ 一个项目下几十张卡片同时挂载，漏掉懒加载就是几十个并发请求；
 * 漏掉 disconnect 就是几十个 observer 常驻，而工作台一开就是一整天。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import * as thumbnailApi from '@/api/dashboardThumbnail'
import DashboardThumbnail from '@/pages/Home/components/DashboardThumbnail.vue'

interface FakeObserver {
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  fire: () => void
}

const observers: FakeObserver[] = []
const originalObserver = globalThis.IntersectionObserver

/** 装一个能手动触发的 IntersectionObserver，happy-dom 自带的那个不会真的相交。 */
function installObserver(): void {
  class Fake {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(private readonly callback: IntersectionObserverCallback) {
      observers.push({
        observe: this.observe,
        disconnect: this.disconnect,
        fire: () => {
          this.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          )
        },
      })
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: Fake,
    configurable: true,
    writable: true,
  })
}

function latest(): FakeObserver {
  const found = observers.at(-1)
  if (found === undefined) throw new Error('没有创建 observer')
  return found
}

beforeEach(() => {
  observers.length = 0
  installObserver()
})

afterEach(() => {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: originalObserver,
    configurable: true,
    writable: true,
  })
  vi.restoreAllMocks()
})

describe('懒加载', () => {
  it('还没进视口时不取图', () => {
    const fetch = vi
      .spyOn(thumbnailApi, 'getDashboardThumbnail')
      .mockResolvedValue(null)
    const wrapper = mount(DashboardThumbnail, {
      props: { dashboardId: 'd-1' },
    })
    expect(latest().observe).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('进视口才取图，且只取一次', async () => {
    const fetch = vi
      .spyOn(thumbnailApi, 'getDashboardThumbnail')
      .mockResolvedValue({
        dashboardId: 'd-1',
        data: 'data:image/png;base64,AAA',
        updatedAt: '2026-08-01T00:00:00Z',
      })
    const wrapper = mount(DashboardThumbnail, {
      props: { dashboardId: 'd-1' },
    })
    latest().fire()
    latest().fire()
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('d-1')
    expect(wrapper.get('img').attributes('src')).toBe(
      'data:image/png;base64,AAA',
    )
    wrapper.unmount()
  })

  it('命中之后立刻断开 observer', async () => {
    vi.spyOn(thumbnailApi, 'getDashboardThumbnail').mockResolvedValue(null)
    const wrapper = mount(DashboardThumbnail, {
      props: { dashboardId: 'd-1' },
    })
    latest().fire()
    await flushPromises()
    expect(latest().disconnect).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('卸载时断开 observer', () => {
    vi.spyOn(thumbnailApi, 'getDashboardThumbnail').mockResolvedValue(null)
    mount(DashboardThumbnail, { props: { dashboardId: 'd-1' } }).unmount()
    expect(latest().disconnect).toHaveBeenCalled()
  })
})

describe('占位图', () => {
  it('没存过缩略图时画确定性占位，而不是空白', async () => {
    vi.spyOn(thumbnailApi, 'getDashboardThumbnail').mockResolvedValue(null)
    const wrapper = mount(DashboardThumbnail, {
      props: { dashboardId: 'd-9' },
    })
    latest().fire()
    await flushPromises()

    expect(wrapper.find('[data-test="thumb-placeholder"]').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('取图失败也退到占位，不把错误抛给页面', async () => {
    vi.spyOn(thumbnailApi, 'getDashboardThumbnail').mockRejectedValue(
      new Error('500'),
    )
    const wrapper = mount(DashboardThumbnail, {
      props: { dashboardId: 'd-9' },
    })
    latest().fire()
    await flushPromises()

    expect(wrapper.find('[data-test="thumb-placeholder"]').exists()).toBe(true)
  })

  it('同一张屏两次挂载的占位排布完全一样', async () => {
    vi.spyOn(thumbnailApi, 'getDashboardThumbnail').mockResolvedValue(null)
    const render = async (): Promise<string> => {
      const wrapper = mount(DashboardThumbnail, {
        props: { dashboardId: 'd-same' },
      })
      latest().fire()
      await flushPromises()
      const html = wrapper.get('[data-test="thumb-placeholder"]').html()
      wrapper.unmount()
      return html
    }
    expect(await render()).toBe(await render())
  })
})
