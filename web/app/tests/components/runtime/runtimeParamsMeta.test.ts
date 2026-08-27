/**
 * @fileoverview 危险方向的判定：`on` 与 `off` 是**相反**的两侧。
 *
 * ⚠ 这条最容易漏：同为开关不等于同一个方向。采集类开关关掉才危险，清理类开关
 * 打开才危险（它会真实删行）。少一侧的表现是那一项静默不弹确认，而它恰恰是
 * 整组里唯一会删数据的那一项。
 */
import { describe, expect, it } from 'vitest'

import {
  DANGER_TEXT,
  isDangerousChange,
} from '@/components/runtime/runtimeParamsMeta'

describe('危险方向', () => {
  it('`off` 只在由开改关时命中，反方向放行', () => {
    expect(isDangerousChange('off', true, false)).toBe(true)
    expect(isDangerousChange('off', false, true)).toBe(false)
  })

  it('⚠ `on` 只在由关改开时命中——保留期清理打开才开始真删行', () => {
    expect(isDangerousChange('on', false, true)).toBe(true)
    expect(isDangerousChange('on', true, false)).toBe(false)
  })

  it('`decrease` 看数值方向', () => {
    expect(isDangerousChange('decrease', 24, 0)).toBe(true)
    expect(isDangerousChange('decrease', 0, 24)).toBe(false)
  })

  it('没登记方向的项、以及压根没改的项，一律不弹', () => {
    expect(isDangerousChange(null, true, false)).toBe(false)
    expect(isDangerousChange('off', true, true)).toBe(false)
  })

  it('三个方向都有后果文案：缺一条会把提示渲染成 undefined', () => {
    for (const danger of ['off', 'on', 'decrease']) {
      expect(DANGER_TEXT[danger]).toBeTruthy()
    }
  })
})
