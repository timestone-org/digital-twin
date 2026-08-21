/**
 * @fileoverview 契约：逐段覆盖按「刚飞完那一段」记，留空即回到全局值。
 *
 * ⚠ 停留算在前一段的尾巴上：想让镜头「到 B 之后多停一会儿」，配的是 A → B 那行。
 * 行上把两站都写出来就是为了不让人配错行。
 * ⚠ 两项都清空时那条覆盖必须整个消失，否则表里会攒下一堆什么都不改的空壳。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinCamera, TwinRoamTour } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RoamSegmentFields from '@/pages/TwinEditor/components/fields/RoamSegmentFields.vue'

const CONFIG = normalizeTwinConfig({
  cameras: [
    { id: 'c1', name: '全景' },
    { id: 'c2', name: '俯视' },
  ],
})

const CAMERAS: readonly TwinCamera[] = CONFIG.cameras

function makeTour(over: Record<string, unknown> = {}): TwinRoamTour {
  return normalizeTwinConfig({
    roamTour: {
      enabled: true,
      items: ['c1', 'c2'],
      loop: false,
      segmentMs: 2000,
      pauseMs: 1000,
      ...over,
    },
  }).roamTour
}

function mountFields(tour: TwinRoamTour = makeTour()) {
  return mount(RoamSegmentFields, {
    props: {
      tour,
      cameras: CAMERAS,
      maxFlySeconds: 30,
      maxHoldSeconds: 10,
    },
  })
}

type Wrapper = ReturnType<typeof mountFields>

function lastTour(wrapper: Wrapper): TwinRoamTour {
  const events = wrapper.emitted('update:tour')
  if (!events?.length) throw new Error('没有整份写回漫游配置')
  return events[events.length - 1]?.[0] as TwinRoamTour
}

function inputAt(wrapper: Wrapper, index: number) {
  const found = wrapper.findAll('input')[index]
  if (!found) throw new Error(`没有第 ${index} 个输入框`)
  return found
}

describe('逐段列表', () => {
  it('一行一段，标题把两站都写出来', () => {
    expect(mountFields().text()).toContain('全景 → 俯视')
  })

  it('循环时多出「末站飞回首站」那一行', () => {
    const wrapper = mountFields(makeTour({ loop: true }))

    expect(wrapper.text()).toContain('俯视 → 全景')
  })

  it('站点不够两个时说清没有可飞的段', () => {
    const wrapper = mountFields(makeTour({ items: ['c1'] }))

    // 面板寸土寸金：空态走行内单行档，不带图标
    const empty = wrapper.get('.dt-empty--inline')
    expect(empty.text()).toContain('还没有可飞的段')
    expect(empty.find('svg').exists()).toBe(false)
  })

  it('没配覆盖时输入框是空的，并提示用的是全局值', () => {
    const wrapper = mountFields()

    expect(inputAt(wrapper, 0).element.value).toBe('')
    expect(wrapper.text()).toContain('留空用 2 秒')
    expect(wrapper.text()).toContain('留空用 1 秒')
  })
})

describe('写回覆盖', () => {
  it('填了飞行秒数就落成这一段的覆盖', async () => {
    const wrapper = mountFields()
    const input = inputAt(wrapper, 0)

    await input.setValue('5')
    await input.trigger('blur')

    expect(lastTour(wrapper).segmentSettings.c1).toEqual({
      segmentMs: 5000,
      pauseMs: null,
    })
  })

  it('停留配在起始站那一条上', async () => {
    const wrapper = mountFields()
    const input = inputAt(wrapper, 1)

    await input.setValue('3')
    await input.trigger('blur')

    expect(lastTour(wrapper).segmentSettings.c1).toEqual({
      segmentMs: null,
      pauseMs: 3000,
    })
  })

  it('已有覆盖时按秒回显', () => {
    const wrapper = mountFields(
      makeTour({ segmentSettings: { c1: { segmentMs: 700 } } }),
    )

    expect(inputAt(wrapper, 0).element.value).toBe('0.7')
  })

  // ⚠ 清空 = 回到全局值，不是「覆盖成 0 秒」
  it('清空最后一项时整条覆盖被删掉', async () => {
    const wrapper = mountFields(
      makeTour({ segmentSettings: { c1: { segmentMs: 700 } } }),
    )
    const input = inputAt(wrapper, 0)

    await input.setValue('')
    await input.trigger('blur')

    expect(lastTour(wrapper).segmentSettings).toEqual({})
  })

  it('只清一项时另一项的覆盖还在', async () => {
    const wrapper = mountFields(
      makeTour({
        segmentSettings: { c1: { segmentMs: 700, pauseMs: 400 } },
      }),
    )
    const input = inputAt(wrapper, 0)

    await input.setValue('')
    await input.trigger('blur')

    expect(lastTour(wrapper).segmentSettings.c1).toEqual({
      segmentMs: null,
      pauseMs: 400,
    })
  })
})
