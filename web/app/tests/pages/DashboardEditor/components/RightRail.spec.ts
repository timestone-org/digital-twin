/**
 * @fileoverview 契约：右栏永远有内容。
 * ⚠ 三选一写成两选一时不会报错，只会在某个选中数下留一块空白栏——
 * 而空白栏看起来像「这个模块没有可配的东西」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'

import RightRail from '@/pages/DashboardEditor/components/RightRail.vue'

/** 只留一处 defineComponent：写成三处会撞 `one-component-per-file`。 */
function stub(testId: string, emits: string[]) {
  return defineComponent({ emits, template: `<div data-test="${testId}" />` })
}

const InspectorStub = stub('inspector', ['interactions'])
const ChromeStub = stub('chrome', ['set-interactions'])
const STUBS = {
  MultiSelectPanel: stub('multi', []),
  InspectorPane: InspectorStub,
  ChromePanel: ChromeStub,
}

function render(selectedIds: string[]) {
  return mount(RightRail, {
    props: {
      selectedIds,
      selected: null,
      nodes: [],
      getManifest: () => undefined,
      rules: [],
      draft: null,
      snap: { enabled: true, mode: 'px' as const, step: 8, guides: true },
      grid: { cols: 24, rows: 30, marginX: 8, marginY: 8 },
      alignReady: false,
      distributeReady: false,
    },
    global: { stubs: STUBS },
  })
}

describe('按选中的个数三选一', () => {
  it('没选中时落到页面面板，而不是留一块空白栏', () => {
    const wrapper = render([])

    expect(wrapper.find('[data-test="chrome"]').exists()).toBe(true)
  })

  it('选中一个时是属性面板', () => {
    const wrapper = render(['n1'])

    expect(wrapper.find('[data-test="inspector"]').exists()).toBe(true)
  })

  it('选中多个时是多选面板', () => {
    const wrapper = render(['n1', 'n2'])

    expect(wrapper.find('[data-test="multi"]').exists()).toBe(true)
  })

  it('任何选中数下都只有一个面板在', () => {
    for (const ids of [[], ['n1'], ['n1', 'n2']]) {
      const wrapper = render(ids)
      const shown = ['multi', 'inspector', 'chrome'].filter((name) =>
        wrapper.find(`[data-test="${name}"]`).exists(),
      )
      expect(shown).toHaveLength(1)
    }
  })
})

describe('两个面板的联动改动走同一个出口', () => {
  it('属性面板与页面面板的联动都抛成 interactions', () => {
    const single = render(['n1'])
    single.findComponent(InspectorStub).vm.$emit('interactions', [])
    const none = render([])
    none.findComponent(ChromeStub).vm.$emit('set-interactions', [])

    expect(single.emitted('interactions')).toHaveLength(1)
    expect(none.emitted('interactions')).toHaveLength(1)
  })
})
