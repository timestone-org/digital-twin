/**
 * @fileoverview 锁住 box 图元的绘制契约：排布六项逐档、多层填充的**叠序**（文档从下往上、
 * CSS 先写的在上面）、五种填充各自的 CSS 形状、四边可分关的边框、三形圆角、
 * inset 与外阴影混排、以及 §9.4 那三样恒定输出与 `minWidth` 的覆盖关系。
 */
import { describe, expect, it } from 'vitest'

import { paintBox } from '../src/paintBox'
import { TWIN_2D_BOX_CONSTANTS } from '../src/paintCommon'
import type { Twin2dPaintCtx } from '../src/paintCommon'
import type { Twin2dNode } from '../src/types'
import type {
  Twin2dAlign,
  Twin2dBackgroundFit,
  Twin2dJustify,
} from '../src/kinds'
import type {
  Twin2dBoxPrim,
  Twin2dFill,
  Twin2dGradientStop,
} from '../src/typesPrim'

const NODE: Twin2dNode = {
  id: 'n1',
  styleId: 's1',
  x: 100,
  y: 50,
  w: 200,
  h: 120,
  rotate: 0,
  flipX: false,
  flipY: false,
  label: '换热站',
  labelPos: 'bottom',
  status: '',
  accent: '',
  badge: '',
  badgeColor: '',
  badgeShape: 'round',
  tags: {},
  slots: [],
  layers: [],
  patch: {},
  ports: [],
}

const CTX: Twin2dPaintCtx = {
  node: NODE,
  boxW: 200,
  boxH: 120,
  idPrefix: 't2-1',
}

const BASE_PRIM: Twin2dBoxPrim = {
  id: 'frame',
  kind: 'box',
  at: { kind: 'flow' },
  size: { w: 34, h: 34 },
  minWidth: null,
  maxWidth: null,
  z: 2,
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
  layout: {
    flow: 'row',
    gap: 8,
    align: 'center',
    justify: 'start',
    wrap: false,
    pad: [6, 10, 6, 10],
  },
  fills: [],
  border: {
    width: 1.5,
    style: 'solid',
    color: 'var(--t2-accent)',
    sides: { top: true, right: true, bottom: true, left: true },
  },
  radius: 8,
  shadows: [],
  backdropBlur: 0,
  clip: false,
  cursor: 'default',
  children: [],
}

function prim(patch: Partial<Twin2dBoxPrim>): Twin2dBoxPrim {
  return { ...BASE_PRIM, ...patch }
}

function styleOf(patch: Partial<Twin2dBoxPrim>): Record<string, string> {
  return paintBox(prim(patch), CTX).style
}

function stop(id: string, color: string, at: number): Twin2dGradientStop {
  return { id, color, at }
}

const TWO_STOPS: readonly Twin2dGradientStop[] = [
  stop('a', 'var(--t2-fill-a)', 0),
  stop('b', 'var(--t2-fill-b)', 1),
]

function solidFill(id: string, color: string, opacity = 1): Twin2dFill {
  return { kind: 'solid', id, color, opacity }
}

describe('paintBox 的排布六项', () => {
  it('row 与 col 各自的 display 与主轴', () => {
    expect(styleOf({})['display']).toBe('flex')
    expect(styleOf({})['flex-direction']).toBe('row')
    const col = styleOf({ layout: { ...BASE_PRIM.layout, flow: 'col' } })
    expect(col['flex-direction']).toBe('column')
  })

  it('none 一档是居中的 grid，不产 align/justify/flex-wrap', () => {
    const style = styleOf({ layout: { ...BASE_PRIM.layout, flow: 'none' } })
    expect(style['display']).toBe('grid')
    expect(style['place-items']).toBe('center')
    expect(style['align-items']).toBeUndefined()
    expect(style['justify-content']).toBeUndefined()
    expect(style['flex-wrap']).toBeUndefined()
  })

  it('gap 与四元组 pad 按 t/r/b/l 的文档序直出', () => {
    const style = styleOf({})
    expect(style['gap']).toBe('8px')
    expect(style['padding']).toBe('6px 10px 6px 10px')
  })

  it('align 五档逐档落到 align-items', () => {
    const expected: Record<Twin2dAlign, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      baseline: 'baseline',
      stretch: 'stretch',
    }
    for (const [align, css] of Object.entries(expected)) {
      const style = styleOf({
        layout: { ...BASE_PRIM.layout, align: align as Twin2dAlign },
      })
      expect(style['align-items']).toBe(css)
    }
  })

  it('justify 五档逐档落到 justify-content', () => {
    const expected: Record<Twin2dJustify, string> = {
      start: 'flex-start',
      center: 'center',
      end: 'flex-end',
      between: 'space-between',
      around: 'space-around',
    }
    for (const [justify, css] of Object.entries(expected)) {
      const style = styleOf({
        layout: { ...BASE_PRIM.layout, justify: justify as Twin2dJustify },
      })
      expect(style['justify-content']).toBe(css)
    }
  })

  it('wrap 两档都产声明：不产的那一档会继承外层的折行', () => {
    expect(styleOf({})['flex-wrap']).toBe('nowrap')
    const wrapped = styleOf({ layout: { ...BASE_PRIM.layout, wrap: true } })
    expect(wrapped['flex-wrap']).toBe('wrap')
  })
})

