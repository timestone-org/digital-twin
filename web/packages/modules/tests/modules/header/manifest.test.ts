/**
 * @fileoverview 守页头清单的声明：钉在页头区域、是容器、裸渲染，以及壳不消费的
 * chrome 键逐键点名——声明漂了，面板上就会多出或缺掉「配了没反应」的控件。
 */
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/header/manifest'

describe('页头清单的声明', () => {
  it('钉在页头区域，是容器，且不套卡片框', () => {
    expect(manifest.type).toBe('header')
    expect(manifest.region).toBe('header')
    expect(manifest.isContainer).toBe(true)
    expect(manifest.chrome).toBe('bare')
  })
})

describe('页头壳不消费的 chrome 键', () => {
  // ⚠ 标题条自绘：竖条宽 / 圆角 / 辉光 / 颜色与标题排版四件套是通的，
  //   照常消费；其余标题键壳里没有对应消费点
  it('逐键声明：开关与排布类，竖条四件套照常消费', () => {
    expect(manifest.unsupportedChromeKeys).toEqual([
      'showTitle',
      'titleAlign',
      'titlePadding',
      'titleGap',
      'titleBarFull',
      'titleBarColorAlt',
      'titlePulse',
      'titlePulseDuration',
      'titleRule',
      'titleRuleHeight',
      'titleRuleOpacity',
    ])
  })
})
