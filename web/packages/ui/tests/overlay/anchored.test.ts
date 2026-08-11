/**
 * @fileoverview 内容自适应浮层的定位契约：翻转、贴边、夹进视口、箭头回指。
 * ⚠ 首帧量不到尺寸时必须按「放得下」处理：那一帧就翻转的话，浮层会在
 * 出现的瞬间跳一下，而这在真实浏览器里只是一闪，测不出来也看不清。
 */
import { describe, expect, it } from 'vitest'

import { computeAnchoredPosition } from '../../src/overlay/placement'
import type { AnchoredPositionInput } from '../../src/overlay/placement'

const VIEWPORT = { viewportWidth: 1000, viewportHeight: 800 }
/** 视口正中一个 100×20 的触发器。 */
const CENTERED = { top: 400, bottom: 420, left: 450, right: 550 }

function place(overrides: Partial<AnchoredPositionInput> = {}) {
  return computeAnchoredPosition({
    trigger: CENTERED,
    overlay: { width: 200, height: 100 },
    side: 'bottom',
    ...VIEWPORT,
    ...overrides,
  })
}

function px(value: string | undefined): number {
  return Number.parseFloat(value ?? '')
}

describe('主轴', () => {
  it('bottom 落在触发器下方，留出 gutter', () => {
    expect(px(place({ side: 'bottom', gutter: 8 }).style.top)).toBe(428)
  })

  it('top 落在触发器上方，要扣掉浮层自身高度', () => {
    expect(px(place({ side: 'top', gutter: 8 }).style.top)).toBe(292)
  })

  it('right 落在触发器右侧', () => {
    expect(px(place({ side: 'right', gutter: 8 }).style.left)).toBe(558)
  })

  it('left 落在触发器左侧，要扣掉浮层自身宽度', () => {
    expect(px(place({ side: 'left', gutter: 8 }).style.left)).toBe(242)
  })

  it('缺省 gutter 也留了间距，不贴死在触发器上', () => {
    expect(px(place({ side: 'bottom' }).style.top)).toBeGreaterThan(420)
  })
})

describe('翻转', () => {
  it('空间够时不翻', () => {
    expect(place({ side: 'bottom' }).side).toBe('bottom')
  })

  it('下方放不下且上方更宽裕时翻到上面', () => {
    const result = place({
      trigger: { top: 700, bottom: 720, left: 450, right: 550 },
      side: 'bottom',
    })
    expect(result.side).toBe('top')
  })

  it('上方放不下且下方更宽裕时翻到下面', () => {
    const result = place({
      trigger: { top: 20, bottom: 40, left: 450, right: 550 },
      side: 'top',
    })
    expect(result.side).toBe('bottom')
  })

  it('⚠ 两边都放不下时不翻：翻过去只是换个地方被裁', () => {
    const result = place({
      trigger: { top: 380, bottom: 420, left: 450, right: 550 },
      overlay: { width: 200, height: 900 },
      side: 'bottom',
    })
    expect(result.side).toBe('bottom')
  })

  it('横向同理：右边放不下且左边更宽裕时翻到左边', () => {
    const result = place({
      trigger: { top: 400, bottom: 420, left: 900, right: 960 },
      side: 'right',
    })
    expect(result.side).toBe('left')
  })

  it('⚠ 首帧量不到尺寸时不翻，避免浮层出现的瞬间跳一下', () => {
    const result = place({
      trigger: { top: 780, bottom: 800, left: 450, right: 550 },
      overlay: { width: 0, height: 0 },
      side: 'bottom',
    })
    expect(result.side).toBe('bottom')
  })
})

describe('自由轴对齐', () => {
  it('缺省居中于触发器', () => {
    expect(px(place().style.left)).toBe(400)
  })

  it('start 与触发器左边对齐', () => {
    expect(px(place({ align: 'start' }).style.left)).toBe(450)
  })

  it('end 与触发器右边对齐', () => {
    expect(px(place({ align: 'end' }).style.left)).toBe(350)
  })

  it('竖直方向的浮层按上下对齐', () => {
    expect(px(place({ side: 'right', align: 'start' }).style.top)).toBe(400)
  })
})

describe('夹进视口', () => {
  it('触发器贴左边时浮层不越出左边界', () => {
    const result = place({
      trigger: { top: 400, bottom: 420, left: 0, right: 40 },
    })
    expect(px(result.style.left)).toBe(8)
  })

  it('触发器贴右边时浮层不越出右边界', () => {
    const result = place({
      trigger: { top: 400, bottom: 420, left: 960, right: 1000 },
    })
    expect(px(result.style.left)).toBe(792)
  })

  it('⚠ 视口比浮层还窄时保左上角，不推成负坐标', () => {
    const result = place({
      overlay: { width: 2000, height: 100 },
      viewportWidth: 300,
    })
    expect(px(result.style.left)).toBe(8)
  })
})

describe('箭头回指', () => {
  it('居中时箭头落在浮层正中', () => {
    expect(place().arrowOffset).toBe(100)
  })

  it('⚠ 浮层被夹到边上后，箭头跟着触发器中心走而不是继续居中', () => {
    const result = place({
      trigger: { top: 400, bottom: 420, left: 0, right: 40 },
    })
    expect(result.arrowOffset).toBe(12)
  })

  it('箭头离两端至少留出安全距离，不顶到圆角上', () => {
    const result = place({
      trigger: { top: 400, bottom: 420, left: 0, right: 4 },
    })
    expect(result.arrowOffset).toBeGreaterThanOrEqual(10)
  })

  it('浮层被夹住而触发器仍在更右侧时，箭头停在右端安全线上', () => {
    const result = place({
      trigger: { top: 400, bottom: 420, left: 996, right: 1000 },
      align: 'start',
    })
    expect(result.arrowOffset).toBe(190)
  })
})
