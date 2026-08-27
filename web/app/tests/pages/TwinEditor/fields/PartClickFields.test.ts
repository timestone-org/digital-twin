/**
 * @fileoverview 契约：部件点击这一节把「远于分界切视角、近于分界弹详情」配得出来，
 * 三条阈值各自能整条不配，且改一样东西不把另一样抹成缺省。
 *
 * ⚠ 配了「飞到取景」却什么都没存时运行态会退回自动框住——界面上必须说出来，
 * 否则用户以为配好了一个机位，而现场飞到的是另一个位置。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type {
  TwinCamera,
  TwinClickDistanceRule,
  TwinPartClick,
} from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PartClickFields from '@/pages/TwinEditor/components/fields/PartClickFields.vue'

function partOf(over: Record<string, unknown> = {}) {
  const part = normalizeTwinConfig({ parts: [{ id: 'p1', ...over }] }).parts[0]
  if (part === undefined) throw new Error('造不出部件')
  return part
}

function camerasOf(): TwinCamera[] {
  return normalizeTwinConfig({
    cameras: [{ id: 'c1', name: '总览', position: [1, 2, 3] }],
  }).cameras
}

function render(
  over: Record<string, unknown> = {},
  cameras: readonly TwinCamera[] = camerasOf(),
) {
  const part = partOf(over)
  return mount(PartClickFields, {
    props: { modelValue: part.click, distance: part.clickDistance, cameras },
  })
}

type Wrapper = ReturnType<typeof render>

function lastClick(wrapper: Wrapper): TwinPartClick {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回点击动作')
  return events[events.length - 1]?.[0] as TwinPartClick
}

function lastDistance(wrapper: Wrapper): TwinClickDistanceRule {
  const events = wrapper.emitted('update:distance')
  if (!events?.length) throw new Error('没有写回点击距离')
  return events[events.length - 1]?.[0] as TwinClickDistanceRule
}

/** 三个下拉按模板序：远档动作、（远档展开的视点）、近档动作。 */
function selectAt(wrapper: Wrapper, index: number) {
  const found = wrapper.findAllComponents(DtSelect)[index]
  if (found === undefined) throw new Error(`没有第 ${index + 1} 个下拉`)
  return found
}

describe('两档动作', () => {
  it('远档缺省是把部件框进画面，近档缺省不弹窗', () => {
    const wrapper = render()

    expect(selectAt(wrapper, 0).props('modelValue')).toBe('approach')
    expect(selectAt(wrapper, 1).props('modelValue')).toBe('none')
  })

  it('改远档动作只动它自己', () => {
    const wrapper = render({ click: { near: 'detail' } })

    selectAt(wrapper, 0).vm.$emit('update:modelValue', 'none')

    expect(lastClick(wrapper)).toMatchObject({ far: 'none', near: 'detail' })
  })

  it('改近档动作只动它自己', () => {
    const wrapper = render({ click: { far: 'none' } })

    selectAt(wrapper, 1).vm.$emit('update:modelValue', 'detail')

    expect(lastClick(wrapper)).toMatchObject({ far: 'none', near: 'detail' })
  })

  // 下拉是受控的字符串口，认不出的值不该写进配置
  it('认不出的档位一个字都不写', () => {
    const wrapper = render()

    selectAt(wrapper, 0).vm.$emit('update:modelValue', '???')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('联动照发这一条写在旁边', () => {
    expect(render().text()).toContain('联动事件两档都照发')
  })
})

describe('远距取景', () => {
  it('远档不是「飞到取景」时不摆取景那一堆控件', () => {
    expect(render().find('[data-test="part-capture-view"]').exists()).toBe(
      false,
    )
  })

  it('取当前机位上抛给页面去存', async () => {
    const wrapper = render({ click: { far: 'view' } })

    await wrapper.get('[data-test="part-capture-view"]').trigger('click')

    expect(wrapper.emitted('captureView')).toHaveLength(1)
  })

  it('没存机位时不给「清除取景」', () => {
    const wrapper = render({ click: { far: 'view' } })

    expect(wrapper.find('[data-test="part-clear-view"]').exists()).toBe(false)
  })

  it('清除取景把快照清成 null，视点一个字不动', async () => {
    const wrapper = render({
      click: { far: 'view', cameraId: 'c1', view: { position: [1, 2, 3] } },
    })

    await wrapper.get('[data-test="part-clear-view"]').trigger('click')

    expect(lastClick(wrapper)).toMatchObject({ view: null, cameraId: 'c1' })
  })

  // ⚠ 两个都配了时预设视点静默不生效，界面上要摆明
  it('快照与视点都配了时说明视点不生效', () => {
    const wrapper = render({
      click: { far: 'view', cameraId: 'c1', view: { position: [1, 2, 3] } },
    })

    expect(wrapper.text()).toContain('取景快照优先')
  })

  it('视点已经删了就当场标出来', () => {
    const wrapper = render({ click: { far: 'view', cameraId: 'gone' } })

    expect(wrapper.text()).toContain('视点 gone 不存在')
  })

  it('既没机位也没视点时说明会退回自动框住', () => {
    const wrapper = render({ click: { far: 'view' } })

    expect(wrapper.text()).toContain('退回把这个部件框进画面')
  })

  // ⚠ 没有分界就没有远档：配好的机位永远飞不到
  it('没配远近分界时说明这个取景飞不到', () => {
    const wrapper = render({
      click: { far: 'view', view: { position: [1, 2, 3] } },
    })

    expect(wrapper.text()).toContain('这个取景永远飞不到')
  })

  it('配了分界就不再提醒', () => {
    const wrapper = render({
      click: { far: 'view', view: { position: [1, 2, 3] } },
      clickDistance: { farThreshold: { ref: 'orbit', value: 20 } },
    })

    expect(wrapper.text()).not.toContain('这个取景永远飞不到')
  })

  it('存了机位就不再提醒', () => {
    const wrapper = render({
      click: { far: 'view', view: { position: [1, 2, 3] } },
    })

    expect(wrapper.text()).not.toContain('既没存机位也没挑视点')
  })
})

describe('点击距离', () => {
  it('三条阈值各自可以整条不配', () => {
    const wrapper = render()

    for (const label of [
      '近于此距离不响应',
      '远于此距离不响应',
      '远近两档的分界',
    ]) {
      expect(
        wrapper.find(`button[role="switch"][aria-label="${label}"]`).exists(),
      ).toBe(true)
    }
  })

  // ⚠ 阈值与动作分开写回，改一个不许把另一个抹掉
  it('开一条阈值只动它自己', async () => {
    const wrapper = render()

    await wrapper
      .find('button[role="switch"][aria-label="远近两档的分界"]')
      .trigger('click')

    const next = lastDistance(wrapper)
    expect(next.farThreshold).not.toBeNull()
    expect(next.min).toBeNull()
    expect(next.max).toBeNull()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('把「不限制」的口径写在旁边', () => {
    expect(render().text()).toContain('阈值 ≤ 0 或距离取不到')
  })
})
