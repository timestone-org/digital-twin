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
const MultiStub = stub('multi', [
  'config',
  'preset',
  'select-type',
  'visible-batch',
  'size-batch',
])
const STUBS = {
  MultiSelectPanel: MultiStub,
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

describe('多选面板的批量事件逐个转发', () => {
  it('config / preset / select-type / size-batch 原样转出', () => {
    const wrapper = render(['n1', 'n2'])
    const multi = wrapper.findComponent(MultiStub)

    multi.vm.$emit('config', ['title'], '值', true)
    multi.vm.$emit('preset', { id: 'p', label: '预', config: {} })
    multi.vm.$emit('select-type', ['n1'])
    multi.vm.$emit('size-batch', 'both')

    expect(wrapper.emitted('config')).toEqual([[['title'], '值', true]])
    expect(wrapper.emitted('preset')).toEqual([
      [{ id: 'p', label: '预', config: {} }],
    ])
    expect(wrapper.emitted('select-type')).toEqual([[['n1']]])
    expect(wrapper.emitted('size-batch')).toEqual([['both']])
  })

  it('批量显隐并进单选的 visible 出口——页面侧本就写整个选中集', () => {
    const wrapper = render(['n1', 'n2'])

    wrapper.findComponent(MultiStub).vm.$emit('visible-batch', false)

    expect(wrapper.emitted('visible')).toEqual([[false]])
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
