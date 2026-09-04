/**
 * @fileoverview 横条的取数：条长的基准、零线的位置、四种 mode 的几何，
 * 以及退化分支（空 / 单项 / 全零 / 全负 / 全同值 / 截断 / 算不出来）。
 *
 * ⚠ 这里钉的每一条都是「画出来仍旧像张图、但读出来是错的」那一类：基准钉死会
 * 把一排真系数画成谁都不重要，把 null 当 0 会把「算不出来」说成「是零」。
 */
import { describe, expect, it } from 'vitest'

import {
  buildBarList,
  MAX_BAR_ROWS,
  type BarListItem,
  type BarListOptions,
  type BarListView,
} from '@/pages/Modeling/Canvas/scripts/barList'

const PAIR_LABELS: readonly [string, string] = ['之前', '之后']

function view(
  items: readonly BarListItem[],
  extra: Partial<BarListOptions> = {},
): BarListView {
  return buildBarList(items, {
    mode: 'single',
    unit: '',
    pairLabels: PAIR_LABELS,
    reference: null,
    threshold: null,
    maxItems: MAX_BAR_ROWS,
    ...extra,
  })
}

function widths(built: BarListView): string[] {
  return built.rows.flatMap((row) =>
    row.pieces.map((piece) => piece.style.width),
  )
}

function lefts(built: BarListView): string[] {
  return built.rows.flatMap((row) =>
    row.pieces.map((piece) => piece.style.left),
  )
}

describe('条长的基准', () => {
  // ⚠ 基准钉死成 1 的话，未标准化量纲上的小系数整排缩成看不见的一丝
  it('基准是实际最大值，不是钉死的 1', () => {
    const built = view([
      { name: 'a', value: 0.0012 },
      { name: 'b', value: 0.0003 },
    ])

    expect(widths(built)).toEqual(['100%', '25%'])
  })

  it('全零时不除以 0，条子收成 0 宽', () => {
    const built = view([
      { name: 'a', value: 0 },
      { name: 'b', value: 0 },
    ])

    expect(widths(built)).toEqual(['0%', '0%'])
    expect(lefts(built)).toEqual(['0%', '0%'])
  })

  it('只有一项时它就占满', () => {
    expect(widths(view([{ name: 'a', value: 3 }]))).toEqual(['100%'])
  })

  it('全是同一个值时三条一样长', () => {
    const built = view([
      { name: 'a', value: 5 },
      { name: 'b', value: 5 },
      { name: 'c', value: 5 },
    ])

    expect(widths(built)).toEqual(['100%', '100%', '100%'])
  })
})

describe('负值与零线', () => {
  it('全负时零线贴在右端，条子从零往左长', () => {
    const built = view([
      { name: 'a', value: -2 },
      { name: 'b', value: -1 },
    ])

    expect(built.rules).toEqual([
      { key: 'zero', kind: 'zero', style: { left: '100%' } },
    ])
    expect(lefts(built)).toEqual(['0%', '50%'])
    expect(widths(built)).toEqual(['100%', '50%'])
  })

  it('正负混合时零线落在轴上真正的零处', () => {
    const built = view([
      { name: 'a', value: 3 },
      { name: 'b', value: -1 },
    ])

    expect(built.rules[0]?.style.left).toBe('25%')
    expect(built.rows[0]?.pieces[0]?.style).toEqual({
      left: '25%',
      width: '75%',
    })
    expect(built.rows[1]?.pieces[0]?.style).toEqual({
      left: '0%',
      width: '25%',
    })
  })

  it('没有负值就不画零线——零就是左边缘，再画一条是噪声', () => {
    expect(view([{ name: 'a', value: 2 }]).rules).toEqual([])
  })

  it('有负值时图例里点出零线，颜色之外还有一行字', () => {
    const built = view([{ name: 'a', value: -1 }])

    expect(built.legend.map((one) => one.label)).toContain('零线')
  })
})

