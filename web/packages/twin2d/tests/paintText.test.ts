/**
 * @fileoverview 锁住 txt / ico 的绘制契约：字体缺席键不产声明、`--font-digit` 挂
 * `.t2-digit`、阴影落 text-shadow 而不是 box-shadow、描边字带 paint-order；
 * 文本四档来源（slot 一档只走 formatSlotValue）与图标四来源；
 * 以及 `ico.color` 对 4 枚插画式 sprite 不生效、对另 7 枚生效这两档。
 */
import { describe, expect, it } from 'vitest'

import {
  isFixedColorSprite,
  paintIco,
  paintText,
  resolveIcoSrc,
  resolveTxtContent,
  txtTitleAttrs,
} from '../src/paintText'
import type { Twin2dPaintCtx } from '../src/paintCommon'
import type { Twin2dSlotRead, Twin2dTextCtx } from '../src/paintText'
import type { Twin2dNode } from '../src/types'
import type {
  Twin2dIcoPrim,
  Twin2dIcoSrc,
  Twin2dShadow,
  Twin2dTxtPrim,
} from '../src/typesPrim'
import type { FontValue } from '@dt/contracts'

const NODE: Twin2dNode = {
  id: 'n-7f3a',
  styleId: 's1',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  rotate: 0,
  flipX: false,
  flipY: false,
  label: '一号换热站',
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

const TXT: Twin2dTxtPrim = {
  id: 'title',
  kind: 'txt',
  at: { kind: 'flow' },
  size: { w: 'auto', h: 'auto' },
  minWidth: null,
  maxWidth: null,
  z: 1,
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
  src: { kind: 'label' },
  font: {},
  align: 'start',
  baseline: 'auto',
  nowrap: false,
  ellipsis: false,
  titleAttr: false,
  shadows: [],
  outline: null,
}

const ICO: Twin2dIcoPrim = {
  id: 'glyph',
  kind: 'ico',
  at: { kind: 'flow' },
  size: { w: 30, h: 30 },
  minWidth: null,
  maxWidth: null,
  z: 1,
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
  src: { kind: 'none' },
  color: 'currentColor',
}

const SHADOW: Twin2dShadow = {
  id: 'glow',
  inset: false,
  x: 0,
  y: 0,
  blur: 3,
  spread: 4,
  color: 'var(--t2-accent)',
}

function txt(patch: Partial<Twin2dTxtPrim>): Twin2dTxtPrim {
  return { ...TXT, ...patch }
}

function ico(src: Twin2dIcoSrc, color = 'var(--t2-accent)'): Twin2dIcoPrim {
  return { ...ICO, src, color }
}

function styleOf(patch: Partial<Twin2dTxtPrim>): Record<string, string> {
  return paintText(txt(patch), CTX).style
}

function fontStyle(font: FontValue): Record<string, string> {
  return styleOf({ font })
}

function textCtx(read: Twin2dSlotRead | null): Twin2dTextCtx {
  return { node: NODE, readSlot: () => read }
}

describe('paintText 的字体：缺席键跟随主题', () => {
  it('给了 size 没给 color 时只输出 font-size，其余四键一个声明都不产', () => {
    const style = fontStyle({ size: 18 })
    expect(style['font-size']).toBe('18px')
    expect(style['color']).toBeUndefined()
    expect(style['font-family']).toBeUndefined()
    expect(style['font-weight']).toBeUndefined()
    expect(style['letter-spacing']).toBeUndefined()
  })

  it('五键全给时逐项落成声明，字重的关键字形也照写', () => {
    const style = fontStyle({
      family: 'var(--font-display)',
      size: 32,
      weight: 600,
      letterSpacing: 0.5,
      color: 'var(--text-primary)',
    })
    expect(style).toMatchObject({
      'font-family': 'var(--font-display)',
      'font-size': '32px',
      'font-weight': '600',
      'letter-spacing': '0.5px',
      color: 'var(--text-primary)',
    })
    expect(fontStyle({ weight: 'bold' })['font-weight']).toBe('bold')
  })

  it('font 整个空对象时一条字体声明都不产', () => {
    const style = fontStyle({})
    expect(style['font-family']).toBeUndefined()
    expect(style['font-size']).toBeUndefined()
    expect(style['font-weight']).toBeUndefined()
    expect(style['letter-spacing']).toBeUndefined()
    expect(style['color']).toBeUndefined()
  })

  it('字体族与字色被消毒拒掉时回落成跟随主题，而不是原样注入', () => {
    const style = fontStyle({
      family: 'url(https://x.example/f.woff)',
      color: 'url(https://x.example/c)',
    })
    expect(style['font-family']).toBeUndefined()
    expect(style['color']).toBeUndefined()
  })
})

describe('paintText 的 .t2-digit：tabular-nums 由样式表配', () => {
  it('family 含 --font-digit 时挂 .t2-digit', () => {
    const out = paintText(txt({ font: { family: 'var(--font-digit)' } }), CTX)
    expect(out.classes).toContain('t2-digit')
  })

  it('family 不含 --font-digit 时不挂 .t2-digit', () => {
    const out = paintText(txt({ font: { family: 'var(--font-sans)' } }), CTX)
    expect(out.classes).not.toContain('t2-digit')
  })

  it('family 被消毒拒掉时连 .t2-digit 也不挂', () => {
    const out = paintText(
      txt({ font: { family: 'url(x) var(--font-digit)' } }),
      CTX,
    )
    expect(out.classes).not.toContain('t2-digit')
  })
})

describe('paintText 的排版四项', () => {
  it('align 三档逐档落到 text-align', () => {
    expect(styleOf({ align: 'start' })['text-align']).toBe('start')
    expect(styleOf({ align: 'center' })['text-align']).toBe('center')
    expect(styleOf({ align: 'end' })['text-align']).toBe('end')
  })

  it('baseline 落到 align-self；auto 一档不产声明，交给父级的 align', () => {
    expect(styleOf({ baseline: 'auto' })['align-self']).toBeUndefined()
    expect(styleOf({ baseline: 'baseline' })['align-self']).toBe('baseline')
    expect(styleOf({ baseline: 'center' })['align-self']).toBe('center')
  })

  it('nowrap 开才产 white-space，关时不产（免得压掉继承来的折行）', () => {
    expect(styleOf({ nowrap: true })['white-space']).toBe('nowrap')
    expect(styleOf({ nowrap: false })['white-space']).toBeUndefined()
  })

  it('ellipsis 开时 overflow 与 text-overflow 一起产，缺一个就不打点', () => {
    const on = styleOf({ ellipsis: true })
    expect(on['overflow']).toBe('hidden')
    expect(on['text-overflow']).toBe('ellipsis')
    const off = styleOf({ ellipsis: false })
    expect(off['overflow']).toBeUndefined()
    expect(off['text-overflow']).toBeUndefined()
  })
})

describe('paintText 的阴影：落 text-shadow 而不是 box-shadow', () => {
  it('阴影写进 text-shadow，box-shadow 一条都不产', () => {
    const style = styleOf({ shadows: [SHADOW] })
    expect(style['text-shadow']).toBe('0px 0px 3px var(--t2-accent)')
    expect(style['box-shadow']).toBeUndefined()
  })

  it('多条阴影逗号拼接，且逐条只取 x/y/blur/color', () => {
    const second: Twin2dShadow = { ...SHADOW, id: 'lift', x: 1, y: 2, blur: 6 }
    const style = styleOf({ shadows: [SHADOW, second] })
    expect(style['text-shadow']).toBe(
      '0px 0px 3px var(--t2-accent), 1px 2px 6px var(--t2-accent)',
    )
    expect(style['text-shadow']).not.toContain('inset')
  })

  it('阴影色被消毒拒掉时回落 currentColor，而不是让整条声明报废', () => {
    const dirty: Twin2dShadow = { ...SHADOW, color: 'url(https://x.example)' }
    expect(styleOf({ shadows: [dirty] })['text-shadow']).toBe(
      '0px 0px 3px currentColor',
    )
  })

  it('没有阴影时不产 text-shadow 声明', () => {
    expect(styleOf({ shadows: [] })['text-shadow']).toBeUndefined()
  })
})

describe('paintText 的描边字', () => {
  it('outline 产 paint-order 与 -webkit-text-stroke-*，少了 paint-order 字会变虚', () => {
    const style = styleOf({
      outline: { width: 3, color: 'var(--surface-base)' },
    })
    expect(style).toMatchObject({
      '-webkit-text-stroke-width': '3px',
      '-webkit-text-stroke-color': 'var(--surface-base)',
      'paint-order': 'stroke',
    })
  })

  it('outline 的颜色被消毒拒掉时回落 currentColor', () => {
    const style = styleOf({ outline: { width: 2, color: 'url(x)' } })
    expect(style['-webkit-text-stroke-color']).toBe('currentColor')
  })

  it('outline 为 null 时三条声明一条都不产', () => {
    const style = styleOf({ outline: null })
    expect(style['paint-order']).toBeUndefined()
    expect(style['-webkit-text-stroke-width']).toBeUndefined()
    expect(style['-webkit-text-stroke-color']).toBeUndefined()
  })
})

describe('paintText 与基类', () => {
  it('基类那几项照出，attrs 恒空（title 不走 attrs）', () => {
    const out = paintText(txt({ z: 4, opacity: 0.5 }), CTX)
    expect(out.style['z-index']).toBe('4')
    expect(out.style['opacity']).toBe('0.5')
    expect(out.style['pointer-events']).toBe('auto')
    expect(out.attrs).toEqual({})
  })

  it('hidden 的文本图元连字体与排版声明都不产', () => {
    const out = paintText(
      txt({ hidden: true, font: { size: 18 }, nowrap: true }),
      CTX,
    )
    expect(out.style).toEqual({})
    expect(out.classes).toEqual([])
  })
})

describe('txtTitleAttrs', () => {
  it('titleAttr 开且有文本时挂完整文本', () => {
    expect(txtTitleAttrs(txt({ titleAttr: true }), '一号换热站')).toEqual({
      title: '一号换热站',
    })
  })

  it('文本为空时不挂，免得 hover 出一个空气泡', () => {
    expect(txtTitleAttrs(txt({ titleAttr: true }), '')).toEqual({})
  })

  it('titleAttr 关时不挂', () => {
    expect(txtTitleAttrs(txt({ titleAttr: false }), '一号换热站')).toEqual({})
  })
})

describe('resolveTxtContent 的四档来源', () => {
  it('lit 一档原样出，首尾空白是排版的一部分', () => {
    expect(
      resolveTxtContent({ kind: 'lit', text: ' 输出 ' }, textCtx(null)),
    ).toBe(' 输出 ')
  })

  it('slot 一档走 formatSlotValue：精度与单位都由槽位口径决定', () => {
    const read: Twin2dSlotRead = {
      value: 63.44,
      slot: { precision: 1, unit: 'kW', enumMap: {}, placeholder: '' },
    }
    expect(
      resolveTxtContent({ kind: 'slot', slot: 'power' }, textCtx(read)),
    ).toBe('63.4 kW')
  })

  it('slot 一档的映射表优先于数值，说明格式化没有第二份实现', () => {
    const read: Twin2dSlotRead = {
      value: 1,
      slot: {
        precision: 0,
        unit: 'kW',
        enumMap: { '1': '运行' },
        placeholder: '',
      },
    }
    expect(
      resolveTxtContent({ kind: 'slot', slot: 'run' }, textCtx(read)),
    ).toBe('运行')
  })

  it('槽键悬空时回「—」而不是空串', () => {
    expect(
      resolveTxtContent({ kind: 'slot', slot: 'ghost' }, textCtx(null)),
    ).toBe('—')
  })

  it('label 一档出节点显示名；显示名为空就是空，不回落成 id', () => {
    expect(resolveTxtContent({ kind: 'label' }, textCtx(null))).toBe(
      '一号换热站',
    )
    const blank: Twin2dTextCtx = {
      node: { ...NODE, label: '' },
      readSlot: () => null,
    }
    expect(resolveTxtContent({ kind: 'label' }, blank)).toBe('')
  })

  it('id 一档出节点 id', () => {
    expect(resolveTxtContent({ kind: 'id' }, textCtx(null))).toBe('n-7f3a')
  })
})

describe('resolveIcoSrc 的四来源', () => {
  it('none 一档回空档', () => {
    expect(resolveIcoSrc({ kind: 'none' })).toEqual({ kind: 'none' })
  })

  it('name 一档带出 DtIcon 的注册名', () => {
    expect(resolveIcoSrc({ kind: 'name', name: 'gauge' })).toEqual({
      kind: 'name',
      name: 'gauge',
    })
  })

  it('sprite 一档带出 id 与「颜色写死没写死」的判定', () => {
    expect(resolveIcoSrc({ kind: 'sprite', id: 'ico-src-solar' })).toEqual({
      kind: 'sprite',
      id: 'ico-src-solar',
      fixedColor: true,
    })
    expect(resolveIcoSrc({ kind: 'sprite', id: 'ico-tap' })).toEqual({
      kind: 'sprite',
      id: 'ico-tap',
      fixedColor: false,
    })
  })

  it('asset 一档走注入的解析槽拿地址', () => {
    const out = resolveIcoSrc(
      { kind: 'asset', ref: 'asset:9f2' },
      (ref) => `https://oss.example/icons/${ref}`,
    )
    expect(out).toEqual({
      kind: 'asset',
      url: 'https://oss.example/icons/asset:9f2',
    })
  })

  it('解析槽未注入时落回空档：图标消失这件事由诊断说，不在这里造地址', () => {
    expect(resolveIcoSrc({ kind: 'asset', ref: 'asset:9f2' })).toEqual({
      kind: 'none',
    })
  })

  it('解析槽回空白串时同样落回空档', () => {
    expect(
      resolveIcoSrc({ kind: 'asset', ref: 'asset:9f2' }, () => '  '),
    ).toEqual({ kind: 'none' })
  })

  it('draw 一档带出 viewBox 与逐笔几何', () => {
    const src: Twin2dIcoSrc = {
      kind: 'draw',
      viewBox: [48, 48],
      parts: [
        {
          shape: { kind: 'line', x1: 0, y1: 0, x2: 48, y2: 48 },
          fill: { kind: 'none' },
          strokes: [],
        },
      ],
    }
    const out = resolveIcoSrc(src)
    expect(out).toEqual({ kind: 'draw', viewBox: [48, 48], parts: src.parts })
  })
})

describe('isFixedColorSprite：4 枚插画式图标', () => {
  it('4 枚能源源图标在名单里，另 7 枚不在', () => {
    expect(isFixedColorSprite('ico-src-waste-heat')).toBe(true)
    expect(isFixedColorSprite('ico-src-steam')).toBe(true)
    expect(isFixedColorSprite('ico-src-air-source')).toBe(true)
    expect(isFixedColorSprite('ico-src-solar')).toBe(true)
    expect(isFixedColorSprite('ico-vsl-tank')).toBe(false)
    expect(isFixedColorSprite('ico-hx')).toBe(false)
  })
})

describe('paintIco 的 color 分档', () => {
  it('name 与 draw 两档吃 currentColor，color 生效', () => {
    expect(
      paintIco(ico({ kind: 'name', name: 'gauge' }), CTX).style['color'],
    ).toBe('var(--t2-accent)')
    const draw = ico({ kind: 'draw', viewBox: [48, 48], parts: [] })
    expect(paintIco(draw, CTX).style['color']).toBe('var(--t2-accent)')
  })

  it('7 枚单色 sprite 上 color 生效', () => {
    const out = paintIco(ico({ kind: 'sprite', id: 'ico-term-ac' }), CTX)
    expect(out.style['color']).toBe('var(--t2-accent)')
  })

  it('4 枚插画式 sprite 上不产 color 声明：颜色是插画的一部分', () => {
    const out = paintIco(ico({ kind: 'sprite', id: 'ico-src-steam' }), CTX)
    expect(out.style['color']).toBeUndefined()
  })

  it('asset 一档不产 color：图片里的颜色拿不到 currentColor', () => {
    const out = paintIco(ico({ kind: 'asset', ref: 'asset:9f2' }), CTX)
    expect(out.style['color']).toBeUndefined()
  })

  it('none 一档不产 color', () => {
    expect(paintIco(ico({ kind: 'none' }), CTX).style['color']).toBeUndefined()
  })

  it('color 被消毒拒掉时回落 currentColor', () => {
    const dirty = ico({ kind: 'name', name: 'gauge' }, 'url(https://x.example)')
    expect(paintIco(dirty, CTX).style['color']).toBe('currentColor')
  })

  it('hidden 的图标图元不产任何样式', () => {
    const out = paintIco(
      { ...ico({ kind: 'name', name: 'gauge' }), hidden: true },
      CTX,
    )
    expect(out.style).toEqual({})
    expect(out.attrs).toEqual({})
  })

  it('基类那几项照出，attrs 恒空', () => {
    const out = paintIco({ ...ico({ kind: 'name', name: 'gauge' }), z: 2 }, CTX)
    expect(out.style['z-index']).toBe('2')
    expect(out.attrs).toEqual({})
  })
})
