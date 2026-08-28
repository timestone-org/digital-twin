/**
 * @fileoverview 锁住出厂缩放那一道变换：哪些量跟着缩、哪些量一格不动。
 *
 * ⚠ 这一类错法全是静默的：把 0..1 的归一值（渐变坐标、周长参数、`radial` 的半径）
 * 当长度缩，画面上只表现为「底色变了」「引脚接在符号外面」；把倍数（`rootPatch.scale`、
 * 行高）当长度缩，表现为「手感不对」。一处都不会报错，只有逐项断言拦得住。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.13。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_PRESET_MIN_FONT_SIZE,
  twin2dScaleNodeStyle,
} from '../../src/presets/scale'
import type {
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dVariant,
} from '../../src/types'
import type {
  Twin2dBoxPrim,
  Twin2dIcoPrim,
  Twin2dPrim,
  Twin2dPrimBase,
  Twin2dPrimPatch,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../../src/typesPrim'

/** 取一半：所有期望值都能一眼算出来，也避开 0.75 的浮点尾巴 */
const HALF = 0.5

function baseOf(id: string): Twin2dPrimBase {
  return {
    id,
    at: { kind: 'flow' },
    size: { w: 40, h: 20 },
    minWidth: null,
    maxWidth: null,
    z: 0,
    opacity: 1,
    hidden: false,
    when: null,
    anim: null,
    transition: null,
    rotate: 0,
    scale: 1,
    transformOrigin: '50% 50%',
    pointerEvents: 'auto',
    keepUpright: false,
  }
}

function boxOf(id: string, children: readonly Twin2dPrim[]): Twin2dBoxPrim {
  return {
    ...baseOf(id),
    kind: 'box',
    layout: {
      flow: 'row',
      gap: 8,
      align: 'center',
      justify: 'start',
      wrap: false,
      pad: [2, 4, 6, 8],
    },
    fills: [],
    border: {
      width: 1.5,
      style: 'solid',
      color: 'red',
      sides: { top: true, right: true, bottom: true, left: true },
    },
    radius: 8,
    shadows: [],
    backdropBlur: 12,
    clip: false,
    cursor: 'default',
    children,
  }
}

function vecOf(id: string, coord: Twin2dVecPrim['coord']): Twin2dVecPrim {
  return {
    ...baseOf(id),
    kind: 'vec',
    coord,
    shape: { kind: 'rect', x: 10, y: 20, w: 30, h: 40, rx: 6 },
    fill: { kind: 'none' },
    strokes: [
      {
        id: 'ink',
        width: 1.2,
        color: 'red',
        dash: [6, 4],
        cap: 'butt',
        join: 'miter',
        opacity: 1,
        nonScaling: true,
      },
    ],
    gradients: [
      {
        kind: 'linear',
        id: 'grad',
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        stops: [{ id: 'a', color: 'red', at: 0.5 }],
      },
    ],
    stretch: true,
  }
}

function txtOf(id: string): Twin2dTxtPrim {
  return {
    ...baseOf(id),
    kind: 'txt',
    src: { kind: 'label' },
    font: { size: 32, letterSpacing: 0.5, weight: 600, color: 'red' },
    lineHeight: 1.55,
    align: 'start',
    baseline: 'auto',
    nowrap: false,
    ellipsis: false,
    titleAttr: false,
    shadows: [
      {
        id: 'glow',
        inset: false,
        x: 2,
        y: 4,
        blur: 6,
        spread: 8,
        color: 'red',
      },
    ],
    outline: { width: 3, color: 'red' },
  }
}

function icoOf(id: string): Twin2dIcoPrim {
  return {
    ...baseOf(id),
    kind: 'ico',
    src: {
      kind: 'draw',
      viewBox: [24, 24],
      parts: [
        {
          shape: { kind: 'line', x1: 0, y1: 0, x2: 24, y2: 24 },
          fill: { kind: 'none' },
          strokes: [],
        },
      ],
    },
    color: 'red',
  }
}

