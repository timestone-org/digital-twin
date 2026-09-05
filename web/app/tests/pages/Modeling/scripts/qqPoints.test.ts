/**
 * @fileoverview 正态 QQ 那一档折成散点的算料：认不认得出、两根轴哪个数画在哪、
 * 以及图下那句结论会不会把「尾巴厚」说成「尾巴薄」。
 *
 * ⚠ 夹具照抄后端实测（`residual_analysis` 在五种残差分布上的「正态 QQ」块），
 * 只留首、四分位、中位、四分位、末这五个分位点——判据只看这几处，别的点删掉
 * 不改结论，而编一份形状出来的夹具与真实块漂了之后这里全绿而界面全错。
 */
import { describe, expect, it } from 'vitest'

import { buildQq, isQq } from '@/pages/Modeling/Canvas/scripts/qqPoints'

type Item = Record<string, unknown>

/** 一份 QQ 块的 payload。Args: items。 */
function payloadOf(items: readonly Item[]): Record<string, unknown> {
  return {
    label: '实测分位对同均值同方差的正态分位',
    unit: '',
    score_kind: '',
    baseline: null,
    items,
    is_primary: false,
  }
}

/** 后端实测：四百行干净正态残差，点落在对角线上。 */
const NORMAL: Item[] = [
  { name: '0.010', value: -2.567171, expected: -2.37618, ratio: 0.009804 },
  { name: '0.245', value: -0.662531, expected: -0.689902, ratio: 0.245098 },
  { name: '0.500', value: 0.128278, expected: 0.017938, ratio: 0.5 },
  { name: '0.755', value: 0.750939, expected: 0.725778, ratio: 0.754902 },
  { name: '0.990', value: 2.147225, expected: 2.412056, ratio: 0.990196 },
]

/** 后端实测：少数几行错得特别离谱，中段反而比正态挤。 */
const HEAVY: Item[] = [
  { name: '0.010', value: -7.487423, expected: -5.246815, ratio: 0.009804 },
  { name: '0.245', value: -0.834923, expected: -1.470578, ratio: 0.245098 },
  { name: '0.500', value: 0.043611, expected: 0.114552, ratio: 0.5 },
  { name: '0.755', value: 1.12572, expected: 1.699682, ratio: 0.754902 },
  { name: '0.990', value: 6.671171, expected: 5.475919, ratio: 0.990196 },
]

/** 后端实测：误差被卡在一个固定幅度里（均匀分布的残差）。 */
const LIGHT: Item[] = [
  { name: '0.010', value: -0.986856, expected: -1.287743, ratio: 0.009804 },
  { name: '0.245', value: -0.474688, expected: -0.375307, ratio: 0.245098 },
  { name: '0.500', value: 0.001677, expected: 0.007701, ratio: 0.5 },
  { name: '0.755', value: 0.510141, expected: 0.390709, ratio: 0.754902 },
  { name: '0.990', value: 0.956246, expected: 1.303145, ratio: 0.990196 },
]

/** 后端实测：残差右偏，上半段拖得比下半段长。 */
const SKEW_HIGH: Item[] = [
  { name: '0.010', value: 0.010878, expected: -1.364867, ratio: 0.009804 },
  { name: '0.245', value: 0.225839, expected: 0.318788, ratio: 0.245098 },
  { name: '0.500', value: 0.698701, expected: 1.025526, ratio: 0.5 },
  { name: '0.755', value: 1.574315, expected: 1.732265, ratio: 0.754902 },
  { name: '0.990', value: 4.652333, expected: 3.415919, ratio: 0.990196 },
]

/** 后端实测：残差左偏，下半段拖得比上半段长。 */
const SKEW_LOW: Item[] = [
  { name: '0.010', value: -4.669572, expected: -3.157863, ratio: 0.009804 },
  { name: '0.245', value: -1.270448, expected: -1.597557, ratio: 0.245098 },
  { name: '0.500', value: -0.664662, expected: -0.942596, ratio: 0.5 },
  { name: '0.755', value: -0.300454, expected: -0.287634, ratio: 0.754902 },
  { name: '0.990', value: -0.011843, expected: 1.272672, ratio: 0.990196 },
]

/** 后端实测：前半段恒 +2、后半段恒 −2 的那份残差，两个取值撑起整条分布。 */
const TWO_LEVELS: Item[] = [
  { name: '0.010', value: -2, expected: -4.667537, ratio: 0.009804 },
  { name: '0.245', value: -2, expected: -1.379994, ratio: 0.245098 },
  { name: '0.500', value: 0, expected: 0, ratio: 0.5 },
  { name: '0.755', value: 2, expected: 1.379994, ratio: 0.754902 },
  { name: '0.990', value: 2, expected: 4.667537, ratio: 0.990196 },
]

/** 图下那句结论。Args: items。 */
function noteOf(items: readonly Item[]): string {
  return buildQq(payloadOf(items))?.note ?? ''
}

