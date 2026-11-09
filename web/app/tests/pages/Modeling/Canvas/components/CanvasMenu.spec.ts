/** @fileoverview 右键菜单浮层：画布滚轮缩放时收起，不留在原处指着别的卡片。 */
import { mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'

import CanvasMenu from '@/pages/Modeling/Canvas/components/CanvasMenu.vue'

const MENU = {
  at: { x: 20, y: 20 },
  groups: [
    {
      key: 'open',
      items: [
        {
          action: 'config' as const,
          label: '参数',
          keys: '',
          disabled: false,
          danger: false,
        },
      ],
    },
  ],
}

afterEach(() => {
  document.body.innerHTML = ''
})

it('滚轮缩放画布时收起', () => {
  const wrapper = mount(CanvasMenu, {
    props: { menu: MENU },
    attachTo: document.body,
  })

  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }))

  expect(wrapper.emitted('close')).toHaveLength(1)
  wrapper.unmount()
})