function styleOf(spec: {
  prims: readonly Twin2dPrim[]
  ports?: readonly Twin2dPort[]
  variants?: readonly Twin2dVariant[]
}): Twin2dNodeStyle {
  return {
    id: 'probe',
    name: '试件',
    category: 'probe',
    accent: 'red',
    defaultStatus: 'online',
    size: { w: 224, h: 126 },
    outline: { kind: 'round', r: 10 },
    prims: spec.prims,
    ports: spec.ports ?? [],
    slots: [],
    variants: spec.variants ?? [],
  }
}

function scaledPrim(prim: Twin2dPrim): Twin2dPrim {
  const [first] = twin2dScaleNodeStyle(styleOf({ prims: [prim] }), HALF).prims
  if (first === undefined) throw new Error('图元被整枝丢了')
  return first
}

function scaledBox(prim: Twin2dBoxPrim): Twin2dBoxPrim {
  const out = scaledPrim(prim)
  if (out.kind !== 'box') throw new Error('kind 被换掉了')
  return out
}

function scaledVec(prim: Twin2dVecPrim): Twin2dVecPrim {
  const out = scaledPrim(prim)
  if (out.kind !== 'vec') throw new Error('kind 被换掉了')
  return out
}

function scaledTxt(prim: Twin2dTxtPrim): Twin2dTxtPrim {
  const out = scaledPrim(prim)
  if (out.kind !== 'txt') throw new Error('kind 被换掉了')
  return out
}

function variantOf(patch: Twin2dPrimPatch): Twin2dVariant {
  return {
    id: 'probe-variant',
    when: { kind: 'state', state: 'hover' },
    patch: { vec: patch },
    rootPatch: {},
  }
}

// 一条只补丁一枚 vec 的变体缩完长什么样；vec 的坐标档由传进来的那一枚定
function scaledPatch(
  patch: Twin2dPrimPatch,
  coord: Twin2dVecPrim['coord'] = 'px',
): Twin2dPrimPatch {
  const style = styleOf({
    prims: [vecOf('vec', coord)],
    variants: [variantOf(patch)],
  })
  const [variant] = twin2dScaleNodeStyle(style, HALF).variants
  return variant?.patch['vec'] ?? {}
}

describe('样式那一层', () => {
  it('节点盒缩完取整——留了小数，归一化那一步会把它改回去', () => {
    const style = twin2dScaleNodeStyle(styleOf({ prims: [] }), 0.75)

    expect(style.size).toEqual({ w: 168, h: 95 })
  })

  it('缩到 0 的节点盒兜到 1：宽 0 的盒整块塌掉且不报错', () => {
    const style = twin2dScaleNodeStyle(styleOf({ prims: [] }), 0.001)

    expect(style.size).toEqual({ w: 1, h: 1 })
  })

  it('外缘半径跟着缩：不缩的话线头接在缩过的符号外面', () => {
    expect(twin2dScaleNodeStyle(styleOf({ prims: [] }), HALF).outline).toEqual({
      kind: 'round',
      r: 5,
    })
  })

  it('是纯函数：原样式一格不动', () => {
    const style = styleOf({ prims: [boxOf('frame', [txtOf('title')])] })
    const before = structuredClone(style)

    twin2dScaleNodeStyle(style, HALF)

    expect(style).toEqual(before)
  })
})

