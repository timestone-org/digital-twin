/**
 * @fileoverview 契约：属性面板的分段与条件显示全由 `configSchema` 声明驱动，
 * `when` 判定读的是**铺过缺省之后**的配置。
 */
import { describe, expect, it } from 'vitest'
import type { ConfigField, ConfigPreset } from '@dt/contracts'

import {
  activePresetIds,
  formGroups,
  isFieldVisible,
} from '@/features/dashboard/configForm'

const SHOW: ConfigField = {
  key: 'showTitle',
  label: '显示标题条',
  type: 'boolean',
  group: '标题',
}

const TITLE: ConfigField = {
  key: 'title',
  label: '标题',
  type: 'string',
  group: '标题',
  when: { key: 'showTitle', in: [true] },
}

const ACCENT: ConfigField = {
  key: 'accent',
  label: '强调色',
  type: 'color',
  group: '外观',
}

const LOOSE: ConfigField = { key: 'note', label: '备注', type: 'string' }

describe('条件显示', () => {
  it('没有 when 的字段永远显示', () => {
    expect(isFieldVisible(ACCENT, {})).toBe(true)
  })

  it('依赖键落在 in 里才显示', () => {
    expect(isFieldVisible(TITLE, { showTitle: true })).toBe(true)
    expect(isFieldVisible(TITLE, { showTitle: false })).toBe(false)
  })

  it('依赖键没配过时按缺席算，不显示', () => {
    expect(isFieldVisible(TITLE, {})).toBe(false)
  })
})

describe('分段', () => {
  it('按 group 分段，段序即字段首次出现的顺序', () => {
    const groups = formGroups([ACCENT, SHOW, TITLE], { showTitle: true })

    expect(groups.map((group) => group.title)).toEqual(['外观', '标题'])
    expect(groups[1]?.fields.map((field) => field.key)).toEqual([
      'showTitle',
      'title',
    ])
  })

  it('没声明 group 的字段落在「基础」段', () => {
    expect(formGroups([LOOSE], {}).map((group) => group.title)).toEqual([
      '基础',
    ])
  })

  it('条件不满足的字段不进任何段，整段空了就不出现', () => {
    const groups = formGroups([TITLE], { showTitle: false })

    expect(groups).toEqual([])
  })
})

describe('预设命中', () => {
  function preset(id: string, config: Record<string, unknown>): ConfigPreset {
    return { id, label: id, config }
  }

  it('预设写过的键全部与当前值相等才命中', () => {
    const presets = [preset('a', { size: 12, color: 'red' })]

    expect(activePresetIds(presets, { size: 12, color: 'red' })).toEqual(
      new Set(['a']),
    )
    expect(activePresetIds(presets, { size: 12, color: 'blue' })).toEqual(
      new Set(),
    )
  })

  it('子集语义：预设之外的键不参与判定', () => {
    const presets = [preset('a', { size: 12 })]

    expect(activePresetIds(presets, { size: 12, other: '随便什么' })).toEqual(
      new Set(['a']),
    )
  })

  it('多个预设可以同时命中', () => {
    const presets = [preset('a', { size: 12 }), preset('b', { color: 'red' })]

    expect(activePresetIds(presets, { size: 12, color: 'red' })).toEqual(
      new Set(['a', 'b']),
    )
  })

  // 预设值恰好等于清单缺省时也要亮：resolved 是铺过缺省的，比较对它一视同仁
  it('预设值与铺过缺省的取值相等即命中，不区分「配的」还是「缺省的」', () => {
    const presets = [preset('a', { showBar: true })]

    expect(activePresetIds(presets, { showBar: true })).toEqual(new Set(['a']))
  })

  it('对象与数组按深比较，不按引用', () => {
    const presets = [preset('a', { pad: [8, 12, 6], font: { size: 14 } })]

    expect(
      activePresetIds(presets, { pad: [8, 12, 6], font: { size: 14 } }),
    ).toEqual(new Set(['a']))
    expect(
      activePresetIds(presets, { pad: [8, 12, 7], font: { size: 14 } }),
    ).toEqual(new Set())
  })

  it('预设键在 resolved 里缺席时不命中——undefined 不等于任何写过的值', () => {
    const presets = [preset('a', { size: 12 })]

    expect(activePresetIds(presets, {})).toEqual(new Set())
  })

  it('没有预设就给空集', () => {
    expect(activePresetIds([], { size: 12 })).toEqual(new Set())
  })
})
