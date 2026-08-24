/**
 * @fileoverview 契约：右栏顶层分页在「属性」与「绑定」之间切，
 * 且换选中不会把用户从绑定页踢回属性页——配一屏点位时选中会一直在动。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import TwinRightPane from '@/pages/TwinEditor/components/TwinRightPane.vue'
import { TWIN_SELECT_MODEL } from '@/pages/TwinEditor/scripts/types'
import type { Vec3 } from '@dt/twin-config'

/** 基准原点落在世界原点上：这一份用例守的是分页，不是坐标基准。 */
const ORIGIN: Vec3 = [0, 0, 0]

const CONFIG = normalizeTwinConfig({
  anchors: [
    { id: 'a1', name: '进口' },
    { id: 'a2', name: '出口' },
  ],
})

function mountPane() {
  return mount(TwinRightPane, {
    props: {
      config: CONFIG,
      selection: TWIN_SELECT_MODEL,
      modelNodes: [],
      picking: false,
      roamPreviewing: false,
      gizmoMode: 'translate' as const,
      frameOrigin: ORIGIN,
      bindings: [],
      isDirty: false,
    },
  })
}

/** 切到某个页签；页签是一排按钮。 */
async function openTab(
  wrapper: ReturnType<typeof mountPane>,
  label: string,
): Promise<void> {
  const tab = wrapper
    .findAll('button')
    .find((item) => item.text().trim() === label)
  await tab?.trigger('click')
}

describe('顶层分页', () => {
  it('默认停在属性页', () => {
    const wrapper = mountPane()

    expect(wrapper.text()).not.toContain('锚点读数')
  })

  it('切到绑定页时摆出这段孪生的全部绑定槽', async () => {
    const wrapper = mountPane()

    await openTab(wrapper, '绑定')

    expect(wrapper.text()).toContain('锚点读数')
    expect(wrapper.text()).toContain('信息牌字段')
  })

  it('换选中不会把人从绑定页踢回属性页', async () => {
    const wrapper = mountPane()
    await openTab(wrapper, '绑定')

    await wrapper.setProps({ selection: { kind: 'anchors', id: 'a1' } })

    expect(wrapper.text()).toContain('锚点读数')
  })

  it('切回属性页还能回到检查器', async () => {
    const wrapper = mountPane()
    await openTab(wrapper, '绑定')

    await openTab(wrapper, '属性')

    expect(wrapper.text()).not.toContain('锚点读数')
  })
})