describe('长度与摆位', () => {
  it('裸数缩，百分比 / em / auto 三种串形一格不动', () => {
    const prim: Twin2dTxtPrim = {
      ...txtOf('t'),
      size: { w: '50%', h: 'auto' },
      minWidth: 18,
      maxWidth: '1em',
    }
    const out = scaledTxt(prim)

    expect(out.size).toEqual({ w: '50%', h: 'auto' })
    expect([out.minWidth, out.maxWidth]).toEqual([9, '1em'])
  })

  it('flow 一档没有长度，原样出', () => {
    expect(scaledTxt(txtOf('t')).at).toEqual({ kind: 'flow' })
  })

  it('fill 一档的四向内缩逐项过，串形那两项留着', () => {
    const prim: Twin2dTxtPrim = {
      ...txtOf('t'),
      at: { kind: 'fill', inset: [0, '14%', 8, 'auto'] },
    }

    expect(scaledTxt(prim).at).toEqual({
      kind: 'fill',
      inset: [0, '14%', 4, 'auto'],
    })
  })

  // ⚠ tx / ty 是相对自身尺寸的位移串，里面还夹着 calc 常量：缩它得再写一个 CSS 解析器
  it('abs 一档缩四边、不动 tx / ty', () => {
    const prim: Twin2dTxtPrim = {
      ...txtOf('t'),
      at: {
        kind: 'abs',
        left: '50%',
        right: null,
        top: null,
        bottom: -5,
        tx: '-50%',
        ty: 'calc(-100% - 4px)',
      },
    }

    expect(scaledTxt(prim).at).toEqual({
      kind: 'abs',
      left: '50%',
      right: null,
      top: null,
      bottom: -2.5,
      tx: '-50%',
      ty: 'calc(-100% - 4px)',
    })
  })

  it('anchor 一档缩两轴推移，档名不动', () => {
    const prim: Twin2dTxtPrim = {
      ...txtOf('t'),
      at: { kind: 'anchor', anchor: 't', dx: 6, dy: -8 },
    }

    expect(scaledTxt(prim).at).toEqual({
      kind: 'anchor',
      anchor: 't',
      dx: 3,
      dy: -4,
    })
  })

  // ⚠ t 是 0..1 的周长参数不是长度：缩了药丸会整体往左上角挪，而每个数看着都对
  it('perim 一档缩 gap 与两轴推移，周长参数 t 一格不动', () => {
    const prim: Twin2dTxtPrim = {
      ...txtOf('t'),
      at: { kind: 'perim', t: 0.625, gap: 10, dx: 4, dy: 2 },
    }

    expect(scaledTxt(prim).at).toEqual({
      kind: 'perim',
      t: 0.625,
      gap: 5,
      dx: 2,
      dy: 1,
    })
  })
})

describe('box 一档', () => {
  it('排布的 gap 与四向内边距跟着缩', () => {
    const out = scaledBox(boxOf('frame', []))

    expect(out.layout.gap).toBe(4)
    expect(out.layout.pad).toEqual([1, 2, 3, 4])
  })

  it('圆角三形：数缩、pill 是规则不是长度、四角分给的逐角缩', () => {
    const one = scaledBox(boxOf('a', [])).radius
    const pill = scaledBox({ ...boxOf('b', []), radius: 'pill' }).radius
    const four = scaledBox({
      ...boxOf('c', []),
      radius: [2, 4, 6, 8],
    }).radius

    expect([one, pill, four]).toEqual([4, 'pill', [1, 2, 3, 4]])
  })

  // ⚠ 缩到 1px 以下的边会渲成一条发虚的灰线，而取值看着仍然「小了一点点」
  it('边框线宽不缩', () => {
    expect(scaledBox(boxOf('frame', [])).border.width).toBe(1.5)
  })

  it('阴影四项与背景模糊跟着缩', () => {
    const prim: Twin2dBoxPrim = {
      ...boxOf('frame', []),
      shadows: [
        {
          id: 'glow',
          inset: true,
          x: 2,
          y: 4,
          blur: 16,
          spread: 8,
          color: 'red',
        },
      ],
    }
    const out = scaledBox(prim)

    expect(out.shadows).toEqual([
      { id: 'glow', inset: true, x: 1, y: 2, blur: 8, spread: 4, color: 'red' },
    ])
    expect(out.backdropBlur).toBe(6)
  })

  // ⚠ radial 的 cx/cy/r 与色标的 at 都是 0..1 归一值：跟着缩会让高光整个跑出形状外
  it('填充只有 repeat 一档带长度，另外四档一格不动', () => {
    const prim: Twin2dBoxPrim = {
      ...boxOf('frame', []),
      fills: [
        { kind: 'solid', id: 's', color: 'red', opacity: 1 },
        {
          kind: 'linear',
          id: 'l',
          angle: 150,
          stops: [{ id: 'a', color: 'red', at: 0.5 }],
          opacity: 1,
        },
        {
          kind: 'radial',
          id: 'r',
          cx: 0.25,
          cy: 0,
          r: 1,
          stops: [{ id: 'a', color: 'red', at: 0.54 }],
          opacity: 1,
        },
        {
          kind: 'repeat',
          id: 'p',
          angle: 90,
          color: 'red',
          width: 2,
          gap: 18,
          opacity: 1,
        },
        { kind: 'image', id: 'i', ref: 'asset:x', fit: 'cover', opacity: 1 },
      ],
    }
    const out = scaledBox(prim)

    expect(out.fills.slice(0, 3)).toEqual(prim.fills.slice(0, 3))
    expect(out.fills[3]).toEqual({ ...prim.fills[3], width: 1, gap: 9 })
    expect(out.fills[4]).toEqual(prim.fills[4])
  })

  it('整棵子树递归下去，不是只缩最外一层', () => {
    const out = scaledBox(boxOf('frame', [boxOf('body', [txtOf('title')])]))
    const body = out.children[0]
    const title = body?.kind === 'box' ? body.children[0] : undefined

    expect(body?.kind === 'box' ? body.layout.gap : null).toBe(4)
    expect(title?.kind === 'txt' ? title.font.size : null).toBe(16)
  })
})

