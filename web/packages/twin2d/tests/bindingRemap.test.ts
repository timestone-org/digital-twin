/**
 * @fileoverview 三个数组槽的绑定在配置改动之后跟不跟得住实体。
 *
 * ⚠ 这一层守的是整套 2D 孪生绑定里最安静的那个错：行号是文档序，实体本身不在
 * fieldKey 里露面——删掉一个实体、或改样式改掉了行数之后，它后面每一行都改喂前一个
 * 实体。绑定还在、读数照常刷新，只是全接错了对象，界面上一点异常都看不出来。
 */
import { describe, expect, it } from 'vitest'

import { remapTwin2dBindings } from '../src/bindingRemap'
import { normalizeTwin2dConfig } from '../src/normalize'

/** 一枚引用某个槽键的文本图元：槽位要被静态引用到才算有效槽位（§14.2）。 */
function txt(slot: string) {
  return { id: `t-${slot}`, kind: 'txt', src: { kind: 'slot', slot } }
}

/** 一个样式：每个槽位都配一枚引用它的文本图元，于是每个槽位都占一行。 */
function style(slots: readonly string[], shown: readonly string[] = slots) {
  return {
    id: 's1',
    slots: slots.map((key) => ({ key, label: key })),
    prims: shown.map((key) => txt(key)),
  }
}

/** 一份配置要哪几个槽位、哪几个节点、哪几条连线。 */
interface DocSpec {
  slots?: readonly string[]
  shown?: readonly string[]
  nodes?: readonly string[]
  edges?: readonly string[]
}

/**
 * 一份归一化好的配置：一个样式带给定槽位，节点全用它，连线一律从头一个节点连到
 * 第二个。
 * @param spec 要哪几个槽位、节点与连线
 */
function doc(spec: DocSpec) {
  const slots = spec.slots ?? ['temp', 'flow']
  const nodes = spec.nodes ?? ['n1']
  return normalizeTwin2dConfig({
    styles: [style(slots, spec.shown ?? slots)],
    nodes: nodes.map((id) => ({ id, styleId: 's1', label: id })),
    edges: (spec.edges ?? []).map((id) => ({
      id,
      from: { nodeId: nodes[0] },
      to: { nodeId: nodes[1] ?? nodes[0] },
    })),
  })
}

/** 一条绑定：`nodeKey` 记着它原本在哪一行，搬完拿它核对接的还是不是同一个实体。 */
function binding(fieldKey: string) {
  return { fieldKey, nodeKey: fieldKey }
}

/** 搬完之后「新行号 → 它原本在哪一行」。 */
function movedBy(moved: readonly { fieldKey: string; nodeKey: string }[]) {
  return new Map(moved.map((one) => [one.fieldKey, one.nodeKey]))
}

