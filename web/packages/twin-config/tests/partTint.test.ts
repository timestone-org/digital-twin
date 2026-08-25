/**
 * @fileoverview 部件外观与状态染色的派生：归一化、取色、缝合读值。
 *
 * ⚠ 这一层守的是「配了染色但颜色一动不动」那一类：档位顺序、区间的含与不含、
 * 取不到数时的回落，任何一条错了都表现为一个不会报错的错颜色。
 * ⚠ 渐变故意不在这里算出颜色：两端可以是 `--token`，而 token 的取值只有在有
 * CSS 级联的宿主里才解析得出来（本包无 DOM）。
 */
import { describe, expect, it } from 'vitest'

import { normalizeTwinConfig } from '../src/normalize'
import {
  DEFAULT_PART_LOOK,
  DEFAULT_TINT_GRADIENT,
  normalizePartLook,
  normalizePartTint,
} from '../src/normalizeParts'
import {
  partAppearance,
  partTintColor,
  tintStopText,
  tintedParts,
} from '../src/partTint'
import { stitchPartValues } from '../src/twinMath'
import type { TwinPart, TwinPartTint } from '../src/types'

/** 造一个部件；`over` 直接盖在落库形状上，走一遍归一化。 */
function part(over: Record<string, unknown> = {}): TwinPart {
  const built = normalizeTwinConfig({ parts: [{ id: 'p1', ...over }] }).parts[0]
  if (built === undefined) throw new Error('造不出部件')
  return built
}

function tint(over: Record<string, unknown> = {}): TwinPartTint {
  const built = normalizePartTint(over)
  if (built === null) throw new Error('造不出染色规则')
  return built
}

const RUN_STOP = {
  id: 's1',
  match: 'equals',
  equals: '1',
  color: '#00ff00',
  label: '运行',
}
const STOP_STOP = { id: 's0', match: 'equals', equals: '0', color: '#ff0000' }

describe('常态外观的归一化', () => {
  it('没配过时完全按模型自带的材质走', () => {
    expect(normalizePartLook(undefined)).toEqual(DEFAULT_PART_LOOK)
  })

  it('不透明度、浓度与自发光各自夹进区间', () => {
    expect(normalizePartLook({ opacity: 5, blend: -1, glow: 99 })).toEqual({
      opacity: 1,
      color: '',
      blend: 0,
      glow: 3,
    })
  })

  // ⚠ 解析不出来时不回落成某个默认色：回落会让「token 名写错了」看起来像「配对了」
  it('颜色只认 hex 与 token，其余一律当没配', () => {
    expect(normalizePartLook({ color: 'var(--State-Danger)' }).color).toBe(
      '--state-danger',
    )
    expect(normalizePartLook({ color: '#ABC' }).color).toBe('#aabbcc')
    expect(normalizePartLook({ color: 'red' }).color).toBe('')
  })
})

describe('染色规则的归一化', () => {
  // 「没配染色」与「配了一条空规则」不是一回事：前者不占绑定行
  it('不是对象即这个部件不取数', () => {
    expect(normalizePartTint(undefined)).toBeNull()
    expect(normalizePartTint('stops')).toBeNull()
    expect(normalizePartTint({})).not.toBeNull()
  })

  it('取色方式与命中方式认不出来时各回落到缺省', () => {
    const rule = tint({ mode: 'rainbow', stops: [{ id: 's1', match: '???' }] })

    expect(rule.mode).toBe('stops')
    expect(rule.stops[0]?.match).toBe('range')
  })

  it('渐变缺了哪一项就补哪一项，非法色也退回缺省色', () => {
    expect(tint({ gradient: { min: 20, to: 'nope' } }).gradient).toEqual({
      min: 20,
      max: DEFAULT_TINT_GRADIENT.max,
      from: DEFAULT_TINT_GRADIENT.from,
      to: DEFAULT_TINT_GRADIENT.to,
    })
  })

  // 颜色空着的档位是「命中就保持原色」，删掉它会让后面的档位被放进来
  it('颜色空着的档位照样保留', () => {
    expect(tint({ stops: [{ id: 's1', match: 'range' }] }).stops).toHaveLength(
      1,
    )
  })

  it('非对象的档位条目丢掉，档位顺序原样不重排', () => {
    const rule = tint({ stops: [null, RUN_STOP, STOP_STOP] })

    expect(rule.stops.map((stop) => stop.id)).toEqual(['s1', 's0'])
  })

  it('归一化跑两遍与跑一遍结果相同', () => {
    const once = normalizeTwinConfig({
      parts: [
        { id: 'p1', look: { opacity: 0.4 }, tint: { stops: [RUN_STOP] } },
      ],
    })

    expect(normalizeTwinConfig(once)).toEqual(once)
  })
})