describe('vec 一档', () => {
  it('px 档五种几何：四种逐数缩，path 的 d 是一段串故原样出', () => {
    const rect = scaledVec(vecOf('v', 'px')).shape
    const ellipse = scaledVec({
      ...vecOf('v', 'px'),
      shape: { kind: 'ellipse', cx: 10, cy: 63, rx: 10, ry: 63 },
    }).shape
    const line = scaledVec({
      ...vecOf('v', 'px'),
      shape: { kind: 'line', x1: 14, y1: 60, x2: 210, y2: 60 },
    }).shape
    const poly = scaledVec({
      ...vecOf('v', 'px'),
      shape: {
        kind: 'poly',
        points: [
          [8, 0],
          [8, 8],
        ],
        closed: false,
      },
    }).shape
    const path = scaledVec({
      ...vecOf('v', 'px'),
      shape: { kind: 'path', d: 'M0 0 L24 24' },
    }).shape

    expect(rect).toEqual({ kind: 'rect', x: 5, y: 10, w: 15, h: 20, rx: 3 })
    expect(ellipse).toEqual({
      kind: 'ellipse',
      cx: 5,
      cy: 31.5,
      rx: 5,
      ry: 31.5,
    })
    expect(line).toEqual({ kind: 'line', x1: 7, y1: 30, x2: 105, y2: 30 })
    expect(poly).toEqual({
      kind: 'poly',
      points: [
        [4, 0],
        [4, 4],
      ],
      closed: false,
    })
    expect(path).toEqual({ kind: 'path', d: 'M0 0 L24 24' })
  })

  // ⚠ unit 档乘的是实例盒尺寸，而盒已经缩过一遍了：再缩一次就是乘了两遍
  it('unit 档的几何一格不动', () => {
    expect(scaledVec(vecOf('v', 'unit')).shape).toEqual({
      kind: 'rect',
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      rx: 6,
    })
  })

  it('描边只缩虚线段长，线宽与 nonScaling 不动', () => {
    const [pass] = scaledVec(vecOf('v', 'px')).strokes

    expect([pass?.width, pass?.dash, pass?.nonScaling]).toEqual([
      1.2,
      [3, 2],
      true,
    ])
  })

  // ⚠ 局部渐变的坐标是对象包围盒的 0..1 归一值，跟着缩画面上只剩纯色
  it('局部渐变的坐标一格不动', () => {
    expect(scaledVec(vecOf('v', 'px')).gradients).toEqual(
      vecOf('v', 'px').gradients,
    )
  })
})