describe('paintBox 的多层填充', () => {
  it('空 fills 一条 background 都不产，不是产空串', () => {
    expect('background' in styleOf({})).toBe(false)
  })

  it('多层的叠序反过来：文档从下往上，CSS 先写的在上面', () => {
    const style = styleOf({
      fills: [solidFill('bottom', '#001'), solidFill('top', '#fff')],
    })
    expect(style['background']).toBe(
      'linear-gradient(#fff, #fff), linear-gradient(#001, #001)',
    )
  })

  it('solid 写成渐变：简写里只有最后一层能是颜色', () => {
    expect(styleOf({ fills: [solidFill('s', '#001')] })['background']).toBe(
      'linear-gradient(#001, #001)',
    )
  })

  it('逐层 opacity 折进颜色，不另开一条 opacity 把子树一起变淡', () => {
    const style = styleOf({ fills: [solidFill('s', '#001', 0.45)] })
    const mixed = 'color-mix(in srgb, #001 45%, transparent)'
    expect(style['background']).toBe(`linear-gradient(${mixed}, ${mixed})`)
  })

  it('linear 出角度与色标位置', () => {
    const style = styleOf({
      fills: [
        { kind: 'linear', id: 'g', angle: 150, stops: TWO_STOPS, opacity: 1 },
      ],
    })
    expect(style['background']).toBe(
      'linear-gradient(150deg, var(--t2-fill-a) 0%, var(--t2-fill-b) 100%)',
    )
  })

  it('radial 用 ellipse 双百分比：circle 的显式半径只能是长度', () => {
    const style = styleOf({
      fills: [
        {
          kind: 'radial',
          id: 'g',
          cx: 0.25,
          cy: 0,
          r: 0.54,
          stops: TWO_STOPS,
          opacity: 1,
        },
      ],
    })
    expect(style['background']).toBe(
      'radial-gradient(ellipse 54% 54% at 25% 0%, var(--t2-fill-a) 0%, var(--t2-fill-b) 100%)',
    )
  })

  it('色标少于两个的渐变整层丢弃：留着它整条 background 连同别的层一起报废', () => {
    const oneStop = [stop('a', '#001', 0)]
    const linear = styleOf({
      fills: [
        solidFill('s', '#001'),
        { kind: 'linear', id: 'g', angle: 0, stops: oneStop, opacity: 1 },
      ],
    })
    expect(linear['background']).toBe('linear-gradient(#001, #001)')
    const radial = styleOf({
      fills: [
        {
          kind: 'radial',
          id: 'g',
          cx: 0.5,
          cy: 0.5,
          r: 0.5,
          stops: [],
          opacity: 1,
        },
      ],
    })
    expect('background' in radial).toBe(false)
  })

  it('repeat 的线宽是 gap 之后再加 width，管接头那一条逐值对得上', () => {
    const style = styleOf({
      fills: [
        {
          kind: 'repeat',
          id: 'r',
          angle: 90,
          color: 'var(--t2-accent)',
          width: 2,
          gap: 18,
          opacity: 1,
        },
      ],
    })
    expect(style['background']).toBe(
      'repeating-linear-gradient(90deg, transparent 0 18px, var(--t2-accent) 18px 20px)',
    )
  })

  it('image 四档铺法各出一套位置/尺寸/平铺', () => {
    const expected: Record<Twin2dBackgroundFit, string> = {
      cover: 'center center / cover no-repeat',
      contain: 'center center / contain no-repeat',
      stretch: 'center center / 100% 100% no-repeat',
      tile: 'left top / auto repeat',
    }
    for (const [fit, css] of Object.entries(expected)) {
      const style = styleOf({
        fills: [
          {
            kind: 'image',
            id: 'i',
            ref: 'https://cdn/a.png',
            fit: fit as Twin2dBackgroundFit,
            opacity: 1,
          },
        ],
      })
      expect(style['background']).toBe(`url("https://cdn/a.png") ${css}`)
    }
  })

  it('未解析的 asset: 与带引号括号的地址都整层丢弃，不发必 404 的请求', () => {
    const unresolved = styleOf({
      fills: [
        { kind: 'image', id: 'i', ref: 'asset:abc', fit: 'cover', opacity: 1 },
      ],
    })
    expect('background' in unresolved).toBe(false)
    const injected = styleOf({
      fills: [
        {
          kind: 'image',
          id: 'i',
          ref: 'https://cdn/a.png")　;x(',
          fit: 'cover',
          opacity: 1,
        },
      ],
    })
    expect('background' in injected).toBe(false)
  })
})