describe('认不认得出', () => {
  it('逐项带得出正态分位与实测分位就是这一档', () => {
    expect(isQq(payloadOf(NORMAL))).toBe(true)
  })

  it('一项都没有的块不是这一档', () => {
    expect(isQq({ items: [] })).toBe(false)
    expect(isQq({})).toBe(false)
  })

  it('逐折分数那种只有名字与值的块不是这一档', () => {
    const folds = { items: [{ name: '第 1 折', value: 0.9 }] }

    expect(isQq(folds)).toBe(false)
    expect(buildQq(folds)).toBeNull()
  })
})

describe('两根轴各画哪个数', () => {
  it('横轴是正态分位、纵轴是实测分位，不是反过来', () => {
    const view = buildQq(payloadOf(NORMAL))

    expect(view?.series[0]?.points[0]).toEqual([-2.37618, -2.567171])
    expect(view?.xLabel).toContain('正态分位')
    expect(view?.yLabel).toContain('实测')
  })

  it('画的是点不是折线：分位点之间没有可连的次序含义', () => {
    expect(buildQq(payloadOf(NORMAL))?.series[0]?.draw).toBe('dots')
  })

  it('点按分位从小到大排，块里的次序乱了也照排', () => {
    const shuffled = [NORMAL[3], NORMAL[0], NORMAL[4]].map((one) => one ?? {})
    const view = buildQq(payloadOf(shuffled))

    expect(view?.series[0]?.points.map(([x]) => x)).toEqual([
      -2.37618, 0.725778, 2.412056,
    ])
  })

  it('一共几个分位点写在图下那句的开头', () => {
    expect(noteOf(NORMAL)).toMatch(/^5 个分位点；/)
  })
})

describe('图下那句说的是点偏离对角线偏成了什么样', () => {
  it('点贴着对角线时说接近正态，不说任何一头有大错', () => {
    expect(noteOf(NORMAL)).toContain('点基本贴着对角线')
    expect(noteOf(NORMAL)).toContain('接近正态')
  })

  it('两端翘起时点名尾巴厚，并说清那意味着少数几行错得离谱', () => {
    const note = noteOf(HEAVY)

    expect(note).toContain('尾巴比正态厚')
    expect(note).toContain('少数几行错得特别离谱')
  })

  it('两端收进来时点名尾巴薄，不许跟厚尾说同一句话', () => {
    const note = noteOf(LIGHT)

    expect(note).toContain('尾巴比正态薄')
    expect(note).not.toContain('尾巴比正态厚')
  })

  it('右偏时说预测偏小的那几行错得更狠', () => {
    const note = noteOf(SKEW_HIGH)

    expect(note).toContain('残差右偏')
    expect(note).toContain('预测偏小的那几行')
  })

  it('左偏时说预测偏大的那几行错得更狠', () => {
    const note = noteOf(SKEW_LOW)

    expect(note).toContain('残差左偏')
    expect(note).toContain('预测偏大的那几行')
  })

  it('只有两个取值的残差算薄尾：它压根没有尾巴可比', () => {
    expect(noteOf(TWO_LEVELS)).toContain('尾巴比正态薄')
  })

  it('结论不是复述图名：一个「正态 QQ」的字样都不许出现', () => {
    for (const items of [NORMAL, HEAVY, LIGHT, SKEW_HIGH, SKEW_LOW]) {
      expect(noteOf(items)).not.toContain('正态 QQ')
    }
  })
})

describe('退化输入', () => {
  it('三个数缺一个的那一项不画，也不折成 0', () => {
    const view = buildQq(
      payloadOf([
        { name: 'a', value: 1, expected: 1, ratio: 0.1 },
        { name: 'b', value: null, expected: 2, ratio: 0.5 },
        { name: 'c', value: 3, expected: null, ratio: 0.9 },
        { name: 'd', value: 4, expected: 4, ratio: 0.95 },
      ]),
    )

    expect(view?.series[0]?.points).toEqual([
      [1, 1],
      [4, 4],
    ])
  })

  it('点不够两个时给 null：那时该退回原来的横条画法', () => {
    expect(buildQq(payloadOf([NORMAL[0] ?? {}]))).toBeNull()
    expect(buildQq({ items: [{ value: 'x', expected: 1, ratio: 0.5 }] })).toBe(
      null,
    )
  })

  it('实测分位全都一样时说量不出形状，不许退成「接近正态」', () => {
    const note = noteOf([
      { name: 'a', value: 3, expected: -1, ratio: 0.1 },
      { name: 'b', value: 3, expected: 0, ratio: 0.5 },
      { name: 'c', value: 3, expected: 1, ratio: 0.9 },
    ])

    expect(note).toContain('3 个分位点')
    expect(note).toContain('量不出形状')
    expect(note).not.toContain('接近正态')
  })
})
