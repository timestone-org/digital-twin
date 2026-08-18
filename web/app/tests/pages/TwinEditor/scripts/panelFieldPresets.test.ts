/**
 * @fileoverview 常用测点预设的口径：id 唯一、只预填展示口径不碰取数、
 * 小数位允许 null（原样上屏，不替后端做四舍五入）。
 */
import { describe, expect, it } from 'vitest'

import { PANEL_FIELD_PRESETS } from '@/pages/TwinEditor/scripts/panelFieldPresets'

describe('预设清单', () => {
  it('id 不重复，标签都不为空', () => {
    const ids = PANEL_FIELD_PRESETS.map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of PANEL_FIELD_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('小数位要么是非负整数要么是 null', () => {
    for (const preset of PANEL_FIELD_PRESETS) {
      if (preset.decimals === null) continue
      expect(Number.isInteger(preset.decimals)).toBe(true)
      expect(preset.decimals).toBeGreaterThanOrEqual(0)
    }
  })

  it('状态这类无量纲的量单位留空，不编一个出来', () => {
    const status = PANEL_FIELD_PRESETS.find((preset) => preset.id === 'status')

    expect(status?.unit).toBe('')
    expect(status?.decimals).toBeNull()
  })

  it('温度带单位与小数位——这正是预设要省掉的三处手填', () => {
    const temp = PANEL_FIELD_PRESETS.find(
      (preset) => preset.id === 'temperature',
    )

    expect(temp?.unit).toBe('℃')
    expect(temp?.decimals).toBe(1)
  })
})
