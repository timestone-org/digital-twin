/**
 * @fileoverview 守标注归一化：三档 kind 闭合、缺省逐值与参考项目对齐、
 * 字体键「缺席即跟随主题」不许被补成空串。
 * ⚠ 补全字体键这一类错误零报错：文档里多出一个 `family: ''`，图上的字就悄悄
 * 从主题字体退回浏览器默认字形。
 */
import { describe, expect, it } from 'vitest'

import { normalizeMark, normalizeMarks } from '../src/normalizeMarks'

function markRaw(patch: Record<string, unknown>): Record<string, unknown> {
  return { id: 'm1', kind: 'rect', ...patch }
}

describe('标注身份与档位', () => {
  it('补全全部键，缺省与参考项目逐值对齐', () => {
    expect(normalizeMark({ id: 'm1', kind: 'rect' })).toEqual({
      id: 'm1',
      kind: 'rect',
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      x2: 0,
      y2: 0,
      text: '',
      font: {},
      labelPos: 'top',
      labelAlignH: 'center',
      labelAlignV: 'top',
      stroke: '',
      fill: '',
      strokeWidth: 2,
      strokeDash: false,
      opacity: 1,
      zOrder: 'below',
      nonScalingStroke: false,
    })
  })

  it('三档 kind 都收，认不出的丢弃整条', () => {
    expect(normalizeMark(markRaw({ kind: 'line' }))?.kind).toBe('line')
    expect(normalizeMark(markRaw({ kind: 'text' }))?.kind).toBe('text')
    expect(normalizeMark(markRaw({ kind: 'circle' }))).toBeNull()
    expect(normalizeMark(markRaw({ kind: 3 }))).toBeNull()
    expect(normalizeMark({ id: 'm1' })).toBeNull()
  })

  it('不是对象、或 id 缺失，丢弃整条', () => {
    expect(normalizeMark(null)).toBeNull()
    expect(normalizeMark(['rect'])).toBeNull()
    expect(normalizeMark(markRaw({ id: '  ' }))).toBeNull()
  })

  it('数字 id 走 String() 收', () => {
    expect(normalizeMark(markRaw({ id: 12 }))?.id).toBe('12')
  })
})

describe('几何与缺省', () => {
  it('坐标取有限数，取不到回 0', () => {
    const mark = normalizeMark(markRaw({ x: '15', y: Number.NaN }))
    expect(mark?.x).toBe(15)
    expect(mark?.y).toBe(0)
  })

  it('宽高必须 > 0，0 与负数回缺省', () => {
    expect(normalizeMark(markRaw({ w: 0, h: -4 }))).toMatchObject({
      w: 120,
      h: 80,
    })
    expect(normalizeMark(markRaw({ w: 300, h: 200 }))).toMatchObject({
      w: 300,
      h: 200,
    })
  })

  it('辅助线的终点缺省落在起点上，不横穿画布连到原点', () => {
    const mark = normalizeMark(markRaw({ kind: 'line', x: 400, y: 250 }))
    expect(mark).toMatchObject({ x2: 400, y2: 250 })
  })

  it('给了终点就用给的', () => {
    const mark = normalizeMark(
      markRaw({ kind: 'line', x: 400, y: 250, x2: 500, y2: 260 }),
    )
    expect(mark).toMatchObject({ x2: 500, y2: 260 })
  })
})

