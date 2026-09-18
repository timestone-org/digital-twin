/** @fileoverview 已加载模型的缺失动画识别与保存前清理。 */
import type { TwinConfig, TwinModelAnimations } from '@dt/twin-config'

export function missingAnimationNames(
  config: TwinModelAnimations,
  clips: readonly { name: string }[],
  status: string | undefined,
): ReadonlySet<string> {
  if (status !== 'ready') return new Set<string>()
  const available = new Set(clips.map((clip) => clip.name))
  return new Set(
    config.controls
      .filter((control) => !available.has(control.clip))
      .map((control) => control.clip),
  )
}

export function removeMissingAnimations(
  config: TwinConfig,
  missing: ReadonlySet<string>,
): TwinConfig {
  if (missing.size === 0) return config
  return {
    ...config,
    model: {
      ...config.model,
      animations: {
        ...config.model.animations,
        controls: config.model.animations.controls.filter(
          (control) => !missing.has(control.clip),
        ),
      },
    },
  }
}
