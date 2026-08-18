/**
 * @fileoverview 契约：设计尺寸预设表与夹取——越界的尺寸被拉回上下界，
 * 手改过的宽高反查得到「自定义」，且下拉选项里恒有自定义那一项。
 */
import { describe, expect, it } from 'vitest'

import {
  CUSTOM_PRESET_ID,
  DEFAULT_DESIGN_HEIGHT,
  DEFAULT_DESIGN_WIDTH,
  RATIO_PRESETS,
  RATIO_PRESET_OPTIONS,
  clampDesignSize,
  findPreset,
  presetIdFor,
} from '@/pages/Home/scripts/ratioPresets'

describe('夹取设计尺寸', () => {
  it('小于下界的拉回下界', () => {
    expect(clampDesignSize(10)).toBe(320)
  })

  it('大于上界的拉回上界', () => {
    expect(clampDesignSize(99999)).toBe(7680)
  })

  it('小数四舍五入成整像素', () => {
    expect(clampDesignSize(1920.6)).toBe(1921)
  })

  it('非有限数回落到下界而不是 NaN', () => {
    expect(clampDesignSize(Number.NaN)).toBe(320)
  })
})

describe('预设反查', () => {
  it('命中预设时给出它的 id', () => {
    expect(presetIdFor(DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT)).toBe('fhd')
  })

  it('没命中任何预设时是自定义', () => {
    expect(presetIdFor(1234, 567)).toBe(CUSTOM_PRESET_ID)
  })

  it('按 id 取得到预设本身', () => {
    expect(findPreset('portrait')).toEqual({
      id: 'portrait',
      label: '竖屏 · 9:16',
      width: 1080,
      height: 1920,
    })
  })

  it('自定义与未知 id 都取不到预设，调用方据此不动宽高', () => {
    expect(findPreset(CUSTOM_PRESET_ID)).toBeUndefined()
    expect(findPreset('没这个')).toBeUndefined()
  })
})

describe('预设表本身', () => {
  it('横屏竖屏与带鱼屏都有，且尺寸都在合法区间里', () => {
    const ids = RATIO_PRESETS.map((preset) => preset.id)
    expect(ids).toContain('fhd')
    expect(ids).toContain('portrait')
    expect(ids).toContain('ultrawide')
    for (const preset of RATIO_PRESETS) {
      expect(clampDesignSize(preset.width)).toBe(preset.width)
      expect(clampDesignSize(preset.height)).toBe(preset.height)
    }
  })

  it('下拉选项末尾恒挂自定义，否则手改宽高后下拉会退回占位文案', () => {
    const last = RATIO_PRESET_OPTIONS[RATIO_PRESET_OPTIONS.length - 1]
    expect(last?.value).toBe(CUSTOM_PRESET_ID)
    expect(RATIO_PRESET_OPTIONS).toHaveLength(RATIO_PRESETS.length + 1)
  })
})
