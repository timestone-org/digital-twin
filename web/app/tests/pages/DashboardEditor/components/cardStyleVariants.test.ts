/**
 * @fileoverview 契约：外观风格只碰登记过的外观键，且「平台默认」= 把这批键全部删掉。
 * ⚠ 风格里写一个清单外的键，面板照样存得进去，但渲染侧永远不读——全程无报错。
 */
import { isChromeKey } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  CARD_STYLE_KEYS,
  CARD_STYLE_VARIANTS,
  CUSTOM_STYLE_ID,
  MINIMAL_OUTLINE_STYLE,
  matchCardStyle,
  resetStylePatch,
} from '@/pages/DashboardEditor/components/cardStyleVariants'

describe('风格取值', () => {
  it('涉及的键全部登记在外观键清单里', () => {
    const stray = CARD_STYLE_KEYS.filter((key) => !isChromeKey(key))

    expect(stray, `风格写了清单外的键：${stray.join(', ')}`).toEqual([])
  })

  it('每个风格都有 id、文案与一份取值', () => {
    for (const variant of CARD_STYLE_VARIANTS) {
      expect(variant.id, variant.label).not.toBe('')
      expect(variant.hint.length, variant.label).toBeGreaterThan(0)
      expect(typeof variant.patch(), variant.label).toBe('object')
    }
  })

  it('id 不重复，且不占用「自定义」这个回填专用值', () => {
    const ids = CARD_STYLE_VARIANTS.map((variant) => variant.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(CUSTOM_STYLE_ID)
  })

  it('取值表冻结，改一处不会污染下一次写入', () => {
    expect(Object.isFrozen(MINIMAL_OUTLINE_STYLE)).toBe(true)
  })
})

describe('平台默认 = 删键', () => {
  it('把风格写过的键逐个置空，交给字段组删键', () => {
    const patch = resetStylePatch()

    expect(Object.keys(patch).sort()).toEqual([...CARD_STYLE_KEYS].sort())
    expect(Object.values(patch).every((value) => value === undefined)).toBe(
      true,
    )
  })
})

describe('回填判定', () => {
  it('这批键一个都没设就是平台默认', () => {
    expect(matchCardStyle({})).toBe('default')
    expect(matchCardStyle({ radius: undefined, bg: '' })).toBe('default')
  })

  it('逐键等值才认这个风格，数组按元素比', () => {
    expect(matchCardStyle({ ...MINIMAL_OUTLINE_STYLE })).toBe('minimal')
    expect(
      matchCardStyle({ ...MINIMAL_OUTLINE_STYLE, titlePadding: [10, 12, 8] }),
    ).toBe('minimal')
  })

  it('动过一项就是自定义，不谎报成某个风格', () => {
    expect(matchCardStyle({ ...MINIMAL_OUTLINE_STYLE, radius: 12 })).toBe(
      CUSTOM_STYLE_ID,
    )
    expect(
      matchCardStyle({ ...MINIMAL_OUTLINE_STYLE, titlePadding: [10, 12] }),
    ).toBe(CUSTOM_STYLE_ID)
    expect(matchCardStyle({ radius: 4 })).toBe(CUSTOM_STYLE_ID)
  })

  it('风格外的键不参与判定', () => {
    expect(matchCardStyle({ hoverLift: 6 })).toBe('default')
  })
})