describe('外观', () => {
  it('描边与填充留空表示由渲染层回退，不在文档里写死主题色', () => {
    expect(normalizeMark(markRaw({ stroke: '  ', fill: 7 }))).toMatchObject({
      stroke: '',
      fill: '',
    })
    expect(
      normalizeMark(markRaw({ stroke: ' var(--x) ', fill: '#123' })),
    ).toMatchObject({ stroke: 'var(--x)', fill: '#123' })
  })

  it('线宽压回非负，取不到数回缺省 2', () => {
    expect(normalizeMark(markRaw({ strokeWidth: -3 }))?.strokeWidth).toBe(0)
    expect(normalizeMark(markRaw({ strokeWidth: 0 }))?.strokeWidth).toBe(0)
    expect(normalizeMark(markRaw({ strokeWidth: 6 }))?.strokeWidth).toBe(6)
    expect(normalizeMark(markRaw({ strokeWidth: 'x' }))?.strokeWidth).toBe(2)
  })

  it('不透明度夹到 [0,1]', () => {
    expect(normalizeMark(markRaw({ opacity: 2 }))?.opacity).toBe(1)
    expect(normalizeMark(markRaw({ opacity: -1 }))?.opacity).toBe(0)
    expect(normalizeMark(markRaw({ opacity: 0.4 }))?.opacity).toBe(0.4)
  })

  it('两个开关只认真布尔', () => {
    expect(
      normalizeMark(markRaw({ strokeDash: true, nonScalingStroke: true })),
    ).toMatchObject({ strokeDash: true, nonScalingStroke: true })
    expect(
      normalizeMark(markRaw({ strokeDash: 1, nonScalingStroke: 'true' })),
    ).toMatchObject({ strokeDash: false, nonScalingStroke: false })
  })

  it('上下两档 zOrder 都收，认不出沉到节点层之下', () => {
    expect(normalizeMark(markRaw({ zOrder: 'above' }))?.zOrder).toBe('above')
    expect(normalizeMark(markRaw({ zOrder: 'middle' }))?.zOrder).toBe('below')
  })
})

describe('标签排版', () => {
  it('三档位置与两轴对齐都收，认不出各回自己的缺省', () => {
    expect(
      normalizeMark(
        markRaw({
          labelPos: 'inside',
          labelAlignH: 'right',
          labelAlignV: 'middle',
        }),
      ),
    ).toMatchObject({
      labelPos: 'inside',
      labelAlignH: 'right',
      labelAlignV: 'middle',
    })
    expect(
      normalizeMark(
        markRaw({
          labelPos: 'left',
          labelAlignH: 'justify',
          labelAlignV: 'center',
        }),
      ),
    ).toMatchObject({
      labelPos: 'top',
      labelAlignH: 'center',
      labelAlignV: 'top',
    })
  })

  it('文字取 trim 后的值', () => {
    expect(normalizeMark(markRaw({ kind: 'text', text: ' N1 ' }))?.text).toBe(
      'N1',
    )
    expect(normalizeMark(markRaw({ text: 9 }))?.text).toBe('')
  })
})

describe('标签字体', () => {
  it('字体不是对象时是一份空值 = 整份跟随主题', () => {
    expect(normalizeMark(markRaw({ font: 'PingFang' }))?.font).toEqual({})
    expect(normalizeMark(markRaw({}))?.font).toEqual({})
  })

  it('五个键各自收，字重同时收数与串', () => {
    const font = normalizeMark(
      markRaw({
        font: {
          family: ' PingFang SC ',
          size: 16,
          weight: 600,
          letterSpacing: -0.2,
          color: ' #fff ',
        },
      }),
    )?.font
    expect(font).toEqual({
      family: 'PingFang SC',
      size: 16,
      weight: 600,
      letterSpacing: -0.2,
      color: '#fff',
    })
    expect(
      normalizeMark(markRaw({ font: { weight: ' bold ' } }))?.font,
    ).toEqual({
      weight: 'bold',
    })
  })

  it('取不到的键一律缺席，不补成空串或 0', () => {
    const font = normalizeMark(
      markRaw({
        font: {
          family: '   ',
          size: 0,
          weight: Number.NaN,
          letterSpacing: 'x',
          color: 5,
        },
      }),
    )?.font
    expect(font).toEqual({})
    expect(Object.keys(font ?? {})).toHaveLength(0)
  })

  it('负字号也当没给（负字号会让整行字消失且不报错）', () => {
    expect(normalizeMark(markRaw({ font: { size: -12 } }))?.font).toEqual({})
  })
})

describe('整份标注列表', () => {
  it('非数组是空列表', () => {
    expect(normalizeMarks(undefined)).toEqual([])
  })

  it('丢弃脏条目，其余保持文档序', () => {
    const marks = normalizeMarks([
      markRaw({ id: 'm1' }),
      null,
      markRaw({ id: 'm2', kind: 'blob' }),
      markRaw({ id: 'm3', kind: 'line' }),
    ])
    expect(marks.map((mark) => mark.id)).toEqual(['m1', 'm3'])
  })

  it('同 id 只留最先出现的一条', () => {
    const marks = normalizeMarks([
      markRaw({ id: 'm1', text: '先' }),
      markRaw({ id: 'm1', text: '后' }),
    ])
    expect(marks).toHaveLength(1)
    expect(marks[0]?.text).toBe('先')
  })
})
