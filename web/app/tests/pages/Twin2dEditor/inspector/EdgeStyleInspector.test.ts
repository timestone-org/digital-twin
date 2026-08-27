/**
 * @fileoverview 契约：连线样式检查器把一份连线样式的整体面摆全，改动只以整份新配置
 * 往上抛；预置样式在面上说清「改一项 = 在本图里落一份覆盖」，而「恢复内置」删的是
 * 那条覆盖，**不是**把预置数据写进文档。
 *
 * ⚠ 只有落了覆盖的那一档才给「恢复内置」：预置那一档本来就不在文档里，摆一枚按下去
 * 什么都不做的键比没有更糟。
 * ⚠ 标签底板是「有 / 没有」两档（`box` 为 null 即不画），不是一堆恒存在的格子：
 * 塞一份空底板进去会在每条线的标签后面留一块看不见却占位的板。
 */
import { TWIN_2D_EDGE_PRESETS, normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dEdgeStyle } from '@dt/twin2d'
import { DtCheckbox, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Component } from 'vue'

import EdgeMarkerField from '@/pages/Twin2dEditor/components/fields/EdgeMarkerField.vue'
import EdgeStyleInspector from '@/pages/Twin2dEditor/components/inspector/EdgeStyleInspector.vue'
import { twin2dEdgeStyleOf } from '@/pages/Twin2dEditor/scripts/styleOps'

/** 夹具坏了要当场炸。 */
function throwMissing(): never {
  throw new Error('预置连线样式库是空的')
}

const PRESET_ID = (TWIN_2D_EDGE_PRESETS[0] ?? throwMissing()).id

/** 自建的一份，外加两条用它的线。 */
const OWN: Twin2dConfig = normalizeTwin2dConfig({
  edgeStyles: [{ id: 'wire', name: '我的线', cornerRadius: 4 }],
  nodes: [{ id: 'n1' }, { id: 'n2' }],
  edges: [
    { id: 'e1', styleId: 'wire', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } },
    { id: 'e2', styleId: 'wire', from: { nodeId: 'n2' }, to: { nodeId: 'n1' } },
  ],
})

/** 文档里压着一份同 id 的预置覆盖。 */
const OVERRIDE: Twin2dConfig = normalizeTwin2dConfig({
  edgeStyles: [{ id: PRESET_ID, name: '改过的' }],
})

/** 一条覆盖都没有的干净配置。 */
const CLEAN: Twin2dConfig = normalizeTwin2dConfig({})

/**
 * 挂一份检查器。
 * @param config 整份配置
 * @param id 正在编辑的样式 id
 */
function mountInspector(config: Twin2dConfig, id: string) {
  const style = twin2dEdgeStyleOf(config, id)
  if (style === null) throw new Error(`${id} 解析不出连线样式`)
  return mount(EdgeStyleInspector, { props: { config, edgeStyle: style } })
}

type Wrapper = ReturnType<typeof mountInspector>

/**
 * 最后一次写出去的样式。
 * @param wrapper 挂好的检查器
 * @param event 一次性还是合并
 */
function styleAfter(
  wrapper: Wrapper,
  event: 'change' | 'merge' = 'merge',
): Twin2dEdgeStyle {
  const last = wrapper.emitted(event)?.at(-1)?.[0] as Twin2dConfig | undefined
  const style = last?.edgeStyles.at(-1)
  if (style === undefined) throw new Error('没有写出任何样式')
  return style
}

/**
 * 按 data-test 取一个下拉或勾选框。
 * ⚠ 两种控件写成联合会被 `no-duplicate-type-constituents` 误判成重复（两者的
 * `DefineComponent` 大得让规则比不出差别，其实一个抛 string 一个抛 boolean）；
 * 本件只按 `data-test` 认人、不碰各自的 props，所以收一个泛的组件就够。
 * @param wrapper 挂好的检查器
 * @param what 组件
 * @param test 那一格的 data-test
 */
