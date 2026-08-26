/**
 * @fileoverview 锁住两套互不相同的位移数学：九档锚点那张固定百分比表逐值不许漂
 * （改一个数就是药丸压在节点身上），以及 `perim` 由外法线推移出来的 translate 表达式
 * （角点 45° 法线让推移量比边上小 √2 倍）。另锁 flow / fill / abs 三档与 `Len` 四形态。
 */
import { describe, expect, it } from 'vitest'

import { anchor9Css, lenToCss, perimCss, placementCss } from '../src/placement'
import type { Twin2dPerimAt } from '../src/placement'

/** 宽 100 高 60：百分比与像素两套口径能区分得开 */
const BOX_W = 100
const BOX_H = 60

/** 45° 法线在一轴上推出的半身位：`-50 + √½ × 50` */
const DIAG_NEAR = '-14.644660940672622%'
/** 45° 法线在反向一轴上推出的半身位 */
const DIAG_FAR = '-85.35533905932738%'

/** 不带间隙与微调的 perim 落点 */
function perimAt(t: number): Twin2dPerimAt {
  return { kind: 'perim', t, gap: 0, dx: 0, dy: 0 }
}

describe('lenToCss', () => {
  it('Len 四形态：裸数按设计像素，其余三种原样', () => {
    expect(lenToCss(12)).toBe('12px')
    expect(lenToCss(0)).toBe('0px')
    expect(lenToCss('14%')).toBe('14%')
    expect(lenToCss('1.5em')).toBe('1.5em')
    expect(lenToCss('auto')).toBe('auto')
  })
})

describe('anchor9Css 九档锚点表', () => {
  it('t：贴上边中点、整个顶到盒外', () => {
    expect(anchor9Css('t', 0, 0)).toEqual({
      position: 'absolute',
      left: '50%',
      top: '0',
      transform: 'translate(calc(-50% + 0px), calc(-115% + 0px))',
    })
  })

  it('b：贴下边中点，纵向推移与 t 反号', () => {
    expect(anchor9Css('b', 0, 0)).toEqual({
      position: 'absolute',
      left: '50%',
      bottom: '0',
      transform: 'translate(calc(-50% + 0px), calc(115% + 0px))',
    })
  })

  it('l：贴左边中点，横向推移是 110% 而不是 115%', () => {
    expect(anchor9Css('l', 0, 0)).toEqual({
      position: 'absolute',
      left: '0',
      top: '50%',
      transform: 'translate(calc(-110% + 0px), calc(-50% + 0px))',
    })
  })

  it('r：贴右边中点，写的是 right 而不是 left', () => {
    expect(anchor9Css('r', 0, 0)).toEqual({
      position: 'absolute',
      right: '0',
      top: '50%',
      transform: 'translate(calc(110% + 0px), calc(-50% + 0px))',
    })
  })

  it('tl：横向只挪 20%，让两个上角的图元不互相顶开', () => {
    expect(anchor9Css('tl', 0, 0)).toEqual({
      position: 'absolute',
      left: '0',
      top: '0',
      transform: 'translate(calc(-20% + 0px), calc(-115% + 0px))',
    })
  })

  it('tr：贴右上角，横向推移与 tl 反号', () => {
    expect(anchor9Css('tr', 0, 0)).toEqual({
      position: 'absolute',
      right: '0',
      top: '0',
      transform: 'translate(calc(20% + 0px), calc(-115% + 0px))',
    })
  })

  it('bl：贴左下角', () => {
    expect(anchor9Css('bl', 0, 0)).toEqual({
      position: 'absolute',
      left: '0',
      bottom: '0',
      transform: 'translate(calc(-20% + 0px), calc(115% + 0px))',
    })
  })

  it('br：贴右下角', () => {
    expect(anchor9Css('br', 0, 0)).toEqual({
      position: 'absolute',
      right: '0',
      bottom: '0',
      transform: 'translate(calc(20% + 0px), calc(115% + 0px))',
    })
  })

  it('c：盒心，两轴各回半个自身尺寸、不往外推', () => {
    expect(anchor9Css('c', 0, 0)).toEqual({
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(calc(-50% + 0px), calc(-50% + 0px))',
    })
  })

  it('dx/dy 是像素微调，叠在百分比推移之上而不是替换它', () => {
    expect(anchor9Css('c', 4, -6).transform).toBe(
      'translate(calc(-50% + 4px), calc(-50% + -6px))',
    )
  })
})

