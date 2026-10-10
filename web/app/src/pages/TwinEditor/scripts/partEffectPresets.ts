/** @fileoverview 部件状态效果的常用外观预设；触发条件由用户独立配置。 */
import type { TwinPartEffect } from '@dt/twin-config'

type EffectAppearance = Pick<
  TwinPartEffect,
  'pattern' | 'color' | 'blend' | 'glow' | 'periodMs'
>

export const PART_EFFECT_PRESETS = [
  {
    id: 'running',
    label: '运行常亮',
    appearance: {
      pattern: 'steady',
      color: '--state-success',
      blend: 0.65,
      glow: 0.6,
      periodMs: 1600,
    },
  },
  {
    id: 'fault',
    label: '故障闪烁',
    appearance: {
      pattern: 'blink',
      color: '--state-danger',
      blend: 0.9,
      glow: 1.5,
      periodMs: 1200,
    },
  },
  {
    id: 'attention',
    label: '提醒呼吸',
    appearance: {
      pattern: 'pulse',
      color: '--state-warning',
      blend: 0.85,
      glow: 1.2,
      periodMs: 1600,
    },
  },
] as const satisfies readonly {
  id: string
  label: string
  appearance: EffectAppearance
}[]

/** 应用外观预设，保留开关、触发方式和比较条件。 */
export function applyPartEffectPreset(
  effect: TwinPartEffect,
  presetId: string,
): TwinPartEffect {
  const preset = PART_EFFECT_PRESETS.find((item) => item.id === presetId)
  return preset === undefined ? effect : { ...effect, ...preset.appearance }
}