describe('ico 与 txt 两档', () => {
  // ⚠ draw 那一档自带 viewBox，是一套自洽坐标系：跟着缩是「图标在自己的框里缩成一团」
  it('ico 只缩基类那几项，draw 一档的 viewBox 与笔画一格不动', () => {
    const prim: Twin2dIcoPrim = { ...icoOf('i'), size: { w: 26, h: 26 } }
    const out = scaledPrim(prim)

    expect(out.size).toEqual({ w: 13, h: 13 })
    expect(out.kind === 'ico' ? out.src : null).toEqual(icoOf('i').src)
  })

  it('字号缩、字距缩，行高是倍数故不动，描边字的线宽同描边规矩不动', () => {
    const out = scaledTxt(txtOf('t'))

    expect(out.font.size).toBe(16)
    expect(out.font.letterSpacing).toBe(0.25)
    expect(out.lineHeight).toBe(1.55)
    expect(out.outline).toEqual({ width: 3, color: 'red' })
  })

  it('字号缩到地板为止，本就小于地板的原样留着', () => {
    const floored = scaledTxt({ ...txtOf('t'), font: { size: 15 } })
    const tiny = scaledTxt({ ...txtOf('t'), font: { size: 8 } })

    expect(floored.font.size).toBe(TWIN_2D_PRESET_MIN_FONT_SIZE)
    expect(tiny.font.size).toBe(8)
  })

  // ⚠ 缺席键是「跟随主题」：补一个数进去等于把主题里的字体钉死在这份预置上
  it('字体的缺席键不补', () => {
    const out = scaledTxt({ ...txtOf('t'), font: { color: 'red' } })

    expect(out.font).toEqual({ color: 'red' })
  })

  it('字晕跟着缩', () => {
    expect(scaledTxt(txtOf('t')).shadows).toEqual([
      {
        id: 'glow',
        inset: false,
        x: 1,
        y: 2,
        blur: 3,
        spread: 4,
        color: 'red',
      },
    ])
  })
})