describe('算不出来就说算不出来', () => {
  it('值是 null 时读数是「—」而不是 0', () => {
    const built = view([{ name: 'a', value: null }])

    expect(built.rows[0]?.text).toBe('—')
    expect(built.rows[0]?.pieces).toEqual([])
  })

  it('null 不参与定标：另一根仍按自己的量占满', () => {
    const built = view([
      { name: 'a', value: null },
      { name: 'b', value: 4 },
    ])

    expect(widths(built)).toEqual(['100%'])
  })

  it('一个数都算不出来时连单位都不挂', () => {
    const built = view([{ name: 'a', value: null }], { unit: 'kW' })

    expect(built.rows[0]?.text).toBe('—')
  })

  it('算得出来时单位只挂一次', () => {
    const built = view([{ name: 'a', value: 3 }], { unit: 'kW' })

    expect(built.rows[0]?.text).toBe('3 kW')
  })
})

describe('截断', () => {
  const many = Array.from({ length: 70 }, (_, seat) => ({
    name: `c${seat}`,
    value: seat + 1,
  }))

  it('超过上限只画 60 项，剩下多少条明说出来', () => {
    const built = view(many)

    expect(built.rows).toHaveLength(60)
    expect(built.shown).toBe(60)
    expect(built.hidden).toBe(10)
  })

  it('调用方把上限调到 200 也照样夹回 60', () => {
    expect(view(many, { maxItems: 200 }).rows).toHaveLength(60)
  })

  it('上限给 0 时至少画一项，不是画成空图', () => {
    expect(view(many, { maxItems: 0 }).rows).toHaveLength(1)
  })

  it('没超上限时不报截断', () => {
    expect(view([{ name: 'a', value: 1 }]).hidden).toBe(0)
  })
})

describe('空列表与长名字', () => {
  it('一项都没有时行、线、图例全空', () => {
    const built = view([])

    expect(built.rows).toEqual([])
    expect(built.rules).toEqual([])
    expect(built.legend).toEqual([])
  })

  it('名字长也原样带出去，截断是版式的事不是取数的事', () => {
    const long = '1#冷冻水泵出口温度与回水温度的差值折算后的读数'
    expect(view([{ name: long, value: 1 }]).rows[0]?.name).toBe(long)
  })

  it('同名两项不撞 key', () => {
    const built = view([
      { name: '温度', value: 1 },
      { name: '温度', value: 2 },
    ])

    expect(built.rows.map((row) => row.key)).toEqual(['温度', '温度·2'])
  })
})

describe('pairs：前后对比', () => {
  const items: BarListItem[] = [{ name: '空值率', before: 0.5, after: 0.25 }]

  it('之前空心、之后实心，各占一条带', () => {
    const built = view(items, { mode: 'pairs' })

    expect(built.rows[0]?.pieces).toEqual([
      {
        key: '空值率:before',
        tone: 'before',
        band: 'top',
        style: { left: '0%', width: '100%' },
      },
      {
        key: '空值率:after',
        tone: 'primary',
        band: 'bottom',
        style: { left: '0%', width: '50%' },
      },
    ])
  })

  it('读数把前后并排写出来', () => {
    expect(view(items, { mode: 'pairs' }).rows[0]?.text).toBe('0.5 → 0.25')
  })

  it('一侧算不出来时那一条不画，读数写「—」', () => {
    const built = view([{ name: 'x', before: null, after: 0.25 }], {
      mode: 'pairs',
    })

    expect(built.rows[0]?.pieces).toHaveLength(1)
    expect(built.rows[0]?.text).toBe('— → 0.25')
  })

  it('两侧的名字由调用方定，图例里各占一条', () => {
    const built = view(items, {
      mode: 'pairs',
      pairLabels: ['基线', '打乱后'],
    })

    expect(built.legend).toEqual([
      { key: 'before', kind: 'before', label: '基线' },
      { key: 'after', kind: 'primary', label: '打乱后' },
    ])
  })
})

