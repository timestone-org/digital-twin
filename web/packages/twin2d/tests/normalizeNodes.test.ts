/**
 * @fileoverview 锁住节点实例归一化的口径：没有 id 的一条必须丢、坐标可以为负、
 * 尺寸 0 是「跟样式走」的哨兵而不是真尺寸、非法 rotate 回 0 而不是取最近一档、
 * tags 只做 trim 与截断、去重后仍是文档序（文档序就是绑定行号）。
 */
import { describe, expect, it } from 'vitest'

import {
  normalizeNode,
  normalizeNodePatch,
  normalizeNodes,
  normalizeTags,
} from '../src/normalizeNodes'

/** 一个能通过归一化的最小节点 */
const MINIMAL = { id: 'n1' }

describe('normalizeTags', () => {
  it('非对象一律收成空表', () => {
    expect(normalizeTags(null)).toEqual({})
    expect(normalizeTags(['a'])).toEqual({})
    expect(normalizeTags('subtype=solar')).toEqual({})
  })

  it('键与值都去空白', () => {
    expect(normalizeTags({ '  subtype  ': '  solar  ' })).toEqual({
      subtype: 'solar',
    })
  })

  it('空键整条丢弃，空值保留成空串', () => {
    expect(normalizeTags({ '   ': 'solar', subtype: 42 })).toEqual({
      subtype: '',
    })
  })

  it('键与值都截到长度上限', () => {
    const long = 'x'.repeat(80)
    const tags = normalizeTags({ [long]: long })
    const key = Object.keys(tags)[0] ?? ''
    expect(key).toHaveLength(64)
    expect(tags[key]).toHaveLength(64)
  })

  it('trim 后重复的键后来者丢弃', () => {
    expect(normalizeTags({ subtype: 'solar', '  subtype  ': 'steam' })).toEqual(
      {
        subtype: 'solar',
      },
    )
  })

  it('__proto__ 这类键落成自有属性，不改原型', () => {
    const tags = normalizeTags({ ['__proto__']: 'solar' })
    expect(Object.hasOwn(tags, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  it('结果冻结，调用方改不动', () => {
    expect(Object.isFrozen(normalizeTags({ subtype: 'solar' }))).toBe(true)
    expect(Object.isFrozen(normalizeTags(null))).toBe(true)
  })
})

describe('normalizeNodePatch', () => {
  it('非对象一律收成空表', () => {
    expect(normalizeNodePatch(undefined)).toEqual({})
    expect(normalizeNodePatch([{ z: 1 }])).toEqual({})
  })

  it('键按图元 id 去空白后保留', () => {
    expect(Object.keys(normalizeNodePatch({ '  icon  ': { z: 3 } }))).toEqual([
      'icon',
    ])
  })

  it('空键与非对象的值整条丢弃', () => {
    const patch = normalizeNodePatch({
      '   ': { z: 1 },
      icon: 'z=3',
      halo: { z: 3 },
    })
    expect(Object.keys(patch)).toEqual(['halo'])
  })

  it('trim 后重复的键后来者丢弃', () => {
    const patch = normalizeNodePatch({ icon: { z: 1 }, ' icon ': { z: 9 } })
    expect(Object.keys(patch)).toEqual(['icon'])
  })
})

describe('normalizeNode', () => {
  it('非对象与数组都不是节点', () => {
    expect(normalizeNode(null)).toBeNull()
    expect(normalizeNode(['n1'])).toBeNull()
  })

  it('没有 id 的一条丢弃', () => {
    expect(normalizeNode({})).toBeNull()
    expect(normalizeNode({ id: '   ' })).toBeNull()
    expect(normalizeNode({ id: Number.NaN })).toBeNull()
  })

  it('数字 id 走 String() 化', () => {
    expect(normalizeNode({ id: 12 })?.id).toBe('12')
  })

  it('缺省节点每个键都有值', () => {
    expect(normalizeNode(MINIMAL)).toEqual({
      id: 'n1',
      styleId: '',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      rotate: 0,
      flipX: false,
      flipY: false,
      label: '',
      labelPos: 'bottom',
      status: '',
      accent: '',
      badge: '',
      badgeColor: '',
      badgeShape: 'round',
      tags: {},
      slots: [],
      layers: [],
      patch: {},
      ports: [],
    })
  })

  it('坐标为负不夹取——图可以往左上扩', () => {
    const node = normalizeNode({ ...MINIMAL, x: -320, y: -18.5 })
    expect(node?.x).toBe(-320)
    expect(node?.y).toBe(-18.5)
  })

  it('坐标取不到数才回 0', () => {
    const node = normalizeNode({
      ...MINIMAL,
      x: 'left',
      y: Number.POSITIVE_INFINITY,
    })
    expect(node?.x).toBe(0)
    expect(node?.y).toBe(0)
  })

  it('尺寸 0 与负数回哨兵 0，表示跟样式走', () => {
    expect(normalizeNode({ ...MINIMAL, w: 0, h: -40 })).toMatchObject({
      w: 0,
      h: 0,
    })
    expect(normalizeNode({ ...MINIMAL, w: 120, h: 88 })).toMatchObject({
      w: 120,
      h: 88,
    })
  })

  it('rotate 只认四档，45 度回 0 而不是取最近的一档', () => {
    expect(normalizeNode({ ...MINIMAL, rotate: 270 })?.rotate).toBe(270)
    expect(normalizeNode({ ...MINIMAL, rotate: '180' })?.rotate).toBe(180)
    expect(normalizeNode({ ...MINIMAL, rotate: 45 })?.rotate).toBe(0)
    expect(normalizeNode({ ...MINIMAL, rotate: 'ccw' })?.rotate).toBe(0)
  })

  it('镜像只认真布尔', () => {
    expect(normalizeNode({ ...MINIMAL, flipX: true, flipY: 1 })).toMatchObject({
      flipX: true,
      flipY: false,
    })
  })

  it('显示名位置非法回 bottom', () => {
    expect(normalizeNode({ ...MINIMAL, labelPos: 'inside' })?.labelPos).toBe(
      'inside',
    )
    expect(normalizeNode({ ...MINIMAL, labelPos: 'middle' })?.labelPos).toBe(
      'bottom',
    )
  })

  it('静态 status 只认四档；hidden 是样式那一档的取值，节点上不认', () => {
    expect(normalizeNode({ ...MINIMAL, status: '  alarm  ' })?.status).toBe(
      'alarm',
    )
    expect(normalizeNode({ ...MINIMAL, status: 'hidden' })?.status).toBe('')
    expect(normalizeNode({ ...MINIMAL, status: 1 })?.status).toBe('')
  })

  it('角标形状非法回 round', () => {
    expect(
      normalizeNode({ ...MINIMAL, badgeShape: 'diamond' })?.badgeShape,
    ).toBe('diamond')
    expect(normalizeNode({ ...MINIMAL, badgeShape: 'star' })?.badgeShape).toBe(
      'round',
    )
  })

  it('文本类字段去空白后原样保留', () => {
    expect(
      normalizeNode({
        ...MINIMAL,
        styleId: ' src-solar ',
        label: ' 1# 空压机 ',
        accent: ' #16a34a ',
        badge: ' A ',
        badgeColor: ' #fff ',
      }),
    ).toMatchObject({
      styleId: 'src-solar',
      label: '1# 空压机',
      accent: '#16a34a',
      badge: 'A',
      badgeColor: '#fff',
    })
  })

  it('tags、patch、追加槽位、追加图元与追加端口都接上各自的归一化', () => {
    const node = normalizeNode({
      ...MINIMAL,
      tags: { subtype: ' solar ' },
      patch: { icon: { z: 3 } },
      slots: [{ key: 'temp', label: '温度' }],
      layers: [{ id: 'l1', kind: 'box' }],
      ports: [{ id: 'p1', name: '1' }],
    })
    expect(node?.tags).toEqual({ subtype: 'solar' })
    expect(Object.keys(node?.patch ?? {})).toEqual(['icon'])
    expect(node?.slots.map((slot) => slot.key)).toEqual(['temp'])
    expect(node?.layers.map((prim) => prim.id)).toEqual(['l1'])
    expect(node?.ports.map((port) => port.id)).toEqual(['p1'])
  })
})

describe('normalizeNodes', () => {
  it('非数组收成空表', () => {
    expect(normalizeNodes(null)).toEqual([])
    expect(normalizeNodes({ 0: MINIMAL })).toEqual([])
  })

  it('丢弃脏条目后仍是文档序——文档序就是绑定行号', () => {
    const nodes = normalizeNodes([
      { id: 'a' },
      'not-a-node',
      { id: '  ' },
      { id: 'b' },
    ])
    expect(nodes.map((node) => node.id)).toEqual(['a', 'b'])
  })

  it('同 id 后来者丢弃', () => {
    const nodes = normalizeNodes([
      { id: 'a', label: '先来' },
      { id: 'b' },
      { id: 'a', label: '后到' },
    ])
    expect(nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(nodes[0]?.label).toBe('先来')
  })
})
