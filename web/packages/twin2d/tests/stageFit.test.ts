/**
 * @fileoverview 契约：缩放倍率与它的反函数对得上——按 `twin2dDesignSize` 配出来的
 * 画布，上屏后倍率就是 1。四档各验一遍，边长夹取那一档照实交出夹过的值。
 *
 * ⚠ 反函数写反了不会报错：编辑器上写着「1:1」，大屏上却缩了一点点，两边单看都对。
 * 所以这里断的是**往返**，不是各自与一个手抄的数。
 * ⚠ `contain` 那一档取整代价不为零：边长必须是整数，凑不出的那不到半像素由这里
 * 用容差认下，而不是让实现去交出小数。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_DEFAULT_FIT_PADDING,
  TWIN_2D_MIN_CANVAS_SIZE,
} from '../src/constants'
import { twin2dDesignSize, twin2dFitScales } from '../src/stageFit'
import type { Twin2dBox, Twin2dFitView } from '../src/stageFit'

/** 一块常见的大屏格子：非方形，两轴写反了才看得出来。 */
const CELL: Twin2dBox = { width: 1280, height: 480 }

/** 当前画布：两轴都与格子不同，「原样留用」的那一轴才验得出来。 */
const CURRENT: Twin2dBox = { width: 900, height: 700 }

/** 取整凑不出的那不到半像素：1280 px 上折合不到 1 px。 */
const ROUNDING = 3

const MODES = ['contain', 'width', 'height', 'stretch', 'none'] as const

/**
 * 造一档缩放配置。
 * @param fitMode 缩放档
 * @param fitPadding 四周留白（%）
 */
function viewOf(
  fitMode: Twin2dFitView['fitMode'],
  fitPadding = TWIN_2D_DEFAULT_FIT_PADDING,
): Twin2dFitView {
  return { fitMode, fitPadding }
}

describe('倍率与反函数的往返', () => {
  it.each(MODES)('%s 档按反函数配出来的画布，上屏倍率就是 1', (mode) => {
    const view = viewOf(mode)

    const canvas = twin2dDesignSize(CELL, view, CURRENT)

    const [sx, sy] = twin2dFitScales(view, canvas, CELL)
    expect(sx).toBeCloseTo(1, ROUNDING)
    expect(sy).toBeCloseTo(1, ROUNDING)
  })

  it('留白为 0 时 contain 的答案就是格子本身，一点不差', () => {
    const view = viewOf('contain', 0)

    expect(twin2dDesignSize(CELL, view, CURRENT)).toEqual(CELL)
    expect(twin2dFitScales(view, CELL, CELL)).toEqual([1, 1])
  })
})

describe('反函数', () => {
  it('contain 下是「格子 × (1 − 留白)」，不是格子本身', () => {
    // 留白乘在倍率上，渲染出来的图恒等于格子的 96%，画布配多大都改不了
    expect(twin2dDesignSize(CELL, viewOf('contain', 4), CURRENT)).toEqual({
      width: 1229,
      height: 461,
    })
  })

  it('width 档只钉宽，高原样留给用户', () => {
    expect(twin2dDesignSize(CELL, viewOf('width'), CURRENT)).toEqual({
      width: CELL.width,
      height: CURRENT.height,
    })
  })

  it('height 档只钉高，宽原样留给用户', () => {
    expect(twin2dDesignSize(CELL, viewOf('height'), CURRENT)).toEqual({
      width: CURRENT.width,
      height: CELL.height,
    })
  })

  it('stretch 档两轴都钉成格子，留白一点不吃', () => {
    expect(twin2dDesignSize(CELL, viewOf('stretch', 20), CURRENT)).toEqual(CELL)
  })

  it('格子比画布下限还小时交出夹过的值，不假装配上了', () => {
    const tiny: Twin2dBox = { width: 120, height: 80 }

    const canvas = twin2dDesignSize(tiny, viewOf('stretch'), CURRENT)

    expect(canvas).toEqual({
      width: TWIN_2D_MIN_CANVAS_SIZE,
      height: TWIN_2D_MIN_CANVAS_SIZE,
    })
    expect(twin2dFitScales(viewOf('stretch'), canvas, tiny)[0]).not.toBe(1)
  })
})

describe('原尺寸那一档', () => {
  // ⚠ 其余四档都落成 CSS transform，倍率不为 1 时整块图被重采样，字与细线必然发虚。
  // 这一档存在的全部理由就是「倍率恒等于 1」——它一旦不为 1，这一档就没有意义了
  it('倍率恒为 1，格子多大都不缩', () => {
    const view: Twin2dFitView = { fitMode: 'none', fitPadding: 20 }

    for (const canvas of [CELL, CURRENT, { width: 200, height: 2000 }]) {
      expect(twin2dFitScales(view, canvas, CELL)).toEqual([1, 1])
    }
  })

  it('没有「该配多大」这回事，反函数原样交回当前尺寸', () => {
    const view: Twin2dFitView = { fitMode: 'none', fitPadding: 4 }

    expect(twin2dDesignSize(CELL, view, CURRENT)).toEqual(CURRENT)
  })
})
