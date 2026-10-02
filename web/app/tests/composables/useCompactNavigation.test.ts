/** @fileoverview 管理端导航跟随可用视口，卸载后不保留媒体查询监听。 */
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCompactNavigation } from '@/composables/useCompactNavigation'

afterEach(() => vi.restoreAllMocks())

const Host = defineComponent({
  setup: () => ({ compact: useCompactNavigation() }),
  template: '<p>{{ compact ? "菜单" : "侧栏" }}</p>',
})

describe('useCompactNavigation', () => {
  it('首帧按视口选择形态，尺寸变化时更新，卸载后移除监听', async () => {
    const query = window.matchMedia('(max-width: 1023px), (max-height: 599px)')
    const matches = vi.spyOn(query, 'matches', 'get').mockReturnValue(true)
    const add = vi.spyOn(query, 'addEventListener')
    const remove = vi.spyOn(query, 'removeEventListener')
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(query)
    const wrapper = mount(Host)
    expect(wrapper.text()).toBe('菜单')
    expect(matchMedia).toHaveBeenCalledWith(
      '(max-width: 1023px), (max-height: 599px)',
    )

    matches.mockReturnValue(false)
    query.dispatchEvent(new Event('change'))
    await nextTick()
    expect(wrapper.text()).toBe('侧栏')

    wrapper.unmount()
    expect(remove).toHaveBeenCalledWith('change', add.mock.calls[0]?.[1])
  })
})