function cell(wrapper: Wrapper, what: Component, test: string) {
  const found = wrapper
    .findAllComponents(what)
    .find((item) => item.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这一格`)
  return found
}

/**
 * 数字框：改文本再落定，走的是控件自己的解析与夹取。
 * ⚠ `data-test` 落在 DtNumberInput 内部那个 input 上，从组件那一层取不到。
 * @param wrapper 挂好的检查器
 * @param test 那一格的 data-test
 * @param text 敲进去的文本
 */
async function typeNumber(
  wrapper: Wrapper,
  test: string,
  text: string,
): Promise<void> {
  const input = wrapper.find(`[data-test="${test}"]`)
  await input.setValue(text)
  await input.trigger('change')
}

describe('来路', () => {
  it('预置那一档把「改一项就是落一份覆盖」说在面上', () => {
    const wrapper = mountInspector(CLEAN, PRESET_ID)

    expect(wrapper.find('[data-test="edge-style-builtin"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="edge-style-restore"]').exists()).toBe(
      false,
    )
  })

  it('自建那一档既不提示覆盖也不给恢复', () => {
    const wrapper = mountInspector(OWN, 'wire')

    expect(wrapper.find('[data-test="edge-style-builtin"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-test="edge-style-restore"]').exists()).toBe(
      false,
    )
  })

  it('数得出有几条线在用', () => {
    const wrapper = mountInspector(OWN, 'wire')

    expect(wrapper.find('[data-test="edge-style-id"]').text()).toContain(
      '2 条线在用',
    )
  })

  // ⚠ 写死预置数据的话，预置库将来升级就再也修不到这张图
  it('恢复内置删的是那条覆盖，样式表里不再有那个 id', async () => {
    const wrapper = mountInspector(OVERRIDE, PRESET_ID)

    await wrapper.find('[data-test="edge-style-restore"]').trigger('click')

    const next = wrapper.emitted('change')?.at(-1)?.[0] as Twin2dConfig
    expect(next.edgeStyles.map((style) => style.id)).not.toContain(PRESET_ID)
  })
})

describe('几格直读直写', () => {
  it('改名走合并撤销，合并键带着样式 id', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    await wrapper.find('input[data-test="edge-style-name"]').setValue('冷水管')

    expect(wrapper.emitted('merge')?.at(-1)?.[1]).toBe('edge-style:wire:name')
    expect(styleAfter(wrapper).name).toBe('冷水管')
  })

  it('换走线档落一步撤销', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    cell(wrapper, DtSelect, 'edge-style-route').vm.$emit(
      'update:modelValue',
      'bezier',
    )
    await wrapper.vm.$nextTick()

    expect(styleAfter(wrapper, 'change').route).toBe('bezier')
  })

  it('认不出的走线档一步不写', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    cell(wrapper, DtSelect, 'edge-style-route').vm.$emit(
      'update:modelValue',
      '斜着走',
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  // ⚠ 数字框每次失焦都回抛一次当前值，不比一遍就白记一帧撤销
  it('拐角半径写回同一个数时不记帧', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    await typeNumber(wrapper, 'edge-style-corner', '4')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('拐角半径换一个数就落一帧', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    await typeNumber(wrapper, 'edge-style-corner', '9')

    expect(styleAfter(wrapper, 'change').cornerRadius).toBe(9)
  })
})

describe('流动与非活跃', () => {
  it('开流动动画', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    cell(wrapper, DtCheckbox, 'edge-style-flow-on').vm.$emit(
      'update:modelValue',
      true,
    )
    await wrapper.vm.$nextTick()

    expect(styleAfter(wrapper).flow.enabled).toBe(true)
  })

  it('虚线节奏逐键解析，认不出的那一段丢掉', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    await wrapper
      .find('input[data-test="edge-style-flow-dash"]')
      .setValue('6, 4 abc 2')

    expect(styleAfter(wrapper).flow.dash).toEqual([6, 4, 2])
  })

  it('非活跃拉直成实线', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    cell(wrapper, DtCheckbox, 'edge-style-inactive-dash').vm.$emit(
      'update:modelValue',
      true,
    )
    await wrapper.vm.$nextTick()

    expect(styleAfter(wrapper).inactive.dashOff).toBe(true)
  })
})

describe('端点标记与标签', () => {
  it('把起点标记换成箭头', async () => {
    const wrapper = mountInspector(OWN, 'wire')
    const markers = wrapper.findAllComponents(EdgeMarkerField)

    markers[0]?.vm.$emit('update:modelValue', { kind: 'arrow', size: 9 })
    await wrapper.vm.$nextTick()

    expect(styleAfter(wrapper, 'change').startMarker.kind).toBe('arrow')
  })

  // ⚠ 只 setValue 不 trigger('change')：本件不把值喂回去，控件在 change 那一下会
  // 按 prop 拨回原值再回抛一次，末尾那一笔就成了「清空」
  it('改标签字号', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    await wrapper.find('[data-test="edge-style-font-size"]').setValue('15')

    expect(styleAfter(wrapper).label.font.size).toBe(15)
  })

  // ⚠ 缺席才是「跟随排版」：写一个显式 undefined 进去与缺席是两回事
  it('清空字号是把这个键删掉', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    await typeNumber(wrapper, 'edge-style-font-size', '')

    expect('size' in styleAfter(wrapper).label.font).toBe(false)
  })

  // ⚠ `box` 为 null 才是「不画底板」那一档
  it('打开底板给一份带缺省的，再关掉是 null', async () => {
    const wrapper = mountInspector(OWN, 'wire')
    const box = cell(wrapper, DtCheckbox, 'edge-style-label-box')

    box.vm.$emit('update:modelValue', true)
    await wrapper.vm.$nextTick()
    expect(styleAfter(wrapper).label.box).not.toBeNull()

    box.vm.$emit('update:modelValue', false)
    await wrapper.vm.$nextTick()
    expect(styleAfter(wrapper).label.box).toBeNull()
  })

  it('根节点失焦就断段', async () => {
    const wrapper = mountInspector(OWN, 'wire')

    await wrapper.find('[data-test="edge-style-inspector"]').trigger('focusout')

    expect(wrapper.emitted('endMerge')).toHaveLength(1)
  })
})