describe('stacked：三分与占比', () => {
  const item: BarListItem = {
    name: '对齐',
    segments: [
      { label: '两边都有', value: 10 },
      { label: '左有右无', value: 5 },
      { label: '右侧没被用上', value: 5 },
    ],
  }

  it('各段首尾相接，按总长定标', () => {
    const built = view([item], { mode: 'stacked' })

    expect(built.rows[0]?.pieces.map((piece) => piece.style)).toEqual([
      { left: '0%', width: '50%' },
      { left: '50%', width: '25%' },
      { left: '75%', width: '25%' },
    ])
  })

  it('没指定语义色时按固定顺序取，丢弃段落在斜纹那一档', () => {
    const built = view([item], { mode: 'stacked' })

    expect(built.rows[0]?.pieces.map((piece) => piece.tone)).toEqual([
      'primary',
      'dropped',
      'neutral',
    ])
  })

  it('读数是总长，图例逐段列出段名', () => {
    const built = view([item], { mode: 'stacked' })

    expect(built.rows[0]?.text).toBe('20')
    expect(built.legend.map((one) => one.label)).toEqual([
      '两边都有',
      '左有右无',
      '右侧没被用上',
    ])
  })

  it('算不出来的那一段跳过，不当 0 长画', () => {
    const built = view(
      [
        {
          name: 'x',
          segments: [
            { label: 'a', value: null },
            { label: 'b', value: 4 },
          ],
        },
      ],
      { mode: 'stacked' },
    )

    expect(built.rows[0]?.pieces).toHaveLength(1)
    expect(built.rows[0]?.text).toBe('4')
  })

  it('调用方指定的语义色压过默认顺序', () => {
    const built = view(
      [
        {
          name: 'x',
          segments: [
            { label: '在界内', value: 8 },
            { label: '越界', value: 2, tone: 'danger' },
          ],
        },
      ],
      { mode: 'stacked' },
    )

    expect(built.rows[0]?.pieces.map((piece) => piece.tone)).toEqual([
      'primary',
      'danger',
    ])
    expect(built.legend.map((one) => one.kind)).toEqual(['primary', 'danger'])
  })

  it('多行共用同一组段名时，图例只列一遍', () => {
    const built = view(
      [
        { name: 'a', segments: [{ label: '留下', value: 3 }] },
        { name: 'b', segments: [{ label: '留下', value: 4 }] },
      ],
      { mode: 'stacked' },
    )

    expect(built.legend).toHaveLength(1)
  })

  it('整个 segments 都没给时算作「—」，不是画一条零长', () => {
    const built = view([{ name: 'x' }], { mode: 'stacked' })

    expect(built.rows[0]?.text).toBe('—')
    expect(built.rows[0]?.pieces).toEqual([])
    expect(built.legend).toEqual([])
  })

  it('一段都算不出来时整行是「—」', () => {
    const built = view([{ name: 'x', segments: [] }], { mode: 'stacked' })

    expect(built.rows[0]?.text).toBe('—')
    expect(built.rows[0]?.pieces).toEqual([])
  })
})

describe('range：区间条', () => {
  const item: BarListItem = { name: '温度', low: 1, mid: 3, high: 5, mark: 4 }

  it('条子从下界画到上界，中位数与均值各自打点', () => {
    const built = view([item], { mode: 'range' })

    expect(built.rows[0]?.pieces[0]?.style).toEqual({
      left: '20%',
      width: '80%',
    })
    expect(built.rows[0]?.tick).toEqual({ left: '60%' })
    expect(built.rows[0]?.dot).toEqual({ left: '80%' })
  })

  it('读数写成上下界，图例点出两种记号', () => {
    const built = view([item], { mode: 'range' })

    expect(built.rows[0]?.text).toBe('1 ~ 5')
    expect(built.legend.map((one) => one.label)).toEqual(['中位数', '均值'])
  })

  it('缺一端就不画条，但另有的记号照画', () => {
    const built = view([{ name: 'x', low: 1, high: null, mid: 2 }], {
      mode: 'range',
    })

    expect(built.rows[0]?.pieces).toEqual([])
    expect(built.rows[0]?.tick).toEqual({ left: '100%' })
    expect(built.rows[0]?.text).toBe('1 ~ —')
  })

  it('没有中位数与均值时图例里不摆这两条', () => {
    const built = view([{ name: 'x', low: 1, high: 2 }], { mode: 'range' })

    expect(built.legend).toEqual([])
  })
})