describe('按档取色', () => {
  const RULE = tint({ stops: [STOP_STOP, RUN_STOP], fallback: '#0000ff' })

  it('自上而下取第一个命中的档', () => {
    expect(partTintColor(RULE, 1)).toEqual({ kind: 'solid', spec: '#00ff00' })
    expect(partTintColor(RULE, 0)).toEqual({ kind: 'solid', spec: '#ff0000' })
  })

  // ⚠ 点位下发的 1 与档位里填的 "1" 不按数比就永远对不上，而两者看起来一模一样
  it('两边都能当数时按数比，比不了数时不分大小写按字符串比', () => {
    expect(partTintColor(RULE, '1')).toEqual({ kind: 'solid', spec: '#00ff00' })
    expect(
      partTintColor(tint({ stops: [{ ...RUN_STOP, equals: 'RUN' }] }), 'run'),
    ).toEqual({ kind: 'solid', spec: '#00ff00' })
  })

  it('一档都没命中时走回落色', () => {
    expect(partTintColor(RULE, 7)).toEqual({ kind: 'solid', spec: '#0000ff' })
  })

  // ⚠ 留在上一次命中的颜色上，点位掉线后画面看不出那个色已经是陈旧的
  it('取不到数时也走回落色，不是保持上一次的颜色', () => {
    expect(partTintColor(RULE, undefined)).toEqual({
      kind: 'solid',
      spec: '#0000ff',
    })
    expect(partTintColor(RULE, null)).toEqual({
      kind: 'solid',
      spec: '#0000ff',
    })
    expect(partTintColor(RULE, Number.NaN)).toEqual({
      kind: 'solid',
      spec: '#0000ff',
    })
  })

  it('回落色空着时退回不染色', () => {
    expect(partTintColor(tint({ stops: [] }), 1)).toEqual({ kind: 'none' })
  })

  it('命中一档颜色空着的，也是不染色——但不再往下比', () => {
    const rule = tint({
      stops: [{ id: 'quiet', match: 'equals', equals: '1' }, RUN_STOP],
      fallback: '#0000ff',
    })

    expect(partTintColor(rule, 1)).toEqual({ kind: 'none' })
  })
})

describe('区间档', () => {
  const RULE = tint({
    stops: [
      { id: 'lo', match: 'range', to: 60, color: '#00ff00' },
      { id: 'mid', match: 'range', from: 60, to: 80, color: '#ffff00' },
      { id: 'hi', match: 'range', from: 80, color: '#ff0000' },
    ],
  })

  // ⚠ 上界不含：两档都含 80 的话，边界值归谁取决于顺序，而那是用户看不见的
  it('下界含、上界不含', () => {
    expect(partTintColor(RULE, 59.9)).toEqual({
      kind: 'solid',
      spec: '#00ff00',
    })
    expect(partTintColor(RULE, 60)).toEqual({ kind: 'solid', spec: '#ffff00' })
    expect(partTintColor(RULE, 80)).toEqual({ kind: 'solid', spec: '#ff0000' })
  })

  it('两端都空即任意数值都命中', () => {
    const any = tint({
      stops: [{ id: 'any', match: 'range', color: '#111111' }],
    })

    expect(partTintColor(any, -999)).toEqual({ kind: 'solid', spec: '#111111' })
  })

  it('值不是数时区间档一律不命中', () => {
    expect(partTintColor(RULE, '停机')).toEqual({ kind: 'none' })
  })
})

