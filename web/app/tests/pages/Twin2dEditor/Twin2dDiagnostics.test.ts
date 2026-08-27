/**
 * @fileoverview 契约：诊断面板逐条列出配置问题、两档严重度分得开、`at` 路径显示得出来，
 * 点一条跳到出问题的那个实体；零问题时给一句话而不是一个空列表。
 *
 * ⚠ 面板吃的是**原始** config：喂归一化结果进来不会报错，只是「被整条丢掉了什么」
 * 那一族整族消失——面板照样报绿，而那正是最需要被说出来的一族。末尾有一条钉住它。
 * ⚠ 被整条丢掉的条目在归一化结果里根本不存在：那些行必须不可点，硬跳过去只会选中
 * 一个无辜的邻居，而那比不能跳难查得多。
 * ⚠ DtIcon 遇到没登记的图标名静默不画，typecheck 与 lint 双双放行，只能在这里兜。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Twin2dDiagnostics from '@/pages/Twin2dEditor/components/Twin2dDiagnostics.vue'

/**
 * 一份五条问题齐全的坏配置：两档严重度、两族判据、能跳与不能跳各有。
 * ⚠ 被丢掉的那个节点排在最后：排在中间的话它之后每一条的归一化下标都会错开一位，
 * 而那是另一条用例的事。
 */
const BROKEN = {
  canvas: { width: 400, height: 200 },
  styles: [
    {
      id: 'st',
      prims: [{ id: 'p1', kind: 'ico', src: { kind: 'sprite', id: 'ghost' } }],
    },
  ],
  nodes: [
    {
      id: 'n1',
      styleId: 'st',
      x: 10,
      y: 10,
      patch: { ghostPrim: { hidden: true } },
    },
    { id: 'n2', styleId: 'no-such-style', x: 40, y: 40 },
    { styleId: 'st', x: 70, y: 70 },
  ],
  edges: [
    {
      id: 'e1',
      from: { nodeId: 'n1' },
      to: { nodeId: 'n2' },
      waypoints: [{ x: -80, y: 20 }],
    },
  ],
}

function mountPanel(config: unknown = BROKEN) {
  return mount(Twin2dDiagnostics, { props: { config } })
}

type Wrapper = ReturnType<typeof mountPanel>

/** 按 code 取那一行；没有就当场炸，免得断言对着 undefined 报绿。 */
function rowOf(wrapper: Wrapper, code: string) {
  const row = wrapper
    .findAll('[data-test="diagnostics-row"]')
    .find((item) => item.attributes('data-code') === code)
  if (row === undefined) throw new Error(`缺少 ${code} 这一条`)
  return row
}

function codesOf(wrapper: Wrapper): string[] {
  return wrapper
    .findAll('[data-test="diagnostics-row"]')
    .map((row) => row.attributes('data-code') ?? '')
}

describe('渲染', () => {
  it('没有问题时给一句话，不是一片空白', () => {
    const wrapper = mountPanel({})

    expect(wrapper.find('[data-test="diagnostics-empty"]').text()).toContain(
      '没有发现配置问题',
    )
    expect(wrapper.findAll('[data-test="diagnostics-row"]')).toHaveLength(0)
  })

  it('每条问题各占一行', () => {
    expect(codesOf(mountPanel())).toEqual([
      'dangling-style',
      'dangling-prim',
      'waypoint-out-of-canvas',
      'dropped-node',
      'dangling-sprite',
    ])
  })

  it('一条问题读得出短标签、字段路径与后果', () => {
    const row = rowOf(mountPanel(), 'dangling-style')

    expect(row.text()).toContain('样式找不到')
    expect(row.get('[data-test="diagnostics-at"]').text()).toBe(
      'nodes[1].styleId',
    )
    expect(row.text()).toContain('__fallback 兜底样式')
  })

  // ⚠ 只靠颜色分两档的话，色觉障碍与黑白截图两种情形下这两档完全一样
  it('两档严重度的档位、图标与色三处都不一样', () => {
    const wrapper = mountPanel()
    const bad = rowOf(wrapper, 'dangling-style')
    const soft = rowOf(wrapper, 'waypoint-out-of-canvas')

    expect(bad.attributes('data-level')).toBe('error')
    expect(soft.attributes('data-level')).toBe('warn')
    expect(bad.get('.dt-icon').html()).not.toBe(soft.get('.dt-icon').html())
    expect(bad.html()).toContain('text-state-danger')
    expect(soft.html()).toContain('text-state-warning')
  })

  it('每一行都真的画出了那个警示图标', () => {
    const rows = mountPanel().findAll('[data-test="diagnostics-row"]')

    expect(rows.every((row) => row.find('.dt-icon').exists())).toBe(true)
  })

  it('表头报总数，并按档各报一个数', () => {
    const wrapper = mountPanel()

    expect(wrapper.get('[data-test="diagnostics-total"]').text()).toBe(
      '5 条问题',
    )
    expect(wrapper.text()).toContain('画不出来 3')
    expect(wrapper.text()).toContain('与配置不符 2')
  })

  // ⚠ 悬浮提示把路径与后果并起来：窄栏里两段都会被截断
  it('整行的悬浮提示带上路径与后果', () => {
    expect(rowOf(mountPanel(), 'dropped-node').attributes('title')).toBe(
      'nodes[2]：这个节点没有可用的 id，整条会被丢掉',
    )
  })
})

