/**
 * @fileoverview 契约：画布裁到内容。外接盒把节点、标注与连线**完整折线**三样都算进去，
 * 裁完四周各留一圈白、全图挪到原点，三样坐标一起挪，已经裁好了就一个字都不改。
 *
 * ⚠ 只挪节点的话，连线拐点与标注留在原地，图就散了——而每一件单看都还在自己该在的
 * 地方，看图基本发现不了。
 * ⚠ 用预置库样式的节点必须量得出盒：只喂文档里那几份的话，它们会被裁在画布外面。
 * ⚠ 裁出一份没改动的配置会往撤销栈里塞一格空步，撤销键从此要多按一次。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_FIT_MARGIN,
  twin2dContentBox,
  twin2dContentFitOf,
  twin2dFitToContent,
} from '@/pages/Twin2dEditor/scripts/fitContent'

/** 40×20 的方块。 */
const STYLE = { id: 's1', name: '方块', size: { w: 40, h: 20 } }

/**
 * 一张画在大画布右下角的小图：内容只占 (300,200)–(540,420)，四周全是空白，
 * 正是「上了大屏白缩一大截」的那种图。
 * ⚠ 两轴都得大过画布下限（200），不然裁出来的尺寸是被夹出来的，那条断言就验不到留白。
 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 1600, height: 900, grid: 20 },
  styles: [STYLE],
  nodes: [
    { id: 'a', styleId: 's1', x: 300, y: 200 },
    { id: 'b', styleId: 's1', x: 500, y: 400 },
  ],
})

/** 带一条标注的那份：标注比节点还靠左上，外接盒该跟着它走。 */
const WITH_MARK: Twin2dConfig = normalizeTwin2dConfig({
  ...CONFIG,
  marks: [{ id: 'm1', kind: 'rect', x: 100, y: 120, w: 60, h: 40 }],
})

describe('外接盒', () => {
  it('两个节点各按自己的盒算，取并集', () => {
    expect(twin2dContentBox(CONFIG)).toEqual({
      x: 300,
      y: 200,
      w: 240,
      h: 220,
    })
  })

  it('标注也算进去', () => {
    expect(twin2dContentBox(WITH_MARK)).toEqual({
      x: 100,
      y: 120,
      w: 440,
      h: 300,
    })
  })

  it('一件都没画时给 null', () => {
    const empty = normalizeTwin2dConfig({ canvas: { width: 800, height: 600 } })

    expect(twin2dContentBox(empty)).toBeNull()
    expect(twin2dContentFitOf(empty)).toBeNull()
  })
})

describe('裁一次', () => {
  it('画布收成内容加两圈留白', () => {
    const fit = twin2dContentFitOf(CONFIG)

    expect(fit?.canvas).toEqual({
      width: 240 + TWIN_2D_FIT_MARGIN * 2,
      height: 220 + TWIN_2D_FIT_MARGIN * 2,
    })
  })

  it('全图挪到留白那一角，节点坐标跟着变', () => {
    const fit = twin2dContentFitOf(CONFIG)
    const next = twin2dFitToContent(CONFIG, fit ?? never())

    expect(next.nodes.map((node) => ({ x: node.x, y: node.y }))).toEqual([
      { x: TWIN_2D_FIT_MARGIN, y: TWIN_2D_FIT_MARGIN },
      { x: TWIN_2D_FIT_MARGIN + 200, y: TWIN_2D_FIT_MARGIN + 200 },
    ])
  })

  // ⚠ 只挪节点的话，标注留在原地，图就散了
  it('标注跟着一起挪', () => {
    const fit = twin2dContentFitOf(WITH_MARK)
    const next = twin2dFitToContent(WITH_MARK, fit ?? never())

    expect(next.marks[0]?.x).toBe(TWIN_2D_FIT_MARGIN)
    expect(next.marks[0]?.y).toBe(TWIN_2D_FIT_MARGIN)
  })

  it('裁完再量一次就已经贴着内容了，第二下什么都不改', () => {
    const first = twin2dContentFitOf(CONFIG)
    const next = twin2dFitToContent(CONFIG, first ?? never())

    const again = twin2dContentFitOf(next)

    expect(again?.exact).toBe(true)
    expect(twin2dFitToContent(next, again ?? never())).toBe(next)
  })

  it('内容比画布下限还小时按下限给，不产一个画不出来的画布', () => {
    const tiny = normalizeTwin2dConfig({
      canvas: { width: 1600, height: 900, grid: 20 },
      styles: [STYLE],
      nodes: [{ id: 'a', styleId: 's1', x: 300, y: 200 }],
    })

    expect(twin2dContentFitOf(tiny)?.canvas).toEqual({
      width: 200,
      height: 200,
    })
  })
})

/** 量不出来就让用例当场红，而不是拿一个兜底值糊过去。 */
function never(): never {
  throw new Error('这张图应该量得出外接盒')
}