describe('perimCss 法线推移', () => {
  it('上边中点：法线朝上，纵向整个推出一个身位', () => {
    expect(perimCss(perimAt(0.125), BOX_W, BOX_H)).toEqual({
      position: 'absolute',
      left: '50%',
      top: '0%',
      transform: 'translate(calc(-50% + 0px), calc(-100% + 0px))',
    })
  })

  it('右边中点：法线朝右，横向推移落到 0%（即整个在盒外）', () => {
    expect(perimCss(perimAt(0.375), BOX_W, BOX_H)).toEqual({
      position: 'absolute',
      left: '100%',
      top: '50%',
      transform: 'translate(calc(0% + 0px), calc(-50% + 0px))',
    })
  })

  it('下边中点：bottom 段反向参数化后仍落在边中点', () => {
    expect(perimCss(perimAt(0.625), BOX_W, BOX_H)).toEqual({
      position: 'absolute',
      left: '50%',
      top: '100%',
      transform: 'translate(calc(-50% + 0px), calc(0% + 0px))',
    })
  })

  it('左边中点：法线朝左', () => {
    expect(perimCss(perimAt(0.875), BOX_W, BOX_H)).toEqual({
      position: 'absolute',
      left: '0%',
      top: '50%',
      transform: 'translate(calc(-100% + 0px), calc(-50% + 0px))',
    })
  })

  it('左上角：两轴都走 45° 法线', () => {
    expect(perimCss(perimAt(0), BOX_W, BOX_H)).toEqual({
      position: 'absolute',
      left: '0%',
      top: '0%',
      transform: `translate(calc(${DIAG_FAR} + 0px), calc(${DIAG_FAR} + 0px))`,
    })
  })

  it('右上角：横向朝外、纵向朝上', () => {
    expect(perimCss(perimAt(0.25), BOX_W, BOX_H)).toEqual({
      position: 'absolute',
      left: '100%',
      top: '0%',
      transform: `translate(calc(${DIAG_NEAR} + 0px), calc(${DIAG_FAR} + 0px))`,
    })
  })

  it('右下角：两轴都朝外', () => {
    expect(perimCss(perimAt(0.5), BOX_W, BOX_H)).toEqual({
      position: 'absolute',
      left: '100%',
      top: '100%',
      transform: `translate(calc(${DIAG_NEAR} + 0px), calc(${DIAG_NEAR} + 0px))`,
    })
  })

  it('左下角：横向朝左、纵向朝下', () => {
    expect(perimCss(perimAt(0.75), BOX_W, BOX_H)).toEqual({
      position: 'absolute',
      left: '0%',
      top: '100%',
      transform: `translate(calc(${DIAG_FAR} + 0px), calc(${DIAG_NEAR} + 0px))`,
    })
  })

  it('角点的推移量比边上小 √2 倍：合并成一套数学就会让角上的图元外飘', () => {
    const corner = Math.abs(-50 - Number.parseFloat(DIAG_FAR))
    expect(corner * Math.SQRT2).toBeCloseTo(50, 10)
    expect(
      Math.abs(-50 - Number.parseFloat(DIAG_NEAR)) * Math.SQRT2,
    ).toBeCloseTo(50, 10)
  })

  it('gap 沿法线推像素，dx/dy 再叠上去', () => {
    const style = perimCss(
      { kind: 'perim', t: 0.375, gap: 8, dx: 2, dy: -3 },
      BOX_W,
      BOX_H,
    )
    expect(style.transform).toBe(
      'translate(calc(0% + 10px), calc(-50% + -3px))',
    )
  })

  it('角点上的 gap 同样走 45° 法线，两轴各只推 gap/√2', () => {
    const style = perimCss(
      { kind: 'perim', t: 0, gap: 10, dx: 0, dy: 0 },
      BOX_W,
      BOX_H,
    )
    expect(style.transform).toBe(
      `translate(calc(${DIAG_FAR} + -7.0710678118654755px), ` +
        `calc(${DIAG_FAR} + -7.0710678118654755px))`,
    )
  })

  it('盒宽高为 0 时按 1 兜底，不产出 NaN% 这种整条声明失效的值', () => {
    const style = perimCss(perimAt(0.125), 0, 0)
    expect(style.left).toBe('50%')
    expect(style.top).toBe('0%')
  })
})

describe('placementCss 五档分发', () => {
  it('flow：不产任何定位样式，图元留在父级的流里', () => {
    expect(placementCss({ kind: 'flow' }, BOX_W, BOX_H)).toEqual({})
  })

  it('fill：四值按 top/right/bottom/left 的文档序拼成 inset 简写', () => {
    expect(
      placementCss({ kind: 'fill', inset: [0, 0, 0, 0] }, BOX_W, BOX_H),
    ).toEqual({ position: 'absolute', inset: '0px 0px 0px 0px' })
  })

  it('fill：四形态混着写也逐项原样落进简写', () => {
    expect(
      placementCss(
        { kind: 'fill', inset: [0, '14%', '1.5em', 'auto'] },
        BOX_W,
        BOX_H,
      ),
    ).toEqual({ position: 'absolute', inset: '0px 14% 1.5em auto' })
  })

  it('abs：半边档只写给了的那一边，另一边不出现在样式里', () => {
    expect(
      placementCss(
        {
          kind: 'abs',
          left: 12,
          right: null,
          top: '50%',
          bottom: null,
          tx: '0',
          ty: '-50%',
        },
        BOX_W,
        BOX_H,
      ),
    ).toEqual({
      position: 'absolute',
      left: '12px',
      top: '50%',
      transform: 'translate(0, -50%)',
    })
  })

  it('abs：另外半边档写 right/bottom，tx/ty 是自身尺寸的位移', () => {
    expect(
      placementCss(
        {
          kind: 'abs',
          left: null,
          right: '10%',
          top: null,
          bottom: '2em',
          tx: '25%',
          ty: '4px',
        },
        BOX_W,
        BOX_H,
      ),
    ).toEqual({
      position: 'absolute',
      right: '10%',
      bottom: '2em',
      transform: 'translate(25%, 4px)',
    })
  })

  it('abs：tx/ty 里的 url() 被消毒成 0，外链打不出去', () => {
    const style = placementCss(
      {
        kind: 'abs',
        left: 0,
        right: null,
        top: 0,
        bottom: null,
        tx: 'url(http://evil.example/x)',
        ty: '0',
      },
      BOX_W,
      BOX_H,
    )
    expect(style.transform).toBe('translate(0, 0)')
  })

  it('anchor：分发到九档表，与直接调 anchor9Css 同结果', () => {
    expect(
      placementCss(
        { kind: 'anchor', anchor: 'tr', dx: 1, dy: 2 },
        BOX_W,
        BOX_H,
      ),
    ).toEqual(anchor9Css('tr', 1, 2))
  })

  it('perim：分发到法线推移，盒尺寸原样传下去', () => {
    expect(placementCss(perimAt(0.625), BOX_W, BOX_H)).toEqual(
      perimCss(perimAt(0.625), BOX_W, BOX_H),
    )
  })
})
