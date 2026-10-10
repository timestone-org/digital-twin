/** @fileoverview 状态效果预设只覆盖外观，不改变暂停和触发规则。 */
import { DEFAULT_PART_EFFECT, type TwinPartEffect } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { applyPartEffectPreset } from '@/pages/TwinEditor/scripts/partEffectPresets'

describe('状态效果预设', () => {
  const paused: TwinPartEffect = {
    ...DEFAULT_PART_EFFECT,
    enabled: false,
    mode: 'always',
    operator: 'gte',
    threshold: 30,
  }

  it.each([
    [
      'running',
      {
        pattern: 'steady',
        color: '--state-success',
        blend: 0.65,
        glow: 0.6,
        periodMs: 1600,
      },
    ],
    [
      'fault',
      {
        pattern: 'blink',
        color: '--state-danger',
        blend: 0.9,
        glow: 1.5,
        periodMs: 1200,
      },
    ],
    [
      'attention',
      {
        pattern: 'pulse',
        color: '--state-warning',
        blend: 0.85,
        glow: 1.2,
        periodMs: 1600,
      },
    ],
  ] as const)('预设%s只改变效果外观', (id, appearance) => {
    expect(applyPartEffectPreset(paused, id)).toEqual({
      enabled: false,
      mode: 'always',
      operator: 'gte',
      threshold: 30,
      ...appearance,
    })
    expect(paused).toEqual({
      ...DEFAULT_PART_EFFECT,
      enabled: false,
      mode: 'always',
      operator: 'gte',
      threshold: 30,
    })
  })

  it('未知预设不改规则', () => {
    expect(applyPartEffectPreset(paused, 'unknown')).toBe(paused)
  })
})
