/**
 * @fileoverview 守页头清单的声明：钉在页头区域、是容器、裸渲染、壳里没有标题条，
 * 以及壳不消费的 chrome 键逐键点名——声明漂了，面板上就会多出或缺掉
 * 「配了没反应」的控件。
 */
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/header/manifest'
import { configDefaults } from '../../../src/shared/config'
import {
  SHOW_TITLE_CONFIG_KEY,
  hasTitleBar,
  resolveContentInset,
} from '../../../src/shared/container'

describe('页头清单的声明', () => {
  it('钉在页头区域，是容器，且不套卡片框', () => {
    expect(manifest.type).toBe('header')
    expect(manifest.region).toBe('header')
    expect(manifest.isContainer).toBe(true)
    expect(manifest.chrome).toBe('bare')
  })
})

describe('页头清单与容器几何的对齐', () => {
  // 大屏标题就是拖一个文字块进页头；壳里再给一份标题条就有两个答案，也会与它抢位置
  it('没有标题与标题条这两档配置', () => {
    const keys = manifest.configSchema.map((item) => item.key)

    expect(keys).not.toContain('title')
    expect(keys).not.toContain(SHOW_TITLE_CONFIG_KEY)
  })

  it('出厂配置里也不再落标题条开关', () => {
    expect(manifest.defaultConfig?.[SHOW_TITLE_CONFIG_KEY]).toBeUndefined()
  })

  // 存量大屏里遗留的 showTitle: true 会一直留在 config_json 里
  it('内容区只内缩一个内边距，遗留的开关也顶不出那 28px', () => {
    const defaults = configDefaults(manifest.configSchema)

    expect(hasTitleBar(manifest)).toBe(false)
    expect(resolveContentInset(defaults, manifest).top).toBe(8)
    expect(
      resolveContentInset(
        { ...defaults, [SHOW_TITLE_CONFIG_KEY]: true },
        manifest,
      ).top,
    ).toBe(8)
  })
})

describe('页头壳不消费的 chrome 键', () => {
  // ⚠ 壳里没有标题条：整套标题键都没有消费点，漏登记一个 = 面板上多一个
  //   「配了没反应」的控件
  it('逐键声明：整套标题键，边框与四角照常消费', () => {
    expect(manifest.unsupportedChromeKeys).toEqual([
      'showTitle',
      'titleColor',
      'titleAlign',
      'titlePadding',
      'titleGap',
      'titleFontSize',
      'titleFontWeight',
      'titleLetterSpacing',
      'titleBarWidth',
      'titleBarFull',
      'titleBarRadius',
      'titleBarGlow',
      'titleBarColor',
      'titleBarColorAlt',
      'titlePulse',
      'titlePulseDuration',
      'titleRule',
      'titleRuleHeight',
      'titleRuleOpacity',
    ])
  })
})