describe('paintBox 的边框', () => {
  it('四边全开走一条简写', () => {
    expect(styleOf({})['border']).toBe('1.5px solid var(--t2-accent)')
  })

  it('关掉的边不产声明：产 none 会把外层给的边框一起压掉', () => {
    const style = styleOf({
      border: {
        ...BASE_PRIM.border,
        sides: { top: true, right: false, bottom: true, left: false },
      },
    })
    expect(style['border']).toBeUndefined()
    expect(style['border-top']).toBe('1.5px solid var(--t2-accent)')
    expect(style['border-bottom']).toBe('1.5px solid var(--t2-accent)')
    expect('border-right' in style).toBe(false)
    expect('border-left' in style).toBe(false)
  })

  it('style: none 一条边框声明都不产', () => {
    const style = styleOf({ border: { ...BASE_PRIM.border, style: 'none' } })
    expect('border' in style).toBe(false)
    expect('border-top' in style).toBe(false)
  })

  it('边框色里的脏值被消毒回 currentColor 而不是原样注入', () => {
    const style = styleOf({
      border: { ...BASE_PRIM.border, color: 'url(http://x/a.png)' },
    })
    expect(style['border']).toBe('1.5px solid currentColor')
  })
})

describe('paintBox 的圆角三形', () => {
  it('一个数按设计像素', () => {
    expect(styleOf({})['border-radius']).toBe('8px')
  })

  it('pill 走语义 token 而不是一个魔数', () => {
    expect(styleOf({ radius: 'pill' })['border-radius']).toBe(
      'var(--radius-pill)',
    )
  })

  it('四元组按 CSS 的角序 tl/tr/br/bl', () => {
    expect(styleOf({ radius: [1, 2, 3, 4] })['border-radius']).toBe(
      '1px 2px 3px 4px',
    )
  })
})

describe('paintBox 的阴影', () => {
  it('空数组一条 box-shadow 都不产', () => {
    expect('box-shadow' in styleOf({})).toBe(false)
  })

  it('inset 与外阴影混排按文档序合成一条', () => {
    const style = styleOf({
      shadows: [
        {
          id: 'in',
          inset: true,
          x: 0,
          y: 0,
          blur: 14,
          spread: 0,
          color: 'rgba(0,0,0,.24)',
        },
        {
          id: 'out',
          inset: false,
          x: 0,
          y: 8,
          blur: 18,
          spread: 2,
          color: 'var(--t2-accent)',
        },
      ],
    })
    expect(style['box-shadow']).toBe(
      'inset 0px 0px 14px 0px rgba(0,0,0,.24), 0px 8px 18px 2px var(--t2-accent)',
    )
  })

  it('阴影色里的脏值被消毒回 currentColor', () => {
    const style = styleOf({
      shadows: [
        {
          id: 's',
          inset: false,
          x: 0,
          y: 0,
          blur: 8,
          spread: 0,
          color: '@import x',
        },
      ],
    })
    expect(style['box-shadow']).toBe('0px 0px 8px 0px currentColor')
  })
})

describe('paintBox 的模糊、裁剪与光标', () => {
  it('backdropBlur 只在正数时产声明', () => {
    expect(styleOf({ backdropBlur: 8 })['backdrop-filter']).toBe('blur(8px)')
    expect('backdrop-filter' in styleOf({})).toBe(false)
  })

  it('clip 为真才 overflow:hidden', () => {
    expect(styleOf({ clip: true })['overflow']).toBe('hidden')
    expect('overflow' in styleOf({})).toBe(false)
  })

  it('cursor 的 default 一档不产声明：产了会把可点节点的 pointer 压回箭头', () => {
    expect(styleOf({ cursor: 'help' })['cursor']).toBe('help')
    expect(styleOf({ cursor: 'pointer' })['cursor']).toBe('pointer')
    expect('cursor' in styleOf({})).toBe(false)
  })
})

describe('paintBox 与基类的关系', () => {
  it('§9.4 的三样恒定输出照搬 paintCommon，不在这里再写一遍', () => {
    const style = styleOf({})
    for (const [key, value] of Object.entries(TWIN_2D_BOX_CONSTANTS)) {
      expect(style[key]).toBe(value)
    }
  })

  it('显式给的 minWidth 盖得住恒定的 min-width:0，反过来写就是 188px 静默失效', () => {
    const style = styleOf({ minWidth: 188 })
    expect(style['min-width']).toBe('188px')
    expect(style['min-height']).toBe('0')
  })

  it('基类那几项原样带出来，不被 box 自己的声明顶掉', () => {
    const out = paintBox(
      prim({
        z: 10,
        opacity: 0.5,
        pointerEvents: 'none',
        anim: { kind: 'pulse', durationMs: 1200 },
      }),
      CTX,
    )
    expect(out.style['z-index']).toBe('10')
    expect(out.style['opacity']).toBe('0.5')
    expect(out.style['pointer-events']).toBe('none')
    expect(out.style['width']).toBe('34px')
    expect(out.classes).toEqual(['t2-anim-pulse'])
    expect(out.attrs).toEqual({})
  })

  it('hidden 的 box 一条样式都不产，连恒定三样也不产', () => {
    expect(paintBox(prim({ hidden: true, clip: true }), CTX)).toEqual({
      style: {},
      classes: [],
      attrs: {},
    })
  })
})
