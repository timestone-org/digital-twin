/** @fileoverview 部件状态效果保存独立规则，关闭后保留配置。 */
import { describe, expect, it } from 'vitest'

import { normalizeTwinConfig } from '../src/normalize'
import {
  DEFAULT_PART_EFFECT,
  effectParts,
  normalizePartEffect,
  partEffectActive,
  partEffectIntensity,
} from '../src/partEffect'

describe('部件状态效果配置', () => {
  it('旧部件缺省没有效果，不凭空激活', () => {
    expect(
      normalizeTwinConfig({ parts: [{ id: 'old' }] }).parts[0]?.effect,
    ).toBeNull()
  })

  it('保存点位触发效果并保留既有外观与染色', () => {
    const part = normalizeTwinConfig({
      parts: [
        {
          id: 'pump',
          look: { opacity: 0.6, color: '--accent-primary' },
          tint: {
            mode: 'stops',
            stops: [{ match: 'equals', equals: '80', color: '--state-danger' }],
          },
          effect: {
            enabled: true,
            pattern: 'blink',
            threshold: 1,
            color: '--state-warning',
          },
        },
      ],
    }).parts[0]
    expect(part?.effect).toMatchObject({
      enabled: true,
      mode: 'point',
      operator: 'eq',
      threshold: 1,
      pattern: 'blink',
      color: '--state-warning',
      periodMs: 1600,
    })
    expect(part?.look.opacity).toBe(0.6)
    expect(part?.tint?.stops[0]?.equals).toBe('80')
  })

  it('关闭效果仅改变enabled，颜色和触发值可JSON往返', () => {
    const config = normalizeTwinConfig({
      parts: [
        {
          id: 'pump',
          effect: {
            enabled: false,
            threshold: 0,
            color: '--state-danger',
            pattern: 'pulse',
            periodMs: 2000,
          },
        },
      ],
    })
    expect(config.parts[0]?.effect).toMatchObject({
      enabled: false,
      threshold: 0,
      color: '--state-danger',
    })
    expect(normalizeTwinConfig(JSON.parse(JSON.stringify(config)))).toEqual(
      config,
    )
  })
})

describe('效果触发与恢复', () => {
  it.each([true, 1, '1', '1.00'])('开启值 %s 触发默认规则', (value) => {
    expect(partEffectActive(DEFAULT_PART_EFFECT, value)).toBe(true)
  })

  it.each([false, 0, '0', 2, null, undefined, '', Number.NaN, {}])(
    '关闭、无数据和未匹配值 %s 不触发',
    (value) => {
      expect(partEffectActive(DEFAULT_PART_EFFECT, value)).toBe(false)
    },
  )

  it('反向编码明确配置0，false有效但无数据不是0', () => {
    const effect = { ...DEFAULT_PART_EFFECT, threshold: 0 }
    expect(partEffectActive(effect, false)).toBe(true)
    expect(partEffectActive(effect, '0')).toBe(true)
    expect(partEffectActive(effect, null)).toBe(false)
  })

  it('关闭效果、缺规则与始终模式有独立语义', () => {
    expect(partEffectActive(null, 1)).toBe(false)
    expect(partEffectActive(undefined, 1)).toBe(false)
    expect(
      partEffectActive({ ...DEFAULT_PART_EFFECT, enabled: false }, 1),
    ).toBe(false)
    expect(
      partEffectActive({ ...DEFAULT_PART_EFFECT, mode: 'always' }, undefined),
    ).toBe(true)
  })

  it('规则关闭和始终触发仍保留原部件绑定行', () => {
    const parts = normalizeTwinConfig({
      parts: [
        { id: 'plain' },
        { id: 'paused', effect: { enabled: false } },
        { id: 'constant', effect: { mode: 'always' } },
      ],
    }).parts
    expect(effectParts(parts).map((part) => part.id)).toEqual([
      'paused',
      'constant',
    ])
  })
})

describe('效果周期与配置边界', () => {
  it('闪烁亮暗分明，周期结束重新亮起', () => {
    const effect = { ...DEFAULT_PART_EFFECT, pattern: 'blink' as const }
    expect(
      [0, 400, 800, 1200, 1600].map((time) =>
        partEffectIntensity(effect, time),
      ),
    ).toEqual([1, 1, 0, 0, 1])
  })

  it('呼吸从亮相到谷底再恢复，持续高亮不随时间变化', () => {
    expect(partEffectIntensity(DEFAULT_PART_EFFECT, 0)).toBe(1)
    expect(partEffectIntensity(DEFAULT_PART_EFFECT, 400)).toBeCloseTo(0.5)
    expect(partEffectIntensity(DEFAULT_PART_EFFECT, 800)).toBe(0)
    expect(partEffectIntensity(DEFAULT_PART_EFFECT, 1600)).toBe(1)
    expect(
      partEffectIntensity({ ...DEFAULT_PART_EFFECT, pattern: 'steady' }, 800),
    ).toBe(1)
    expect(partEffectIntensity(DEFAULT_PART_EFFECT, -10)).toBe(1)
    expect(partEffectIntensity(DEFAULT_PART_EFFECT, Number.NaN)).toBe(1)
  })

  it('非法配置回落，强度与周期夹到边界，显式空色保持原色', () => {
    expect(
      normalizePartEffect({
        mode: 'other',
        operator: 'bad',
        pattern: 'noise',
        threshold: 'bad',
      }),
    ).toEqual(DEFAULT_PART_EFFECT)
    expect(
      normalizePartEffect({ color: '', blend: -1, glow: 99, periodMs: 10 }),
    ).toMatchObject({ color: '', blend: 0, glow: 3, periodMs: 600 })
    expect(
      normalizePartEffect({ blend: 99, glow: -2, periodMs: 20000 }),
    ).toMatchObject({ blend: 1, glow: 0, periodMs: 10000 })
  })
})