describe('改样式改掉了行数', () => {
  // ⚠ 这一条是整份文件存在的理由：行数由「节点 × 有效槽位」决定，改样式就会改行数
  it('给样式插一个新槽位，其后每一行的绑定跟着后移，接的还是原来那个节点与槽位', () => {
    const before = doc({ slots: ['temp', 'flow'], nodes: ['n1', 'n2'] })
    const after = doc({ slots: ['power', 'temp', 'flow'], nodes: ['n1', 'n2'] })

    const moved = movedBy(
      remapTwin2dBindings(before, after, [
        binding('nodeValues[0].value'),
        binding('nodeValues[3].value'),
      ]),
    )

    // n1 · temp 从第 0 行挪到第 1 行，n2 · flow 从第 3 行挪到第 5 行
    expect(moved.get('nodeValues[1].value')).toBe('nodeValues[0].value')
    expect(moved.get('nodeValues[5].value')).toBe('nodeValues[3].value')
    expect(moved.size).toBe(2)
  })

  it('删掉引用某个槽位的那枚图元，这个槽退出行，它的绑定丢弃、其后前移', () => {
    const before = doc({ slots: ['temp', 'flow'], nodes: ['n1', 'n2'] })
    const after = doc({
      slots: ['temp', 'flow'],
      shown: ['temp'],
      nodes: ['n1', 'n2'],
    })

    const moved = movedBy(
      remapTwin2dBindings(before, after, [
        binding('nodeValues[1].value'),
        binding('nodeValues[2].value'),
      ]),
    )

    // n1 · flow 没有行了整条丢掉；n2 · temp 从第 2 行挪到第 1 行
    expect(moved.get('nodeValues[1].value')).toBe('nodeValues[2].value')
    expect(moved.size).toBe(1)
  })

  it('同一个节点上的两个槽位各搬各的，不互相串行', () => {
    const before = doc({ slots: ['temp', 'flow'], nodes: ['n1'] })
    const after = doc({ slots: ['flow', 'temp'], nodes: ['n1'] })

    const moved = movedBy(
      remapTwin2dBindings(before, after, [
        binding('nodeValues[0].value'),
        binding('nodeValues[1].value'),
      ]),
    )

    expect(moved.get('nodeValues[1].value')).toBe('nodeValues[0].value')
    expect(moved.get('nodeValues[0].value')).toBe('nodeValues[1].value')
  })
})

describe('实体增删与重排', () => {
  it('删掉中间一个节点，其后的绑定整体前移，仍然喂原来那个节点', () => {
    const before = doc({ slots: ['temp'], nodes: ['n1', 'n2', 'n3'] })
    const after = doc({ slots: ['temp'], nodes: ['n1', 'n3'] })

    const moved = movedBy(
      remapTwin2dBindings(before, after, [
        binding('nodeValues[0].value'),
        binding('nodeValues[2].value'),
      ]),
    )

    expect(moved.get('nodeValues[0].value')).toBe('nodeValues[0].value')
    expect(moved.get('nodeValues[1].value')).toBe('nodeValues[2].value')
  })

  it('被删节点自己那条整条丢掉，不留着占一个行号', () => {
    const before = doc({ slots: ['temp'], nodes: ['n1', 'n2'] })
    const after = doc({ slots: ['temp'], nodes: ['n2'] })

    const moved = remapTwin2dBindings(before, after, [
      binding('nodeValues[0].value'),
      binding('nodeValues[1].value'),
    ])

    expect(moved).toHaveLength(1)
    expect(moved[0]?.nodeKey).toBe('nodeValues[1].value')
  })

  it('重排节点，绑定跟着节点走而不是跟着行号走', () => {
    const before = doc({ slots: ['temp'], nodes: ['n1', 'n2', 'n3'] })
    const after = doc({ slots: ['temp'], nodes: ['n3', 'n1', 'n2'] })

    const moved = movedBy(
      remapTwin2dBindings(before, after, [
        binding('nodeValues[0].value'),
        binding('nodeValues[2].value'),
      ]),
    )

    expect(moved.get('nodeValues[1].value')).toBe('nodeValues[0].value')
    expect(moved.get('nodeValues[0].value')).toBe('nodeValues[2].value')
  })

  it('新增节点不动任何既有绑定，连对象都还是原来那个', () => {
    const before = doc({ slots: ['temp'], nodes: ['n1'] })
    const after = doc({ slots: ['temp'], nodes: ['n1', 'n2'] })
    const bindings = [binding('nodeValues[0].value')]

    const moved = remapTwin2dBindings(before, after, bindings)

    expect(moved).toEqual(bindings)
    expect(moved[0]).toBe(bindings[0])
  })

  it('配置一个字都没改时一条绑定都不动', () => {
    const config = doc({ slots: ['temp', 'flow'], nodes: ['n1', 'n2'] })
    const bindings = [
      binding('nodeValues[0].value'),
      binding('nodeStatus[1].status'),
    ]

    expect(remapTwin2dBindings(config, config, bindings)).toEqual(bindings)
  })
})

