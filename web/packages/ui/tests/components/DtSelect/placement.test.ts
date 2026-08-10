/**
 * @fileoverview 浮层定位纯逻辑：空间不足时翻向，宽度与左边界的钳制。
 */
import { describe, expect, it } from 'vitest'

import { computeMenuPosition } from '../../../src/components/DtSelect/placement'

const VIEWPORT = { viewportWidth: 1000, viewportHeight: 800 }
const TRIGGER = { top: 100, bottom: 140, left: 200, width: 160 }

describe('computeMenuPosition', () => {
  it('下方够用时向下展开', () => {
    const result = computeMenuPosition({
      trigger: TRIGGER,
      menuHeight: 200,
      placement: 'bottom',
      ...VIEWPORT,
    })
    expect(result.placement).toBe('bottom')
    expect(result.style.top).toBe('146px')
  })

  it('下方放不下且上方更宽裕时翻到上方', () => {
    const result = computeMenuPosition({
      trigger: { top: 700, bottom: 740, left: 200, width: 160 },
      menuHeight: 200,
      placement: 'bottom',
      ...VIEWPORT,
    })
    expect(result.placement).toBe('top')
    expect(result.style.bottom).toBe('106px')
  })

  it('两边都放不下时选空间更大的一侧', () => {
    const result = computeMenuPosition({
      trigger: { top: 500, bottom: 540, left: 200, width: 160 },
      menuHeight: 999,
      placement: 'bottom',
      ...VIEWPORT,
    })
    expect(result.placement).toBe('top')
  })

  it('两侧空间相等时不翻——相等还翻会在临界点上来回抖', () => {
    const result = computeMenuPosition({
      trigger: { top: 380, bottom: 420, left: 200, width: 160 },
      menuHeight: 999,
      placement: 'bottom',
      ...VIEWPORT,
    })
    expect(result.placement).toBe('bottom')
  })

  it('高度为 0（尚未量到）时不翻向', () => {
    const result = computeMenuPosition({
      trigger: { top: 780, bottom: 799, left: 200, width: 160 },
      menuHeight: 0,
      placement: 'bottom',
      ...VIEWPORT,
    })
    expect(result.placement).toBe('bottom')
  })

  it('宽度跟随 trigger', () => {
    const result = computeMenuPosition({
      trigger: TRIGGER,
      menuHeight: 100,
      placement: 'bottom',
      ...VIEWPORT,
    })
    expect(result.style.width).toBe('160px')
  })

  it('贴右边时向左收，不越出视口', () => {
    const result = computeMenuPosition({
      trigger: { top: 100, bottom: 140, left: 960, width: 160 },
      menuHeight: 100,
      placement: 'bottom',
      ...VIEWPORT,
    })
    expect(result.style.left).toBe('840px')
  })

  it('视口比浮层还窄时贴左边，不给负值', () => {
    const result = computeMenuPosition({
      trigger: { top: 100, bottom: 140, left: 10, width: 400 },
      menuHeight: 100,
      placement: 'bottom',
      viewportWidth: 300,
      viewportHeight: 800,
    })
    expect(result.style.left).toBe('0px')
  })
})
