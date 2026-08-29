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

/**
 * 三级链：风格 → 横向扫光 → 扫光宽度，页头就是这个形状。
 * ⚠ `when` 只说得出一个键，所以链上的每一环只声明自己那一环。
 */
const VARIANT: ConfigField = {
  key: 'variant',
  label: '风格',
  type: 'enum',
  group: '外观',
}

const SCAN: ConfigField = {
  key: 'scan',
  label: '横向扫光',
  type: 'boolean',
  group: '动效',
  when: { key: 'variant', in: ['tech'] },
}

const SCAN_WIDTH: ConfigField = {
  key: 'scanWidth',
  label: '扫光宽度',
  type: 'number',
  group: '动效',
  when: { key: 'scan', in: [true] },
}

const CHAIN: readonly ConfigField[] = [VARIANT, SCAN, SCAN_WIDTH]

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

/**
 * ⚠ 这一组守的是「配了没反应」那一类：把风格切回素净之后，扫光那几项本身的
 * `when` 仍然满足（开关还留着 true），只判自己那一环的话它们会继续摆在面板上，
 * 而模块根本不画扫光——调了没有任何变化，且两侧都不报错。
 */
describe('条件沿 when 链传递', () => {
  it('链上每一环都满足时显示', () => {
    const config = { variant: 'tech', scan: true }

    expect(isFieldVisible(SCAN_WIDTH, config, CHAIN)).toBe(true)
  })

  it('上游那一环不满足时，下游也不显示', () => {
    const config = { variant: 'plain', scan: true }

    expect(isFieldVisible(SCAN_WIDTH, config, CHAIN)).toBe(false)
  })

  it('formGroups 里也不会漏出下游字段', () => {
    const groups = formGroups(CHAIN, { variant: 'plain', scan: true })
    const keys = groups.flatMap((group) => group.fields.map((one) => one.key))

    expect(keys).toEqual(['variant'])
  })

  // 清单是人写的，`a → b → a` 写得出来；不防的话属性面板整个卡死，
  // 而红的是浏览器不是测试
  it('声明成环时不死循环', () => {
    const left: ConfigField = {
      key: 'a',
      label: 'A',
      type: 'boolean',
      when: { key: 'b', in: [true] },
    }
    const right: ConfigField = {
      key: 'b',
      label: 'B',
      type: 'boolean',
      when: { key: 'a', in: [true] },
    }

    expect(isFieldVisible(left, { a: true, b: true }, [left, right])).toBe(true)
    expect(isFieldVisible(left, { a: true, b: false }, [left, right])).toBe(
      false,
    )
  })

  // 不给同级清单时退回只判自己那一环，旧调用点不受影响
  it('不给同级清单时只判自己那一环', () => {
    expect(isFieldVisible(SCAN_WIDTH, { variant: 'plain', scan: true })).toBe(
      true,
    )
  })
})
