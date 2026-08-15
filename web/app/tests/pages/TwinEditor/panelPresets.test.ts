/**
 * @fileoverview 信息牌外观预设的口径：只覆盖列出的键、能认出当前套用的是哪一套、
 * 手调过就不再声称命中。
 */
import { describe, expect, it } from 'vitest'
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinPanelStyle } from '@dt/twin-config'

import {
  TWIN_PANEL_PRESETS,
  matchedPanelPreset,
} from '@/pages/TwinEditor/panelPresets'

/** 一份归一化过的缺省样式。 */
function baseStyle(): TwinPanelStyle {
  const config = normalizeTwinConfig({ panels: [{ id: 'p1', name: '牌' }] })
  const panel = config.panels[0]
  expect(panel).toBeDefined()
  return panel?.style as TwinPanelStyle
}

describe('预设清单', () => {
  it('每套都有 id、文案与说明，且 id 不重复', () => {
    const ids = TWIN_PANEL_PRESETS.map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of TWIN_PANEL_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.hint.length).toBeGreaterThan(0)
    }
  })

  it('一套都不动配色——主题色是按项目定的，换版式不该把它抹掉', () => {
    for (const preset of TWIN_PANEL_PRESETS) {
      expect(preset.patch.accent).toBeUndefined()
      expect(preset.patch.background).toBeUndefined()
    }
  })
})

describe('命中判定', () => {
  it('套上一套预设后能认出是哪一套', () => {
    const preset = TWIN_PANEL_PRESETS[1]
    expect(preset).toBeDefined()
    if (preset === undefined) return

    const applied: TwinPanelStyle = { ...baseStyle(), ...preset.patch }

    expect(matchedPanelPreset(applied)).toBe(preset.id)
  })

  it('预设没列的键各不相同也照样算命中', () => {
    const preset = TWIN_PANEL_PRESETS[0]
    expect(preset).toBeDefined()
    if (preset === undefined) return

    const applied: TwinPanelStyle = {
      ...baseStyle(),
      ...preset.patch,
      accent: '#ff0000',
      width: 321,
    }

    expect(matchedPanelPreset(applied)).toBe(preset.id)
  })

  it('把预设列出的键改掉之后就不再声称命中', () => {
    const preset = TWIN_PANEL_PRESETS.find((item) => item.id === 'tech-hud')
    expect(preset).toBeDefined()
    if (preset === undefined) return

    const applied: TwinPanelStyle = {
      ...baseStyle(),
      ...preset.patch,
      pulse: false,
    }

    expect(matchedPanelPreset(applied)).not.toBe('tech-hud')
  })
})
