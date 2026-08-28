/**
 * @fileoverview 契约：「编辑一像素 = 大屏一像素」的判据——缩放档与留白从大屏节点上
 * 读、口径与模块壳逐条相同，1:1 的判定既看尺寸也看倍率，新节点的起手尺寸只在这一段
 * 整个不存在时才给。
 *
 * ⚠ 这几条错了都不报错：界面上写着「1:1 与大屏一致」，上了大屏还是缩着，两边单看
 * 都对。所以断的是「按它给的尺寸配完，倍率真的回到 1」。
 */
import { TWIN_2D_MIN_CANVAS_SIZE, twin2dFitScales } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  twin2dCellOf,
  twin2dHostFitView,
  twin2dParityOf,
  twin2dSeedCanvas,
} from '@/pages/Twin2dEditor/scripts/hostFit'

/** 一块常见的大屏格子。 */
const CELL = { width: 1280, height: 480 }

/** 缺省档（contain + 4% 留白）下这块格子的 1:1 设计尺寸。 */
const DESIGN = { width: 1229, height: 461 }

describe('从大屏节点上读缩放档', () => {
  it('什么都没配时是 contain + 缺省留白', () => {
    expect(twin2dHostFitView({})).toEqual({ fitMode: 'contain', fitPadding: 4 })
  })

  it('配了就照配的来', () => {
    expect(twin2dHostFitView({ fitMode: 'stretch', fitPadding: 12 })).toEqual({
      fitMode: 'stretch',
      fitPadding: 12,
    })
  })

  // ⚠ 口径必须与模块壳逐条相同：宽一格窄一格都会让这一页报出模块并不会照做的数
  it('档位落不到枚举回 contain，留白越界按上下限夹', () => {
    expect(twin2dHostFitView({ fitMode: '拉满一点点' }).fitMode).toBe('contain')
    expect(twin2dHostFitView({ fitPadding: 400 }).fitPadding).toBe(20)
    expect(twin2dHostFitView({ fitPadding: -5 }).fitPadding).toBe(0)
    expect(twin2dHostFitView({ fitPadding: '4' }).fitPadding).toBe(4)
  })
})

describe('格子', () => {
  it('宽高是正数才算数', () => {
    expect(twin2dCellOf({ w: 640, h: 360 })).toEqual({
      width: 640,
      height: 360,
    })
  })

  // ⚠ 拿 0 去算倍率会得到 Infinity，界面上于是报出一个荒唐的数
  it('节点没读出来、或宽高不是正数时给 null', () => {
    expect(twin2dCellOf(null)).toBeNull()
    expect(twin2dCellOf({ w: 0, h: 360 })).toBeNull()
    expect(twin2dCellOf({ w: 640, h: -1 })).toBeNull()
  })
})

describe('1:1 的判据', () => {
  it('对不上时给出该配多大，并照实说上屏缩成几成', () => {
    const parity = twin2dParityOf(CELL, twin2dHostFitView({}), {
      width: 1920,
      height: 1080,
    })

    expect(parity.exact).toBe(false)
    expect(parity.design).toEqual(DESIGN)
    expect(parity.summary).toBe('上屏后 43%')
  })

  it('按它给的尺寸配完，倍率真的回到 1，判定也跟着改口', () => {
    const view = twin2dHostFitView({})

    const parity = twin2dParityOf(CELL, view, DESIGN)

    expect(parity.exact).toBe(true)
    expect(parity.summary).toBe('1:1 与大屏一致')
    expect(twin2dFitScales(view, DESIGN, CELL)[0]).toBeCloseTo(1, 3)
  })

  // ⚠ 两轴不等比只有 stretch 出得来；写成一个数就把「横向拉伸、纵向压扁」说没了
  it('两轴倍率不同就两个数都写出来', () => {
    const parity = twin2dParityOf(
      CELL,
      { fitMode: 'stretch', fitPadding: 0 },
      { width: 640, height: 480 },
    )

    expect(parity.summary).toBe('上屏后 200% × 100%')
  })

  // ⚠ 边长被下限夹住时尺寸看着「已经是答案」，倍率却差得远——只比尺寸会在这里说谎
  it('格子比画布下限还小时不认作 1:1', () => {
    const tiny = { width: 120, height: 80 }
    const floor = {
      width: TWIN_2D_MIN_CANVAS_SIZE,
      height: TWIN_2D_MIN_CANVAS_SIZE,
    }

    const parity = twin2dParityOf(
      tiny,
      { fitMode: 'stretch', fitPadding: 0 },
      floor,
    )

    expect(parity.design).toEqual(floor)
    expect(parity.exact).toBe(false)
  })
})

describe('新节点的起手尺寸', () => {
  it('这一段整个不存在时给 1:1 的设计尺寸', () => {
    expect(twin2dSeedCanvas({}, 'twin2d', CELL)).toEqual(DESIGN)
  })

  // ⚠ 已经画过的图改尺寸等于把用户摆好的位置整体挪一遍，不该在打开页面这一刻发生
  it('已经有配置了就不给，哪怕它是空图', () => {
    expect(twin2dSeedCanvas({ twin2d: {} }, 'twin2d', CELL)).toBeNull()
  })

  it('不知道格子多大就不给', () => {
    expect(twin2dSeedCanvas({}, 'twin2d', null)).toBeNull()
  })
})

describe('超出格子', () => {
  // ⚠ 「原尺寸」那一档倍率恒为 1，画布大过格子就是真裁掉了一块，而读数上还写着 1:1
  it('原尺寸下画布大过格子时，读数把「会被裁掉」说出来', () => {
    const parity = twin2dParityOf(
      { width: 640, height: 360 },
      { fitMode: 'none', fitPadding: 0 },
      { width: 1280, height: 720 },
    )

    expect(parity.exact).toBe(true)
    expect(parity.summary).toBe('1:1 与大屏一致 · 超出格子的部分会被裁掉')
  })

  it('画布小于格子时不多这一句', () => {
    const parity = twin2dParityOf(
      { width: 1280, height: 720 },
      { fitMode: 'none', fitPadding: 0 },
      { width: 640, height: 360 },
    )

    expect(parity.summary).toBe('1:1 与大屏一致')
  })

  // ⚠ 会缩放的那几档按定义就贴得进去，多这一句只会吓人
  it('完整显示那一档永远不会被裁，也就不多这一句', () => {
    const parity = twin2dParityOf(
      { width: 640, height: 360 },
      { fitMode: 'contain', fitPadding: 4 },
      { width: 4000, height: 4000 },
    )

    expect(parity.summary).not.toContain('裁掉')
  })
})