describe('三个槽各自的稳定键', () => {
  it('状态行按节点对齐，删一个节点之后其后的状态绑定跟着前移', () => {
    const before = doc({ slots: ['temp'], nodes: ['n1', 'n2', 'n3'] })
    const after = doc({ slots: ['temp'], nodes: ['n1', 'n3'] })

    const moved = movedBy(
      remapTwin2dBindings(before, after, [
        binding('nodeStatus[2].status'),
        binding('nodeStatus[1].status'),
      ]),
    )

    expect(moved.get('nodeStatus[1].status')).toBe('nodeStatus[2].status')
    expect(moved.size).toBe(1)
  })

  // ⚠ 一条连线只占一行、行名挂在 active 上，另外两个子槽没有自己的行——只搬 active
  //   会把流向与标签读数留在旧行号上，从此喂给另一条连线
  it('连线的三个子槽一起搬，不只搬行名挂着的那一个', () => {
    const before = doc({ nodes: ['n1', 'n2'], edges: ['e1', 'e2'] })
    const after = doc({ nodes: ['n1', 'n2'], edges: ['e2'] })

    const moved = remapTwin2dBindings(before, after, [
      binding('edgeValues[1].active'),
      binding('edgeValues[1].direction'),
      binding('edgeValues[1].value'),
    ])

    expect(moved.map((one) => one.fieldKey)).toEqual([
      'edgeValues[0].active',
      'edgeValues[0].direction',
      'edgeValues[0].value',
    ])
  })

  it('删掉的连线，它三个子槽的绑定一起丢', () => {
    const before = doc({ nodes: ['n1', 'n2'], edges: ['e1'] })
    const after = doc({ nodes: ['n1', 'n2'], edges: [] })

    expect(
      remapTwin2dBindings(before, after, [
        binding('edgeValues[0].active'),
        binding('edgeValues[0].value'),
      ]),
    ).toEqual([])
  })

  it('节点与连线的行号互不干扰：同号不同槽各搬各的', () => {
    const before = doc({ slots: ['temp'], nodes: ['n1', 'n2'], edges: ['e1'] })
    const after = doc({ slots: ['temp'], nodes: ['n2', 'n1'], edges: ['e1'] })

    const moved = movedBy(
      remapTwin2dBindings(before, after, [
        binding('nodeValues[1].value'),
        binding('edgeValues[0].active'),
      ]),
    )

    expect(moved.get('nodeValues[0].value')).toBe('nodeValues[1].value')
    expect(moved.get('edgeValues[0].active')).toBe('edgeValues[0].active')
  })
})

describe('不归它管的那些绑定', () => {
  const CONFIG = doc({ slots: ['temp'], nodes: ['n1'] })

  it('形状不认识的 fieldKey 原样留着，不误删别人的数据', () => {
    const moved = remapTwin2dBindings(CONFIG, CONFIG, [binding('title')])

    expect(moved.map((one) => one.fieldKey)).toEqual(['title'])
  })

  it('别的槽即使前缀一样也不动', () => {
    const moved = remapTwin2dBindings(CONFIG, CONFIG, [
      binding('nodeValues2[0].value'),
    ])

    expect(moved.map((one) => one.fieldKey)).toEqual(['nodeValues2[0].value'])
  })

  // 行数钉在实体上，超出的那些行在绑点面板上摆成孤行；实体那头本来就没有它
  it('行号超出的孤行整条丢掉', () => {
    const moved = remapTwin2dBindings(CONFIG, CONFIG, [
      binding('nodeValues[9].value'),
      binding('nodeStatus[9].status'),
      binding('edgeValues[0].active'),
    ])

    expect(moved).toEqual([])
  })

  it('一条绑定都没有时给一张空表', () => {
    expect(remapTwin2dBindings(CONFIG, CONFIG, [])).toEqual([])
  })
})