describe('区间渐变', () => {
  const RULE = tint({
    mode: 'gradient',
    gradient: { min: 0, max: 100, from: '#000000', to: '#ffffff' },
  })

  // 两端原样给出去：token 的取值要到有 CSS 级联的宿主里才解析得出来
  it('给的是两端加插值位置，不是算好的颜色', () => {
    expect(partTintColor(RULE, 25)).toEqual({
      kind: 'mix',
      from: '#000000',
      to: '#ffffff',
      t: 0.25,
    })
  })

  it('超出区间时夹到最近的一端', () => {
    expect(partTintColor(RULE, -50)).toMatchObject({ t: 0 })
    expect(partTintColor(RULE, 500)).toMatchObject({ t: 1 })
  })

  // ⚠ 不做除零：上下端相等时 (v-min)/(max-min) 是 NaN，插出来的颜色整片作废
  it('上下端相等时恒取下端', () => {
    const flat = tint({ mode: 'gradient', gradient: { min: 5, max: 5 } })

    expect(partTintColor(flat, 5)).toMatchObject({ t: 0 })
  })

  it('值不是数时走回落色', () => {
    const withFallback = tint({ mode: 'gradient', fallback: '#0000ff' })

    expect(partTintColor(withFallback, '坏了')).toEqual({
      kind: 'solid',
      spec: '#0000ff',
    })
  })
})

describe('一个部件这一刻的完整外观', () => {
  it('没配染色时用常态色，浓度与自发光照配置走', () => {
    const built = part({ look: { color: '#123456', blend: 0.5, glow: 2 } })

    expect(partAppearance(built, 1)).toEqual({
      opacity: 1,
      color: { kind: 'solid', spec: '#123456' },
      blend: 0.5,
      glow: 2,
    })
  })

  it('状态染色命中时盖过常态色', () => {
    const built = part({
      look: { color: '#123456' },
      tint: { stops: [RUN_STOP] },
    })

    expect(partAppearance(built, 1).color).toEqual({
      kind: 'solid',
      spec: '#00ff00',
    })
  })

  // 「平时原色、异常才变色」的配法：常态留空，只配染色
  it('染色没命中且回落色空着时，退回常态色', () => {
    const built = part({
      look: { color: '#123456' },
      tint: { stops: [RUN_STOP] },
    })

    expect(partAppearance(built, 0).color).toEqual({
      kind: 'solid',
      spec: '#123456',
    })
  })

  it('常态色也空着就是完全不染色', () => {
    expect(partAppearance(part(), 1).color).toEqual({ kind: 'none' })
  })
})

describe('部件读数的缝合', () => {
  const MIXED = normalizeTwinConfig({
    parts: [
      { id: 'plain' },
      { id: 'tinted', tint: { stops: [RUN_STOP] } },
      { id: 'other', tint: { stops: [] } },
    ],
  })

  it('只有配了染色的部件占行', () => {
    expect(tintedParts(MIXED.parts).map((item) => item.id)).toEqual([
      'tinted',
      'other',
    ])
  })

  it('按过滤后的序号对齐，没配染色的部件一行都不占', () => {
    expect(stitchPartValues(MIXED.parts, [{ value: 7 }, { value: 8 }])).toEqual(
      {
        tinted: { value: 7 },
        other: { value: 8 },
      },
    )
  })

  it('一行都没喂时给同一个空表引用，不是一堆 undefined 条目', () => {
    expect(stitchPartValues(MIXED.parts, undefined)).toEqual({})
    expect(stitchPartValues(undefined, [{ value: 1 }])).toEqual({})
  })

  it('喂多出来的行不会凭空造出部件', () => {
    expect(
      Object.keys(
        stitchPartValues(MIXED.parts, [
          { value: 1 },
          { value: 2 },
          { value: 3 },
        ]),
      ),
    ).toEqual(['tinted', 'other'])
  })
})

describe('档位在图例上的文字', () => {
  it('配了说明就用说明', () => {
    const [only] = tint({ stops: [RUN_STOP] }).stops
    if (only === undefined) throw new Error('造不出档位')

    expect(tintStopText(only)).toBe('运行')
  })

  it('没配说明时按条件拼一句，口径与命中判定一致', () => {
    const rule = tint({
      stops: [
        { id: 'a', match: 'equals', equals: '3' },
        { id: 'b', match: 'range' },
        { id: 'c', match: 'range', from: 80 },
        { id: 'd', match: 'range', to: 60 },
        { id: 'e', match: 'range', from: 60, to: 80 },
      ],
    })

    expect(rule.stops.map(tintStopText)).toEqual([
      '= 3',
      '任意数值',
      '≥ 80',
      '< 60',
      '60 ~ 80',
    ])
  })
})