describe('误差棒与参考线', () => {
  it('重复多次的散布画成误差棒，且把轴撑到它的两端', () => {
    const built = view([{ name: 'a', value: 2, spread: 0.5 }])

    expect(built.rows[0]?.whisker).toEqual({ left: '60%', width: '40%' })
    expect(built.rows[0]?.text).toBe('2 ± 0.5')
  })

  it('散布是 0 时不画误差棒，读数也不带 ±', () => {
    const built = view([{ name: 'a', value: 2, spread: 0 }])

    expect(built.rows[0]?.whisker).toBeNull()
    expect(built.rows[0]?.text).toBe('2')
  })

  it('只有 single 档有误差棒', () => {
    const built = view([{ name: 'a', before: 1, after: 2, spread: 1 }], {
      mode: 'pairs',
    })

    expect(built.rows[0]?.whisker).toBeNull()
  })

  it('阈值线参与定标，落位与标签一起给出来', () => {
    const built = view([{ name: 'a', value: 1 }], {
      threshold: { value: 2, label: '阈值 θ=2' },
    })

    expect(widths(built)).toEqual(['50%'])
    expect(built.rules).toEqual([
      { key: 'threshold', kind: 'threshold', style: { left: '100%' } },
    ])
    expect(built.ruleLabels.map((one) => one.label)).toEqual(['阈值 θ=2'])
  })

  it('参考线与阈值线可以并存，各画各的', () => {
    const built = view([{ name: 'a', value: 4 }], {
      reference: { value: 1, label: '均值' },
      threshold: { value: 2, label: '阈值' },
    })

    expect(built.rules.map((rule) => rule.kind)).toEqual([
      'reference',
      'threshold',
    ])
    expect(built.rules.map((rule) => rule.style.left)).toEqual(['25%', '50%'])
  })
})

// ⚠ 名字搁在左上角图例里的话，读者得横跨大半张图才能把字与线对上，而参考线
// 与阈值线两个色块本来就长得差不多（规格 §7「阈值线 = 虚线 + 文字标签」）
describe('竖线的名字跟着线走', () => {
  it('名字挂在线的正上方，落位与线同一个百分数', () => {
    const built = view([{ name: 'a', value: 4 }], {
      threshold: { value: 1, label: '入选线 1' },
    })

    expect(built.ruleLabels).toEqual([
      {
        key: 'threshold',
        kind: 'threshold',
        label: '入选线 1',
        place: 'mid',
        row: 0,
        style: { left: '25%' },
      },
    ])
    expect(built.rules[0]?.style.left).toBe('25%')
  })

  it('名字不再进图例，图例里也就不剩两个长得差不多的色块', () => {
    const built = view([{ name: 'a', value: 4 }], {
      reference: { value: 1, label: '均值 1' },
      threshold: { value: 2, label: '入选线 2' },
    })

    expect(built.legend).toEqual([])
    expect(built.ruleLabels.map((one) => one.kind)).toEqual([
      'reference',
      'threshold',
    ])
  })

  it('离得远的两条名字摆在同一行', () => {
    const built = view([{ name: 'a', value: 4 }], {
      reference: { value: 1, label: '均值' },
      threshold: { value: 3, label: '阈值' },
    })

    expect(built.ruleLabels.map((one) => one.row)).toEqual([0, 0])
    expect(built.ruleRows).toBe(1)
  })

  it('挨得近的两条上下错开，不叠在一处', () => {
    const built = view([{ name: 'a', value: 0.42 }], {
      reference: { value: 0.12, label: '平均分 0.12' },
      threshold: { value: 0.1, label: '入选线 0.1' },
    })

    expect(built.ruleLabels.map((one) => one.row)).toEqual([1, 0])
    expect(built.ruleRows).toBe(2)
  })

  // ⚠ 贴着两端还居中摆的话，半块字写到轨道外面去
  it('贴着两端的名字改成单边对齐', () => {
    const built = view([{ name: 'a', value: 4 }], {
      reference: { value: 0, label: '零基准' },
      threshold: { value: 4, label: '上界 4' },
    })

    expect(built.ruleLabels.map((one) => one.place)).toEqual(['start', 'end'])
  })

  it('零线不进这一栏——它没有名字，仍旧靠图例那行字', () => {
    const built = view([{ name: 'a', value: -1 }])

    expect(built.ruleLabels).toEqual([])
    expect(built.ruleRows).toBe(1)
    expect(built.legend.map((one) => one.label)).toEqual(['零线'])
  })

  it('一条线都没配时这一栏是空的', () => {
    const built = view([{ name: 'a', value: 1 }])

    expect(built.ruleLabels).toEqual([])
    expect(built.ruleRows).toBe(1)
  })
})
