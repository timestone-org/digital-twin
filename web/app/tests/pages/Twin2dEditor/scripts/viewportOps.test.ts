/**
 * @fileoverview 契约：屏幕 ⇄ 设计坐标是一对逆变换、缩放以**指针**为锚（锚点底下那个
 * 设计坐标一动不动），以及容器宽高为 0 时不产出 NaN。
 *
 * ⚠ 锚错了不会报错，只表现为「越放大越找不到刚才在看的地方」。
 * ⚠ 首帧容器是 0×0，算出 NaN 之后 `translate(NaN, NaN)` 会让整块空白，而 devtools
 * 里看什么都正常。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_IDENTITY_VIEW,
  TWIN_2D_MAX_ZOOM,
  TWIN_2D_MIN_ZOOM,
  TWIN_2D_ZOOM_STEP,
  clampZoom,
  designPointAt,
  fitView,
  localPoint,
  panBy,
  stageStyle,
  toDesignPoint,
  toLocalPoint,
  zoomByFactor,
  zoomByWheel,
  zoomTo,
} from '@/pages/Twin2dEditor/scripts/viewportOps'
import type { Twin2dViewport } from '@/pages/Twin2dEditor/scripts/viewportOps'

const CANVAS = { width: 1000, height: 500 }
const VIEW: Twin2dViewport = { scale: 2, tx: -100, ty: -50 }

describe('坐标换算', () => {
  it('指针坐标先减掉宿主原点才是宿主内坐标', () => {
    expect(
      localPoint({ left: 10, top: 20 }, { clientX: 30, clientY: 50 }),
    ).toEqual({ x: 20, y: 30 })
  })

  it('屏幕与设计两个方向是一对逆变换', () => {
    const design = { x: 123, y: 45 }

    expect(toDesignPoint(VIEW, toLocalPoint(VIEW, design))).toEqual(design)
  })

  it('一步到位的换算与分两步走结果相同', () => {
    const rect = { left: 10, top: 20 }
    const at = { clientX: 110, clientY: 70 }

    expect(designPointAt(VIEW, rect, at)).toEqual(
      toDesignPoint(VIEW, localPoint(rect, at)),
    )
  })

  it('倍率为 0 的视口按 1 算，不出 Infinity', () => {
    expect(toDesignPoint({ scale: 0, tx: 0, ty: 0 }, { x: 5, y: 7 })).toEqual({
      x: 5,
      y: 7,
    })
  })

  it('指针坐标缺失时按 0 算，不把 NaN 传下去', () => {
    const at = localPoint({ left: 10, top: 20 }, { clientX: NaN, clientY: 4 })

    expect(at).toEqual({ x: -10, y: -16 })
  })
})

describe('缩放', () => {
  it('倍率夹在上下限之间', () => {
    expect(clampZoom(1000)).toBe(TWIN_2D_MAX_ZOOM)
    expect(clampZoom(0.0001)).toBe(TWIN_2D_MIN_ZOOM)
    expect(clampZoom(NaN)).toBe(1)
  })

  it('指针底下的设计坐标在缩放前后一动不动', () => {
    const anchor = { x: 240, y: 160 }
    const before = toDesignPoint(TWIN_2D_IDENTITY_VIEW, anchor)

    const next = zoomTo(TWIN_2D_IDENTITY_VIEW, 3, anchor)

    expect(next.scale).toBe(3)
    expect(toDesignPoint(next, anchor)).toEqual(before)
  })

  it('滚轮向上是放大、向下是缩小', () => {
    const anchor = { x: 0, y: 0 }

    expect(zoomByWheel(TWIN_2D_IDENTITY_VIEW, -100, anchor).scale).toBeCloseTo(
      TWIN_2D_ZOOM_STEP,
    )
    expect(zoomByWheel(TWIN_2D_IDENTITY_VIEW, 100, anchor).scale).toBeCloseTo(
      1 / TWIN_2D_ZOOM_STEP,
    )
  })

  it('触控板甩出的巨大增量最多顶三档', () => {
    const scaled = zoomByWheel(TWIN_2D_IDENTITY_VIEW, -99999, { x: 0, y: 0 })

    expect(scaled.scale).toBeCloseTo(TWIN_2D_ZOOM_STEP ** 3)
  })

  it('工具栏那一档锚在视口正中，中心底下的设计坐标不动', () => {
    const box = { width: 400, height: 300 }
    const center = { x: 200, y: 150 }
    const before = toDesignPoint(TWIN_2D_IDENTITY_VIEW, center)

    const next = zoomByFactor(TWIN_2D_IDENTITY_VIEW, box, 2)

    expect(next.scale).toBe(2)
    expect(toDesignPoint(next, center)).toEqual(before)
  })

  it('倍率给了非有限值时按不变一档算', () => {
    expect(zoomByFactor(VIEW, { width: 400, height: 300 }, NaN).scale).toBe(2)
  })
})

describe('平移', () => {
  it('按屏幕位移挪，倍率不变', () => {
    expect(panBy(VIEW, 10, -3)).toEqual({ scale: 2, tx: -90, ty: -53 })
  })

  it('位移是非有限值时原地不动', () => {
    expect(panBy(VIEW, NaN, NaN)).toEqual(VIEW)
  })
})

describe('适应取景', () => {
  it('整张画布等比缩进容器并居中', () => {
    const fit = fitView(CANVAS, { width: 400, height: 400 }, 0)

    expect(fit).toEqual({ scale: 0.4, tx: 0, ty: 100 })
  })

  it('留白按比例吃掉一圈', () => {
    const fit = fitView(CANVAS, { width: 400, height: 400 }, 0.5)

    expect(fit.scale).toBeCloseTo(0.2)
  })

  it('留白比例越界时夹到一半', () => {
    const fit = fitView(CANVAS, { width: 400, height: 400 }, 9)

    expect(fit.scale).toBeCloseTo(0.2)
  })

  it('容器宽高为 0 时回单位视口而不是 NaN', () => {
    const fit = fitView(CANVAS, { width: 0, height: 0 })

    expect(fit).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('画布宽高为 0 时同样回单位视口', () => {
    const fit = fitView({ width: 0, height: 0 }, { width: 400, height: 400 })

    expect(fit).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('容器尺寸不是数时也不产出 NaN', () => {
    const fit = fitView(CANVAS, { width: NaN, height: 400 })

    expect(Number.isFinite(fit.scale) && Number.isFinite(fit.tx)).toBe(true)
  })
})

describe('舞台样式', () => {
  it('变换串与坐标换算是同一条式子：先缩放后平移', () => {
    expect(stageStyle(VIEW, CANVAS)).toEqual({
      width: '1000px',
      height: '500px',
      transform: 'translate(-100px, -50px) scale(2)',
      transformOrigin: '0 0',
    })
  })
})
