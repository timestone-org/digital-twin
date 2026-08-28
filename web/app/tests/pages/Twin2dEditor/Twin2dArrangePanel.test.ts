/**
 * @fileoverview 契约：多选之后的批量摆位。摆得动的只有节点与标注两类、少于两个整块
 * 不画、等间距要三个起步，六档对齐与两档等间距各自真的落到坐标上，而没改动的那一下
 * 一个字都不往上抛。
 *
 * ⚠ 节点盒要并上预置库才算得出来：只喂文档里那几份的话，用预置样式的节点在这一批里
 * 原地不动，而界面上什么都不说。
 * ⚠ 空步会静默污染撤销栈：抛一份与入参同引用的配置，撤销键就得多按一次才回得去。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Twin2dArrangePanel from '@/pages/Twin2dEditor/components/Twin2dArrangePanel.vue'
import type { Twin2dPick } from '@/pages/Twin2dEditor/scripts/editorSelection'

/** 40×20 的方块；三个节点摆成参差不齐的一排。 */
const STYLE = { id: 's1', name: '方块', size: { w: 40, h: 20 } }

const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20 },
  styles: [STYLE],
  nodes: [
    { id: 'a', styleId: 's1', x: 100, y: 40 },
    { id: 'b', styleId: 's1', x: 220, y: 90 },
    { id: 'c', styleId: 's1', x: 500, y: 160 },
  ],
  marks: [
    { id: 'm1', kind: 'rect', x: 40, y: 400, w: 60, h: 40 },
    { id: 'm2', kind: 'rect', x: 240, y: 430, w: 60, h: 40 },
  ],
})

/** 用预置库里那份样式的节点：并没并上预置库，只有它看得出来。 */
const BUILTIN_CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20 },
  nodes: [
    { id: 'a', styleId: 'heat-exchanger', x: 100, y: 40 },
    { id: 'b', styleId: 'heat-exchanger', x: 300, y: 200 },
  ],
})

function pickOf(kind: Twin2dPick['kind'], ids: readonly string[]): Twin2dPick {
  return { kind, ids }
}

function mountPanel(pick: Twin2dPick | null, config = CONFIG) {
  return mount(Twin2dArrangePanel, { props: { config, pick } })
}

type Wrapper = ReturnType<typeof mountPanel>

/** 上抛的那一份新配置；一次都没抛时抛出错。 */
function changed(wrapper: Wrapper): Twin2dConfig {
  const events = wrapper.emitted<[Twin2dConfig]>('change') ?? []
  const last = events.at(-1)
  if (last === undefined) throw new Error('一份新配置都没抛')
  return last[0]
}

/** 这一批节点现在的横坐标。 */
function xs(config: Twin2dConfig): number[] {
  return config.nodes.map((node) => node.x)
}

describe('什么时候摆得动', () => {
  it('一个都没选时整块不画', () => {
    expect(mountPanel(null).find('[data-test="arrange-panel"]').exists()).toBe(
      false,
    )
  })

  // ⚠ 一个也「对齐」不出什么来：摆一排按了没反应的键，用户只会以为是坏了
  it('只选中一个时整块不画', () => {
    const wrapper = mountPanel(pickOf('nodes', ['a']))

    expect(wrapper.find('[data-test="arrange-panel"]').exists()).toBe(false)
  })

  // ⚠ 连线的两端认的是节点与端口，挪线本身没有意义
  it('选的是连线时整块不画', () => {
    const wrapper = mountPanel(pickOf('edges', ['e1', 'e2']))

    expect(wrapper.find('[data-test="arrange-panel"]').exists()).toBe(false)
  })

  it('选了两个节点就摆得动，且数目与类别都写在面上', () => {
    const wrapper = mountPanel(pickOf('nodes', ['a', 'b']))

    expect(wrapper.find('[data-test="arrange-count"]').text()).toBe(
      '已选 2 个节点',
    )
  })

  it('标注也摆得动，面上说的是标注', () => {
    const wrapper = mountPanel(pickOf('marks', ['m1', 'm2']))

    expect(wrapper.find('[data-test="arrange-count"]').text()).toBe(
      '已选 2 个标注',
    )
  })
})

describe('对齐', () => {
  it('左对齐把这一批推到最左那个的左边上', async () => {
    const wrapper = mountPanel(pickOf('nodes', ['a', 'b', 'c']))

    await wrapper.find('[data-test="arrange-align-left"]').trigger('click')

    expect(xs(changed(wrapper))).toEqual([100, 100, 100])
  })

  it('底对齐吃的是节点自己的高，不是同一个数', async () => {
    const wrapper = mountPanel(pickOf('nodes', ['a', 'b', 'c']))

    await wrapper.find('[data-test="arrange-align-bottom"]').trigger('click')

    // 三个都是 40×20，最下那个底边在 180，于是三个的顶边都落在 160
    expect(changed(wrapper).nodes.map((node) => node.y)).toEqual([
      160, 160, 160,
    ])
  })

  it('只点名选中的那些，没选的一动不动', async () => {
    const wrapper = mountPanel(pickOf('nodes', ['a', 'b']))

    await wrapper.find('[data-test="arrange-align-left"]').trigger('click')

    expect(xs(changed(wrapper))).toEqual([100, 100, 500])
  })

  it('标注按自己的盒对齐', async () => {
    const wrapper = mountPanel(pickOf('marks', ['m1', 'm2']))

    await wrapper.find('[data-test="arrange-align-top"]').trigger('click')

    expect(changed(wrapper).marks.map((mark) => mark.y)).toEqual([400, 400])
  })

  // ⚠ 抄一份「文档里的样式」进来的话，用预置样式的节点取不到尺寸，于是原地不动
  it('用预置库样式的节点也摆得动', async () => {
    const wrapper = mountPanel(pickOf('nodes', ['a', 'b']), BUILTIN_CONFIG)

    await wrapper.find('[data-test="arrange-align-left"]').trigger('click')

    expect(xs(changed(wrapper))).toEqual([100, 100])
  })

  // ⚠ 抛一份没改动的配置会往撤销栈里塞一格空步，撤销键从此要多按一次
  it('已经对齐好了就一个字都不抛', async () => {
    const wrapper = mountPanel(pickOf('nodes', ['a', 'b', 'c']))
    await wrapper.find('[data-test="arrange-align-left"]').trigger('click')
    await wrapper.setProps({ config: changed(wrapper) })
    const before = (wrapper.emitted('change') ?? []).length

    await wrapper.find('[data-test="arrange-align-left"]').trigger('click')

    expect(wrapper.emitted('change')).toHaveLength(before)
  })
})

describe('等间距', () => {
  it('两个时那两枚键禁用，点不出事件', async () => {
    const wrapper = mountPanel(pickOf('nodes', ['a', 'b']))
    const button = wrapper.find('[data-test="arrange-distribute-x"]')

    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('三个时把中间那个摆到缝一样宽的位置上', async () => {
    const wrapper = mountPanel(pickOf('nodes', ['a', 'b', 'c']))

    await wrapper.find('[data-test="arrange-distribute-x"]').trigger('click')

    // 两端 100 与 500 不动，三只各 40 宽，两条缝各 (440 − 120) / 2 = 160
    expect(xs(changed(wrapper))).toEqual([100, 300, 500])
  })
})