describe('变体补丁', () => {
  it('缺席的键一个都不补出来', () => {
    expect(scaledPatch({ opacity: 0.5 })).toEqual({ opacity: 0.5 })
  })

  it('基类那四项：给了才缩，null 是「不设限」故留着', () => {
    const out = scaledPatch({
      at: { kind: 'anchor', anchor: 'b', dx: 4, dy: 4 },
      size: { w: 40, h: 'auto' },
      minWidth: 18,
      maxWidth: null,
    })

    expect(out).toEqual({
      at: { kind: 'anchor', anchor: 'b', dx: 2, dy: 2 },
      size: { w: 20, h: 'auto' },
      minWidth: 9,
      maxWidth: null,
    })
  })

  it('box 那五项：排布、填充、圆角、阴影与背景模糊', () => {
    const out = scaledPatch({
      layout: {
        flow: 'col',
        gap: 8,
        align: 'center',
        justify: 'center',
        wrap: false,
        pad: [2, 2, 2, 2],
      },
      fills: [
        {
          kind: 'repeat',
          id: 'p',
          angle: 90,
          color: 'red',
          width: 2,
          gap: 18,
          opacity: 1,
        },
      ],
      radius: 8,
      shadows: [
        {
          id: 'g',
          inset: false,
          x: 0,
          y: 8,
          blur: 18,
          spread: 0,
          color: 'red',
        },
      ],
      backdropBlur: 12,
    })

    expect(out.layout?.gap).toBe(4)
    expect(out.layout?.pad).toEqual([1, 1, 1, 1])
    expect(out.fills?.[0]).toEqual({
      kind: 'repeat',
      id: 'p',
      angle: 90,
      color: 'red',
      width: 1,
      gap: 9,
      opacity: 1,
    })
    expect([out.radius, out.backdropBlur]).toEqual([4, 6])
    expect(out.shadows?.[0]?.y).toBe(4)
  })

  it('描边补丁只缩虚线段长；字体补丁按字体那一套走', () => {
    const out = scaledPatch({
      strokes: [
        {
          id: 'ink',
          width: 2.5,
          color: 'red',
          dash: [8],
          cap: 'round',
          join: 'miter',
          opacity: 1,
          nonScaling: true,
        },
      ],
      font: { size: 30 },
    })

    expect([out.strokes?.[0]?.width, out.strokes?.[0]?.dash]).toEqual([
      2.5,
      [4],
    ])
    expect(out.font?.size).toBe(15)
  })

  // ⚠ 补丁按图元 id 寻址，几何缩不缩要回去问那一枚 vec 的坐标档：认错了档，
  //   要么整枝不缩、要么缩了两遍，而两种错法在方形盒上都看不出来
  it('几何补丁按被补丁那一枚的坐标档判缩不缩', () => {
    const shape = { kind: 'rect', x: 10, y: 0, w: 204, h: 126, rx: 0 } as const
    const onPx = scaledPatch({ shape }, 'px')
    const onUnit = scaledPatch({ shape }, 'unit')

    expect(onPx.shape).toEqual({
      kind: 'rect',
      x: 5,
      y: 0,
      w: 102,
      h: 63,
      rx: 0,
    })
    expect(onUnit.shape).toEqual(shape)
  })

  it('补丁自己声明了坐标档就以它为准', () => {
    const shape = { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 } as const
    const out = scaledPatch({ coord: 'unit', shape }, 'px')

    expect(out.shape).toEqual(shape)
  })

  // ⚠ rootPatch.scale 是 hover 的等比放大倍数不是长度：缩了它，「抬起来还变大」
  //   会变成「抬起来但缩了一点」，而每一项取值看着都对
  it('节点根覆盖只缩抬升与阴影，等比缩放倍数一格不动', () => {
    const style = styleOf({
      prims: [],
      variants: [
        {
          id: 'hover',
          when: { kind: 'state', state: 'hover' },
          patch: {},
          rootPatch: {
            lift: 3,
            scale: 1.025,
            z: 30,
            shadows: [
              {
                id: 'halo',
                inset: false,
                x: 0,
                y: 0,
                blur: 8,
                spread: 2,
                color: 'red',
              },
            ],
          },
        },
      ],
    })
    const [variant] = twin2dScaleNodeStyle(style, HALF).variants

    expect(variant?.rootPatch).toEqual({
      lift: 1.5,
      scale: 1.025,
      z: 30,
      shadows: [
        {
          id: 'halo',
          inset: false,
          x: 0,
          y: 0,
          blur: 4,
          spread: 1,
          color: 'red',
        },
      ],
    })
  })
})

describe('端口', () => {
  const port: Twin2dPort = {
    id: 'l',
    name: 'L',
    at: { kind: 'perim', t: 0.875 },
    dir: 'both',
    side: 'left',
    showName: false,
    marker: null,
  }

  // ⚠ 落点两档都是归一值：缩了引脚会整体往左上角挤，而连线照样接得上
  it('落点与无引脚符号的端口一格不动', () => {
    const xy: Twin2dPort = { ...port, at: { kind: 'xy', x: 0.5, y: 0.25 } }
    const out = twin2dScaleNodeStyle(
      styleOf({ prims: [], ports: [port, xy] }),
      HALF,
    )

    expect(out.ports[0]).toEqual(port)
    expect(out.ports[1]).toEqual(xy)
  })

  it('引脚符号的几何与伸出长度跟着缩，线宽不缩', () => {
    const withMarker: Twin2dPort = {
      ...port,
      marker: {
        shape: { kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 },
        strokes: [
          {
            id: 'ink',
            width: 1.4,
            color: 'red',
            dash: [],
            cap: 'butt',
            join: 'miter',
            opacity: 1,
            nonScaling: false,
          },
        ],
        fill: { kind: 'none' },
        length: 8,
      },
    }
    const out = twin2dScaleNodeStyle(
      styleOf({ prims: [], ports: [withMarker] }),
      HALF,
    )

    expect(out.ports[0]?.marker?.shape).toEqual({
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: 4,
      y2: 0,
    })
    expect(out.ports[0]?.marker?.length).toBe(4)
    expect(out.ports[0]?.marker?.strokes[0]?.width).toBe(1.4)
  })
})
