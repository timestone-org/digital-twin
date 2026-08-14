/**
 * @fileoverview 契约：卡片外观键清单是一份闭合词汇表——键不重复、枚举都带合法值表、
 * 判定函数只认表内的键。⚠ 键名写错不报错也不渲染，三个消费方各写一份就必然漂。
 */
import { describe, expect, it } from 'vitest'

import { CHROME_KEYS, isChromeKey } from '../src/index'
import type {
  CardChrome,
  ChromeKey,
  ChromeKeySpec,
  ChromeKeyType,
} from '../src/index'

// 断言按接口读而不是按字面量类型读：字面量下「非枚举键没有 values」是编译期已知的，
// 那样断言就恒真，锁不住运行时真多出来一个 values 的情形
const SPECS: readonly ChromeKeySpec[] = CHROME_KEYS

// 类型层把取值类型枚举一遍：多一个或少一个都过不了 typecheck
const CHROME_KEY_TYPE_MEMBERS: Record<ChromeKeyType, true> = {
  color: true,
  number: true,
  boolean: true,
  enum: true,
  number3: true,
}

describe('外观键清单', () => {
  it('键名唯一', () => {
    const keys = SPECS.map((spec) => spec.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('取值类型只有这五档，且都被用上', () => {
    const used = new Set(SPECS.map((spec) => spec.type))
    expect([...used].sort()).toEqual(
      Object.keys(CHROME_KEY_TYPE_MEMBERS).sort(),
    )
  })

  it('枚举键都带非空的合法值表，非枚举键都不带', () => {
    for (const spec of SPECS) {
      expect(Array.isArray(spec.values), spec.key).toBe(spec.type === 'enum')
    }
    for (const spec of SPECS) {
      if (spec.type === 'enum') {
        expect(spec.values?.length, spec.key).toBeGreaterThan(0)
      }
    }
  })

  it('合法值表里不含空串，未设置是删键而不是一个值', () => {
    for (const spec of SPECS) {
      expect(spec.values ?? [], spec.key).not.toContain('')
    }
  })

  it('缺省档的枚举值不进表，进了就等于把平台默认固化成显式值', () => {
    const valuesOf = (key: string) =>
      SPECS.find((spec) => spec.key === key)?.values ?? []
    expect(valuesOf('borderSide')).not.toContain('all')
    expect(valuesOf('cornerStyle')).not.toContain('bracket')
    expect(valuesOf('titleAlign')).not.toContain('center')
  })
})

describe('键名判定', () => {
  it('认清单里的每个键', () => {
    for (const spec of SPECS) expect(isChromeKey(spec.key)).toBe(true)
  })

  it('不认清单外的键，拼错一个字母就当场判假', () => {
    expect(isChromeKey('borderPulze')).toBe(false)
    expect(isChromeKey('__cardStyle')).toBe(false)
    expect(isChromeKey('')).toBe(false)
  })

  it('判定为真之后可以直接当键用', () => {
    const bag: CardChrome = {}
    const raw = 'radius'
    if (isChromeKey(raw)) {
      const key: ChromeKey = raw
      bag[key] = 4
    }
    expect(bag).toEqual({ radius: 4 })
  })
})