describe('吃的是原始 config', () => {
  // ⚠ 归一化把这些条目整条丢掉了，喂它的输出进来那一族永远是空的——面板照样报绿，
  // 而「配好的东西为什么不见了」就此没有任何一处说得出来
  it('喂归一化后的配置进来，被丢掉的那一族就此消失', () => {
    const codes = codesOf(mountPanel(normalizeTwin2dConfig(BROKEN)))

    expect(codes).not.toContain('dropped-node')
    expect(codes).not.toContain('dangling-sprite')
    expect(codes).toContain('dangling-style')
  })

  it('压根不是对象时不炸，只是一条问题都没有', () => {
    const wrapper = mountPanel('这不是一份配置')

    expect(wrapper.find('[data-test="diagnostics-empty"]').exists()).toBe(true)
  })
})

describe('点一条跳过去', () => {
  it('悬空样式跳到那个节点', async () => {
    const wrapper = mountPanel()

    await rowOf(wrapper, 'dangling-style').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([
      { kind: 'nodes', id: 'n2' },
    ])
  })

  it('落空的覆盖补丁跳到写着它的那个节点', async () => {
    const wrapper = mountPanel()

    await rowOf(wrapper, 'dangling-prim').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([
      { kind: 'nodes', id: 'n1' },
    ])
  })

  it('画布外的拐点跳到那条连线', async () => {
    const wrapper = mountPanel()

    await rowOf(wrapper, 'waypoint-out-of-canvas').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([
      { kind: 'edges', id: 'e1' },
    ])
  })

  it('图元树里的问题跳到那份样式', async () => {
    const wrapper = mountPanel()

    await rowOf(wrapper, 'dangling-sprite').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([
      { kind: 'styles', id: 'st' },
    ])
  })

  // ⚠ 这一条指的节点在归一化结果里根本不存在，跳过去只会选中一个无辜的邻居
  it('被整条丢掉的那条不可点', async () => {
    const wrapper = mountPanel()
    const row = rowOf(wrapper, 'dropped-node')

    expect(row.attributes('disabled')).toBeDefined()
    await row.trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  // ⚠ 数组里混进来的非对象连 id 都取不出来，更没有一个实体可跳
  it('数组里混进来的非对象那一条同样不可点', async () => {
    const wrapper = mountPanel({ ...BROKEN, nodes: ['这不是一个节点'] })
    const row = rowOf(wrapper, 'dropped-node')

    expect(row.attributes('disabled')).toBeDefined()
    await row.trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  // ⚠ 前面被丢掉一条之后，两族的下标就此错开一位；宁可不可点，也不跳到隔壁那个
  it('下标在两族之间对不上时那一行不可点', async () => {
    const shifted = {
      ...BROKEN,
      nodes: [{ styleId: 'st' }, ...BROKEN.nodes.slice(0, 2)],
    }
    const wrapper = mountPanel(shifted)

    await rowOf(wrapper, 'dangling-style').trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
