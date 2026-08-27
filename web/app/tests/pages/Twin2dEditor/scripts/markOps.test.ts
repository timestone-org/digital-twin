/**
 * @fileoverview 契约：标注的增删改、复制、层序与对齐分布全是纯函数，改完再归一化不变形。
 *
 * ⚠ 挪一条标注要连 `x2/y2` 一起挪：辅助线的第二个端点是绝对坐标而不是相对起点的偏移，
 * 只挪 `x/y` 的表现是一拖起点线就越拉越长，而每一处取值都是「对」的。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  addMark,
  alignMarks,
  distributeMarks,
  duplicateMarks,
  orderMarks,
  removeMarks,
  updateMark,
} from '@/pages/Twin2dEditor/scripts/markOps'

/** 造 id 的桩：按调用次序发号。 */
function idSeries(prefix: string): () => string {
  let seq = 0
  return () => {
    seq += 1
    return `${prefix}${seq}`
  }
}

function configOf(): Twin2dConfig {
  return normalizeTwin2dConfig({
    marks: [
      { id: 'm1', kind: 'rect', x: 0, y: 0, w: 40, h: 20 },
      { id: 'm2', kind: 'rect', x: 100, y: 60, w: 20, h: 40 },
      { id: 'm3', kind: 'line', x: 10, y: 10, x2: 50, y2: 30 },
    ],
  })
}

function idsOf(config: Twin2dConfig): string[] {
  return config.marks.map((mark) => mark.id)
}

describe('新增', () => {
  it('追加在末尾并交出新 id', () => {
    const next = addMark(configOf(), { kind: 'text', text: '注' }, () => 'm9')

    expect(next.id).toBe('m9')
    expect(idsOf(next.config)).toEqual(['m1', 'm2', 'm3', 'm9'])
  })

  // ⚠ 三档之外的 kind 会被归一化整条丢掉，这时不许交出一个指不到实处的 id
  it('kind 认不出时落不了地，原样返回并交出 null', () => {
    const config = configOf()

    const next = addMark(config, { text: '注' }, () => 'm9')

    expect(next.id).toBeNull()
    expect(next.config).toBe(config)
  })

  it('改完再归一化不变形', () => {
    const next = addMark(configOf(), { kind: 'rect' }, () => 'm9').config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('改值', () => {
  it('只换被点名的那一条', () => {
    const next = updateMark(configOf(), 'm2', { text: '机房', opacity: 0.5 })

    expect(next.marks[1]?.text).toBe('机房')
    expect(next.marks[1]?.opacity).toBe(0.5)
    expect(next.marks[0]?.text).toBe('')
  })

  it('标注不在就原样返回入参那个引用', () => {
    const config = configOf()

    expect(updateMark(config, 'nope', { text: 'x' })).toBe(config)
  })

  // ⚠ 逐键写回时归一化会把刚敲下的空格 trim 掉
  it('改值不过归一化，用户敲的空格留得住', () => {
    expect(updateMark(configOf(), 'm1', { text: '一区 ' }).marks[0]?.text).toBe(
      '一区 ',
    )
  })
})

describe('复制', () => {
  it('副本插在原件后面并带上位移', () => {
    const next = duplicateMarks(
      configOf(),
      ['m1'],
      { x: 5, y: 7 },
      idSeries('copy'),
    )

    expect(next.ids).toEqual(['copy1'])
    expect(idsOf(next.config)).toEqual(['m1', 'copy1', 'm2', 'm3'])
    expect(next.config.marks[1]?.x).toBe(5)
    expect(next.config.marks[1]?.y).toBe(7)
  })

  // ⚠ 只挪起点的话，辅助线会越拖越长
  it('辅助线的两端一起挪', () => {
    const next = duplicateMarks(configOf(), ['m3'], { x: 5, y: 5 }).config
    const copy = next.marks[3]

    expect(copy?.x).toBe(15)
    expect(copy?.y).toBe(15)
    expect(copy?.x2).toBe(55)
    expect(copy?.y2).toBe(35)
  })

  it('一条都没点中时原样返回入参那个引用', () => {
    const config = configOf()

    expect(duplicateMarks(config, ['nope'], { x: 1, y: 1 }).config).toBe(config)
  })

  it('改完再归一化不变形', () => {
    const next = duplicateMarks(configOf(), ['m2'], { x: 4, y: 4 }).config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('删除', () => {
  it('删标注不级联到别处', () => {
    const next = removeMarks(configOf(), ['m1', 'm3'])

    expect(idsOf(next.config)).toEqual(['m2'])
    expect(next.removed.marks).toEqual(['m1', 'm3'])
    expect(next.removed.nodes).toEqual([])
    expect(next.removed.edges).toEqual([])
  })

  it('一条都没点中时原样返回入参那个引用', () => {
    const config = configOf()
    const next = removeMarks(config, ['nope'])

    expect(next.config).toBe(config)
    expect(next.removed.marks).toEqual([])
  })

  it('改完再归一化不变形', () => {
    const next = removeMarks(configOf(), ['m2']).config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('层序', () => {
  it('置顶挪到末尾、置底挪到表头', () => {
    expect(idsOf(orderMarks(configOf(), ['m1'], 'front'))).toEqual([
      'm2',
      'm3',
      'm1',
    ])
    expect(idsOf(orderMarks(configOf(), ['m3'], 'back'))).toEqual([
      'm3',
      'm1',
      'm2',
    ])
  })

  it('上下各挪一层', () => {
    expect(idsOf(orderMarks(configOf(), ['m1'], 'forward'))).toEqual([
      'm2',
      'm1',
      'm3',
    ])
    expect(idsOf(orderMarks(configOf(), ['m3'], 'backward'))).toEqual([
      'm1',
      'm3',
      'm2',
    ])
  })

  it('挪不动时原样返回入参那个引用', () => {
    const config = configOf()

    expect(orderMarks(config, ['m3'], 'front')).toBe(config)
  })
})

describe('对齐与分布', () => {
  it('按左边对齐，没点中的不动', () => {
    const next = alignMarks(configOf(), ['m1', 'm2'], 'left')

    expect(next.marks.map((mark) => mark.x)).toEqual([0, 0, 10])
  })

  // ⚠ 辅助线的盒是两端的外接盒，对齐要把两端一起挪
  it('辅助线按右边对齐时两端一起挪', () => {
    const next = alignMarks(configOf(), ['m2', 'm3'], 'right')
    const line = next.marks[2]

    expect(line?.x).toBe(80)
    expect(line?.x2).toBe(120)
  })

  it('三条沿横轴摆成等距', () => {
    const config = normalizeTwin2dConfig({
      marks: [
        { id: 'm1', kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { id: 'm2', kind: 'rect', x: 20, y: 0, w: 10, h: 10 },
        { id: 'm3', kind: 'rect', x: 100, y: 0, w: 10, h: 10 },
      ],
    })

    const next = distributeMarks(config, ['m1', 'm2', 'm3'], 'x')

    expect(next.marks.map((mark) => mark.x)).toEqual([0, 50, 100])
  })

  it('一步都不用挪时原样返回入参那个引用', () => {
    const config = configOf()

    expect(alignMarks(config, ['m1'], 'left')).toBe(config)
    expect(distributeMarks(config, ['m1', 'm2'], 'x')).toBe(config)
  })
})
