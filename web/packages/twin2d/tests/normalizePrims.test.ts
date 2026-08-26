/**
 * @fileoverview 锁住图元一族的归一化口径：kind 认不出与缺 id 一律丢弃而不是降级、
 * 深度到顶截断成空数组、摆位五档与图标四来源各自的退路、以及浅补丁只收显式给出的键。
 * 这几条错了都不会报错——降级出来的空盒会占位、寻址不到的补丁「配了没反应」、
 * 名单外的 sprite 让图标静默消失。
 */
import { describe, expect, it } from 'vitest'

import {
  colorOr,
  normalizeAnim,
  normalizeBorder,
  normalizeDrawParts,
  normalizeFills,
  normalizeFont,
  normalizeGradients,
  normalizeIcoSrc,
  normalizeLayout,
  normalizeOutline,
  normalizePad,
  normalizePaint,
  normalizePlacement,
  normalizePrim,
  normalizePrimPatch,
  normalizePrims,
  normalizeRadius,
  normalizeShadows,
  normalizeShape,
  normalizeSize,
  normalizeStops,
  normalizeStrokes,
  normalizeTransition,
  normalizeTxtSrc,
  optionalLen,
  unitOr,
} from '../src/normalizePrims'
import type { Twin2dBoxPrim, Twin2dTxtPrim } from '../src/typesPrim'

const BOX = { id: 'root', kind: 'box' }

describe('normalizePrim', () => {
  it('不是对象的一条不成图元', () => {
    expect(normalizePrim(null, 0)).toBeNull()
    expect(normalizePrim([1], 0)).toBeNull()
  })

  it('kind 认不出整条丢弃，不许静默降级成 box', () => {
    expect(normalizePrim({ id: 'a', kind: 'gauge' }, 0)).toBeNull()
    expect(normalizePrim({ id: 'a' }, 0)).toBeNull()
  })

  it('缺 id 整条丢弃——补 id 会让所有补丁寻址不到它', () => {
    expect(normalizePrim({ kind: 'box' }, 0)).toBeNull()
    expect(normalizePrim({ id: '   ', kind: 'box' }, 0)).toBeNull()
  })

  it('数字 id 走 String() 化', () => {
    expect(normalizePrim({ id: 7, kind: 'box' }, 0)?.id).toBe('7')
  })

  it('公共十六项在没配任何东西时也各有一个值', () => {
    const prim = normalizePrim(BOX, 0)
    expect(prim).not.toBeNull()
    expect(prim).toMatchObject({
      at: { kind: 'flow' },
      size: { w: 'auto', h: 'auto' },
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
    })
  })

  it('十六项逐个可配，一个都不许在归一化里丢掉', () => {
    const prim = normalizePrim(
      {
        ...BOX,
        minWidth: 188,
        maxWidth: '80%',
        z: 4,
        opacity: 0.5,
        hidden: true,
        when: { kind: 'state', state: 'hover' },
        rotate: 30,
        scale: 1.08,
        transformOrigin: '50% 100%',
        pointerEvents: 'none',
        keepUpright: true,
      },
      0,
    )
    expect(prim).toMatchObject({
      minWidth: 188,
      maxWidth: '80%',
      z: 4,
      opacity: 0.5,
      hidden: true,
      when: { kind: 'state', state: 'hover' },
      rotate: 30,
      scale: 1.08,
      transformOrigin: '50% 100%',
      pointerEvents: 'none',
      keepUpright: true,
    })
  })

  it('opacity 夹到 0..1，非有限数回缺省', () => {
    expect(normalizePrim({ ...BOX, opacity: 4 }, 0)?.opacity).toBe(1)
    expect(normalizePrim({ ...BOX, opacity: -2 }, 0)?.opacity).toBe(0)
    expect(normalizePrim({ ...BOX, opacity: Number.NaN }, 0)?.opacity).toBe(1)
  })

  it('⚠ scale 走尺寸类正数：0 与负数回 1，0 会让整枝塌成一个点且一处不报错', () => {
    expect(normalizePrim({ ...BOX, scale: 0 }, 0)?.scale).toBe(1)
    expect(normalizePrim({ ...BOX, scale: -1.5 }, 0)?.scale).toBe(1)
    expect(normalizePrim({ ...BOX, scale: Number.NaN }, 0)?.scale).toBe(1)
    expect(normalizePrim({ ...BOX, scale: 0.5 }, 0)?.scale).toBe(0.5)
  })
})

describe('normalizePrims', () => {
  it('非数组收成空数组', () => {
    expect(normalizePrims(undefined, 0)).toEqual([])
    expect(normalizePrims({ id: 'a' }, 0)).toEqual([])
  })

  it('同层重复 id 只留第一条', () => {
    const prims = normalizePrims(
      [
        { id: 'a', kind: 'box' },
        { id: 'a', kind: 'txt' },
        { id: 'b', kind: 'txt' },
      ],
      0,
    )
    expect(prims.map((prim) => `${prim.id}:${prim.kind}`)).toEqual([
      'a:box',
      'b:txt',
    ])
  })

  it('深度到上限 6 一律归空数组，不抛错', () => {
    expect(normalizePrims([BOX], 6)).toEqual([])
    expect(normalizePrims([BOX], 7)).toEqual([])
    expect(normalizePrims([BOX], 5)).toHaveLength(1)
  })

  it('第 6 层的子树被截断，第 5 层还在', () => {
    const leaf = { id: 'l6', kind: 'box' }
    let node: Record<string, unknown> = { id: 'l5', kind: 'box' }
    node = { ...node, children: [leaf] }
    const prims = normalizePrims([node], 5)
    const fifth = prims[0]
    expect(fifth?.kind).toBe('box')
    expect((fifth as Twin2dBoxPrim).children).toEqual([])
  })

  it('子树逐层递归且各层自己去重', () => {
    const prims = normalizePrims(
      [
        {
          ...BOX,
          children: [
            { id: 'c1', kind: 'txt' },
            { id: 'c1', kind: 'ico' },
            { id: '', kind: 'txt' },
          ],
        },
      ],
      0,
    )
    const children = (prims[0] as Twin2dBoxPrim).children
    expect(children.map((child) => child.id)).toEqual(['c1'])
  })
})

describe('box 图元', () => {
  it('外观各项都有缺省', () => {
    const prim = normalizePrim(BOX, 0) as Twin2dBoxPrim
    expect(prim).toMatchObject({
      layout: {
        flow: 'row',
        gap: 0,
        align: 'start',
        justify: 'start',
        wrap: false,
        pad: [0, 0, 0, 0],
      },
      fills: [],
      radius: 0,
      shadows: [],
      backdropBlur: 0,
      clip: false,
      cursor: 'default',
      children: [],
    })
  })

  it('backdropBlur 负数回 0，cursor 走白名单', () => {
    const prim = normalizePrim(
      { ...BOX, backdropBlur: -3, cursor: 'crosshair' },
      0,
    ) as Twin2dBoxPrim
    expect(prim.backdropBlur).toBe(0)
    expect(prim.cursor).toBe('default')
    expect(
      (normalizePrim({ ...BOX, cursor: 'help' }, 0) as Twin2dBoxPrim).cursor,
    ).toBe('help')
  })
})

describe('vec 图元', () => {
  it('几何画不出来时落回整格矩形而不是丢掉整个图元', () => {
    const prim = normalizePrim({ id: 'v', kind: 'vec' }, 0)
    expect(prim).toMatchObject({
      id: 'v',
      coord: 'unit',
      shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rx: 0 },
      fill: { kind: 'none' },
      strokes: [],
      gradients: [],
      stretch: false,
    })
  })

  it('坐标口径与拉伸开关都可配', () => {
    const prim = normalizePrim(
      {
        id: 'v',
        kind: 'vec',
        coord: 'px',
        stretch: true,
        shape: { kind: 'line', x1: 1, y1: 2, x2: 3, y2: 4 },
      },
      0,
    )
    expect(prim).toMatchObject({
      coord: 'px',
      stretch: true,
      shape: { kind: 'line', x1: 1, y1: 2, x2: 3, y2: 4 },
    })
  })
})

describe('ico 图元', () => {
  it('缺省是空档 + currentColor', () => {
    expect(normalizePrim({ id: 'i', kind: 'ico' }, 0)).toMatchObject({
      src: { kind: 'none' },
      color: 'currentColor',
    })
  })

  it('颜色照收', () => {
    expect(
      normalizePrim({ id: 'i', kind: 'ico', color: ' var(--x) ' }, 0),
    ).toMatchObject({ color: 'var(--x)' })
  })
})

describe('txt 图元', () => {
  it('缺省是空字面量、跟随主题的字体与不描边', () => {
    const prim = normalizePrim({ id: 't', kind: 'txt' }, 0) as Twin2dTxtPrim
    expect(prim).toMatchObject({
      src: { kind: 'lit', text: '' },
      font: {},
      align: 'start',
      baseline: 'auto',
      nowrap: false,
      ellipsis: false,
      titleAttr: false,
      shadows: [],
      outline: null,
    })
  })

  it('排版开关与描边字都可配', () => {
    const prim = normalizePrim(
      {
        id: 't',
        kind: 'txt',
        align: 'center',
        baseline: 'center',
        nowrap: true,
        ellipsis: true,
        titleAttr: true,
        outline: { width: 2, color: 'red' },
      },
      0,
    ) as Twin2dTxtPrim
    expect(prim).toMatchObject({
      align: 'center',
      baseline: 'center',
      nowrap: true,
      ellipsis: true,
      titleAttr: true,
      outline: { width: 2, color: 'red' },
    })
  })
})

describe('normalizePlacement', () => {
  it('认不出一律回 flow', () => {
    expect(normalizePlacement(null)).toEqual({ kind: 'flow' })
    expect(normalizePlacement({ kind: 'sticky' })).toEqual({ kind: 'flow' })
    expect(normalizePlacement({ kind: 'flow' })).toEqual({ kind: 'flow' })
  })

  it('fill 的内缩四值缺席补 0', () => {
    expect(normalizePlacement({ kind: 'fill' })).toEqual({
      kind: 'fill',
      inset: [0, 0, 0, 0],
    })
    expect(
      normalizePlacement({ kind: 'fill', inset: [1, '2%', 'auto', '3em'] }),
    ).toEqual({ kind: 'fill', inset: [1, '2%', 'auto', '3em'] })
  })

  it('abs 的四边各自可缺席，位移串缺省 0', () => {
    expect(normalizePlacement({ kind: 'abs', left: 4, bottom: 'zz' })).toEqual({
      kind: 'abs',
      left: 4,
      right: null,
      top: null,
      bottom: null,
      tx: '0',
      ty: '0',
    })
    expect(
      normalizePlacement({ kind: 'abs', tx: '-50%', ty: '-115%' }),
    ).toMatchObject({ tx: '-50%', ty: '-115%' })
  })

  it('anchor 认不出的锚点回中心', () => {
    expect(normalizePlacement({ kind: 'anchor' })).toEqual({
      kind: 'anchor',
      anchor: 'c',
      dx: 0,
      dy: 0,
    })
    expect(
      normalizePlacement({ kind: 'anchor', anchor: 'tr', dx: 2, dy: -3 }),
    ).toEqual({ kind: 'anchor', anchor: 'tr', dx: 2, dy: -3 })
  })

  it('perim 的周长参数夹到 0..1', () => {
    expect(
      normalizePlacement({ kind: 'perim', t: 1.4, gap: 6, dx: 1, dy: 2 }),
    ).toEqual({ kind: 'perim', t: 1, gap: 6, dx: 1, dy: 2 })
    expect(normalizePlacement({ kind: 'perim' })).toEqual({
      kind: 'perim',
      t: 0,
      gap: 0,
      dx: 0,
      dy: 0,
    })
  })
})

describe('normalizeShape', () => {
  it('不是对象与认不出的 kind 都判非法', () => {
    expect(normalizeShape(null)).toBeNull()
    expect(normalizeShape({ kind: 'star' })).toBeNull()
  })

  it('path 的 d 为空就没有几何', () => {
    expect(normalizeShape({ kind: 'path', d: '  ' })).toBeNull()
    expect(normalizeShape({ kind: 'path', d: ' M0 0 ' })).toEqual({
      kind: 'path',
      d: 'M0 0',
    })
  })

  it('rect 宽高必须为正，圆角负数回 0', () => {
    expect(normalizeShape({ kind: 'rect', w: 0, h: 2 })).toBeNull()
    expect(normalizeShape({ kind: 'rect', w: 2, h: -1 })).toBeNull()
    expect(normalizeShape({ kind: 'rect', w: 2, h: 3, rx: -5 })).toEqual({
      kind: 'rect',
      x: 0,
      y: 0,
      w: 2,
      h: 3,
      rx: 0,
    })
  })

  it('ellipse 两个半径必须为正', () => {
    expect(normalizeShape({ kind: 'ellipse', rx: 1 })).toBeNull()
    expect(
      normalizeShape({ kind: 'ellipse', cx: 5, cy: 6, rx: 1, ry: 2 }),
    ).toEqual({ kind: 'ellipse', cx: 5, cy: 6, rx: 1, ry: 2 })
  })

  it('line 四个坐标缺席补 0', () => {
    expect(normalizeShape({ kind: 'line' })).toEqual({
      kind: 'line',
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
    })
  })

  it('poly 丢掉坐标取不到数的点，不足两点就不是一段几何', () => {
    expect(
      normalizeShape({ kind: 'poly', points: [[0, 0], [1, 'x'], 3] }),
    ).toBeNull()
    expect(
      normalizeShape({
        kind: 'poly',
        points: [
          [0, 0],
          [1, 'z'],
          [2, 3],
        ],
        closed: true,
      }),
    ).toEqual({
      kind: 'poly',
      points: [
        [0, 0],
        [2, 3],
      ],
      closed: true,
    })
  })
})

describe('填充与描边', () => {
  it('缺 id 或 kind 认不出的一层整条丢弃', () => {
    expect(normalizeFills([{ kind: 'solid' }, 3])).toEqual([])
    expect(normalizeFills([{ id: 'f', kind: 'mesh' }])).toEqual([])
    expect(normalizeFills('nope')).toEqual([])
  })

  it('五档填充各自的缺省', () => {
    expect(
      normalizeFills([
        { id: 'a', kind: 'solid' },
        { id: 'b', kind: 'linear' },
        { id: 'c', kind: 'radial' },
        { id: 'd', kind: 'repeat' },
        { id: 'e', kind: 'image', ref: 'asset:1' },
      ]),
    ).toEqual([
      { kind: 'solid', id: 'a', color: 'currentColor', opacity: 1 },
      { kind: 'linear', id: 'b', angle: 0, stops: [], opacity: 1 },
      {
        kind: 'radial',
        id: 'c',
        cx: 0.5,
        cy: 0.5,
        r: 0.5,
        stops: [],
        opacity: 1,
      },
      {
        kind: 'repeat',
        id: 'd',
        angle: 0,
        color: 'currentColor',
        width: 1,
        gap: 4,
        opacity: 1,
      },
      { kind: 'image', id: 'e', ref: 'asset:1', fit: 'cover', opacity: 1 },
    ])
  })

  it('底图没有 ref 就整层丢弃', () => {
    expect(normalizeFills([{ id: 'e', kind: 'image' }])).toEqual([])
  })

  it('条纹的线宽与缝隙必须为正', () => {
    expect(
      normalizeFills([{ id: 'd', kind: 'repeat', width: 0, gap: -2 }]),
    ).toMatchObject([{ width: 1, gap: 4 }])
  })

  it('同 id 的填充层只留第一条', () => {
    expect(
      normalizeFills([
        { id: 'a', kind: 'solid', color: 'red' },
        { id: 'a', kind: 'solid', color: 'blue' },
      ]),
    ).toMatchObject([{ color: 'red' }])
  })

  it('描边缺省成 1px currentColor 的实线', () => {
    expect(normalizeStrokes([{ id: 's' }])).toEqual([
      {
        id: 's',
        width: 1,
        color: 'currentColor',
        dash: [],
        cap: 'butt',
        join: 'miter',
        opacity: 1,
        nonScaling: false,
      },
    ])
  })

  it('线宽给 0 时落回 1——SVG 什么都不画只像画得难看', () => {
    expect(normalizeStrokes([{ id: 's', width: 0 }])).toMatchObject([
      { width: 1 },
    ])
  })

  it('虚线里非有限与负数的段长逐个丢弃', () => {
    expect(
      normalizeStrokes([{ id: 's', dash: [4, -1, 'x', 2, Number.NaN] }]),
    ).toMatchObject([{ dash: [4, 2] }])
  })

  it('非对象与缺 id 的描边遍丢弃', () => {
    expect(normalizeStrokes([null, { width: 2 }])).toEqual([])
  })
})

describe('阴影、色标与渐变', () => {
  it('阴影缺省全 0，模糊半径负数回 0', () => {
    expect(normalizeShadows([{ id: 'sh', blur: -4 }])).toEqual([
      {
        id: 'sh',
        inset: false,
        x: 0,
        y: 0,
        blur: 0,
        spread: 0,
        color: 'currentColor',
      },
    ])
  })

  it('阴影非对象与缺 id 的整条丢弃、同 id 只留第一条', () => {
    expect(normalizeShadows(['x', { inset: true }])).toEqual([])
    expect(
      normalizeShadows([
        { id: 'sh', x: 1 },
        { id: 'sh', x: 2 },
      ]),
    ).toMatchObject([{ x: 1 }])
  })

  it('色标的 at 夹到 0..1，非对象与缺 id 丢弃', () => {
    expect(normalizeStops([{ id: 'p', at: 3 }, 7, { at: 0.5 }])).toEqual([
      { id: 'p', color: 'currentColor', at: 1 },
    ])
  })

  it('渐变两档各自的缺省', () => {
    expect(
      normalizeGradients([
        { id: 'g1', kind: 'linear' },
        { id: 'g2', kind: 'radial' },
      ]),
    ).toEqual([
      { kind: 'linear', id: 'g1', x1: 0, y1: 0, x2: 1, y2: 0, stops: [] },
      {
        kind: 'radial',
        id: 'g2',
        cx: 0.5,
        cy: 0.5,
        r: 0.5,
        fx: 0.5,
        fy: 0.5,
        stops: [],
      },
    ])
  })

  it('渐变非对象、缺 id、kind 认不出都丢弃', () => {
    expect(normalizeGradients([1, { kind: 'linear' }, { id: 'g' }])).toEqual([])
  })

  it('SVG 上色三档，引不到的渐变退回不上色', () => {
    expect(normalizePaint(null)).toEqual({ kind: 'none' })
    expect(normalizePaint({ kind: 'conic' })).toEqual({ kind: 'none' })
    expect(normalizePaint({ kind: 'gradient' })).toEqual({ kind: 'none' })
    expect(normalizePaint({ kind: 'gradient', id: 'g1' })).toEqual({
      kind: 'gradient',
      id: 'g1',
    })
    expect(normalizePaint({ kind: 'color' })).toEqual({
      kind: 'color',
      color: 'currentColor',
    })
  })
})

describe('盒零件', () => {
  it('布局走白名单，间距负数回 0', () => {
    expect(normalizeLayout(null)).toEqual({
      flow: 'row',
      gap: 0,
      align: 'start',
      justify: 'start',
      wrap: false,
      pad: [0, 0, 0, 0],
    })
    expect(
      normalizeLayout({
        flow: 'col',
        gap: -8,
        align: 'center',
        justify: 'between',
        wrap: true,
        pad: [1, 2, 3, 4],
      }),
    ).toEqual({
      flow: 'col',
      gap: 0,
      align: 'center',
      justify: 'between',
      wrap: true,
      pad: [1, 2, 3, 4],
    })
  })

  it('内边距长度不是 4 一律整条回缺省，取不到数的一格回 0', () => {
    expect(normalizePad([1, 2, 3])).toEqual([0, 0, 0, 0])
    expect(normalizePad('x')).toEqual([0, 0, 0, 0])
    expect(normalizePad([-1, 'x', 2, 3])).toEqual([0, 0, 2, 3])
  })

  it('边框缺省四边全画、宽度 0', () => {
    expect(normalizeBorder(undefined)).toEqual({
      width: 0,
      style: 'solid',
      color: 'currentColor',
      sides: { top: true, right: true, bottom: true, left: true },
    })
  })

  it('边框的宽度负数回 0，线型走白名单，单边可关', () => {
    expect(
      normalizeBorder({
        width: -2,
        style: 'groove',
        color: ' red ',
        sides: { top: false },
      }),
    ).toEqual({
      width: 0,
      style: 'solid',
      color: 'red',
      sides: { top: false, right: true, bottom: true, left: true },
    })
  })

  it('圆角三形', () => {
    expect(normalizeRadius('pill')).toBe('pill')
    expect(normalizeRadius([1, 2, 3, -4])).toEqual([1, 2, 3, 0])
    expect(normalizeRadius(6)).toBe(6)
    expect(normalizeRadius(-6)).toBe(0)
    expect(normalizeRadius([1, 2, 3])).toBe(0)
    expect(normalizeRadius('big')).toBe(0)
  })

  it('尺寸缺席即 auto', () => {
    expect(normalizeSize(null)).toEqual({ w: 'auto', h: 'auto' })
    expect(normalizeSize({ w: 24, h: '50%' })).toEqual({ w: 24, h: '50%' })
  })

  it('可缺席长度只认四种口径', () => {
    expect(optionalLen(12)).toBe(12)
    expect(optionalLen(Number.NaN)).toBeNull()
    expect(optionalLen(' 50% ')).toBe('50%')
    expect(optionalLen('2em')).toBe('2em')
    expect(optionalLen('auto')).toBe('auto')
    expect(optionalLen('12')).toBe(12)
    expect(optionalLen('12px')).toBeNull()
    expect(optionalLen(undefined)).toBeNull()
  })

  it('比例夹取与颜色回落', () => {
    expect(unitOr('0.4', 1)).toBe(0.4)
    expect(unitOr(9, 1)).toBe(1)
    expect(unitOr(null, 0.3)).toBe(0.3)
    expect(colorOr('  ')).toBe('currentColor')
    expect(colorOr(' #fff ')).toBe('#fff')
  })
})

describe('normalizeFont', () => {
  it('不是对象时一个键都不写，缺席即跟随主题', () => {
    expect(normalizeFont(null)).toEqual({})
    expect('size' in normalizeFont({})).toBe(false)
  })

  it('五个键逐个可配，字重收关键字也收数字', () => {
    expect(
      normalizeFont({
        family: ' Inter ',
        size: 14,
        weight: ' bold ',
        letterSpacing: 0,
        color: '#fff',
      }),
    ).toEqual({
      family: 'Inter',
      size: 14,
      weight: 'bold',
      letterSpacing: 0,
      color: '#fff',
    })
    expect(normalizeFont({ weight: 600 })).toEqual({ weight: 600 })
  })

  it('取不到数或非正的字号不写出来，空串键也不写', () => {
    expect(normalizeFont({ size: 0 })).toEqual({})
    expect(normalizeFont({ size: 'x' })).toEqual({})
    expect(normalizeFont({ family: '  ', color: '', weight: '  ' })).toEqual({})
    expect(normalizeFont({ letterSpacing: 'x', weight: null })).toEqual({})
  })
})

describe('动画与过渡', () => {
  it('不是对象就是没配', () => {
    expect(normalizeAnim(null)).toBeNull()
    expect(normalizeTransition('x')).toBeNull()
  })

  it('动画认不出的档回 none，时长非正回缺省', () => {
    expect(normalizeAnim({ kind: 'spin', durationMs: 0 })).toEqual({
      kind: 'none',
      durationMs: 1000,
    })
    expect(normalizeAnim({ kind: 'pulse', durationMs: 600 })).toEqual({
      kind: 'pulse',
      durationMs: 600,
    })
  })

  it('过渡属性只收闭合六档，全丢光就是没配过渡', () => {
    expect(normalizeTransition({ props: ['width', 'color'] })).toBeNull()
    expect(normalizeTransition({})).toBeNull()
    expect(
      normalizeTransition({ props: ['opacity', 'opacity', 'left'] }),
    ).toEqual({ props: ['opacity'], durationMs: 180, easing: 'ease' })
  })

  it('过渡时长与缓动可配', () => {
    expect(
      normalizeTransition({
        props: ['transform'],
        durationMs: 240,
        easing: ' linear ',
      }),
    ).toEqual({ props: ['transform'], durationMs: 240, easing: 'linear' })
  })

  it('描边字不是对象就是不描边', () => {
    expect(normalizeOutline(null)).toBeNull()
    expect(normalizeOutline({})).toEqual({ width: 1, color: 'currentColor' })
  })
})

describe('图标四来源', () => {
  it('不是对象与认不出的 kind 都回空档', () => {
    expect(normalizeIcoSrc(null)).toEqual({ kind: 'none' })
    expect(normalizeIcoSrc({ kind: 'emoji' })).toEqual({ kind: 'none' })
    expect(normalizeIcoSrc({ kind: 'none' })).toEqual({ kind: 'none' })
  })

  it('name 与 asset 取不到值时回空档', () => {
    expect(normalizeIcoSrc({ kind: 'name', name: '  ' })).toEqual({
      kind: 'none',
    })
    expect(normalizeIcoSrc({ kind: 'name', name: ' zap ' })).toEqual({
      kind: 'name',
      name: 'zap',
    })
    expect(normalizeIcoSrc({ kind: 'asset' })).toEqual({ kind: 'none' })
    expect(normalizeIcoSrc({ kind: 'asset', ref: 'asset:9' })).toEqual({
      kind: 'asset',
      ref: 'asset:9',
    })
  })

  it('sprite 的 id 必须在内置名单里，名单外的静默消失所以退空档', () => {
    expect(normalizeIcoSrc({ kind: 'sprite', id: 'ico-nope' })).toEqual({
      kind: 'none',
    })
    expect(normalizeIcoSrc({ kind: 'sprite', id: 'ico-hx' })).toEqual({
      kind: 'sprite',
      id: 'ico-hx',
    })
  })

  it('draw 一笔都没有就回空档，viewBox 缺省 48', () => {
    expect(normalizeIcoSrc({ kind: 'draw', parts: [] })).toEqual({
      kind: 'none',
    })
    expect(
      normalizeIcoSrc({
        kind: 'draw',
        parts: [{ shape: { kind: 'path', d: 'M0 0' } }],
      }),
    ).toEqual({
      kind: 'draw',
      viewBox: [48, 48],
      parts: [
        {
          shape: { kind: 'path', d: 'M0 0' },
          fill: { kind: 'none' },
          strokes: [],
        },
      ],
    })
  })

  it('draw 的 viewBox 非正回缺省', () => {
    expect(
      normalizeIcoSrc({
        kind: 'draw',
        viewBox: [240, 0],
        parts: [{ shape: { kind: 'path', d: 'M0 0' } }],
      }),
    ).toMatchObject({ viewBox: [240, 48] })
  })

  it('画不出几何的一笔整条丢弃，其余照留', () => {
    expect(
      normalizeDrawParts([
        null,
        { shape: { kind: 'rect', w: 0, h: 1 } },
        { shape: { kind: 'line' }, fill: { kind: 'color', color: 'red' } },
      ]),
    ).toEqual([
      {
        shape: { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0 },
        fill: { kind: 'color', color: 'red' },
        strokes: [],
      },
    ])
  })
})

describe('文本五来源', () => {
  it('不是对象与认不出的 kind 都退成空字面量', () => {
    expect(normalizeTxtSrc(null)).toEqual({ kind: 'lit', text: '' })
    expect(normalizeTxtSrc({ kind: 'html' })).toEqual({ kind: 'lit', text: '' })
  })

  it('字面量原样保留首尾空白，非字符串收成空串', () => {
    expect(normalizeTxtSrc({ kind: 'lit', text: ' kWh ' })).toEqual({
      kind: 'lit',
      text: ' kWh ',
    })
    expect(normalizeTxtSrc({ kind: 'lit', text: 5 })).toEqual({
      kind: 'lit',
      text: '',
    })
  })

  it('取不到槽键的 slot 退成空字面量', () => {
    expect(normalizeTxtSrc({ kind: 'slot', slot: ' ' })).toEqual({
      kind: 'lit',
      text: '',
    })
    expect(normalizeTxtSrc({ kind: 'slot', slot: ' power ' })).toEqual({
      kind: 'slot',
      slot: 'power',
    })
  })

  it('label / id / badge 三档没有别的字段', () => {
    expect(normalizeTxtSrc({ kind: 'label' })).toEqual({ kind: 'label' })
    expect(normalizeTxtSrc({ kind: 'id' })).toEqual({ kind: 'id' })
    expect(normalizeTxtSrc({ kind: 'badge' })).toEqual({ kind: 'badge' })
  })
})

describe('normalizePrimPatch', () => {
  it('不是对象就是一份空补丁', () => {
    expect(normalizePrimPatch(null)).toEqual({})
  })

  it('没给的键一个都不许补出来', () => {
    const patch = normalizePrimPatch({ hidden: true })
    expect(patch).toEqual({ hidden: true })
    expect('opacity' in patch).toBe(false)
    expect('at' in patch).toBe(false)
  })

  it('位姿一组逐键收，显式的空值也算给过', () => {
    expect(
      normalizePrimPatch({
        at: { kind: 'anchor', anchor: 't' },
        size: { w: 10 },
        minWidth: 188,
        maxWidth: 'nope',
        z: 3,
        opacity: 2,
        rotate: -90,
        scale: 1.04,
        hidden: false,
      }),
    ).toEqual({
      at: { kind: 'anchor', anchor: 't', dx: 0, dy: 0 },
      size: { w: 10, h: 'auto' },
      minWidth: 188,
      maxWidth: null,
      z: 3,
      opacity: 1,
      rotate: -90,
      scale: 1.04,
      hidden: false,
    })
  })

  it('⚠ 补丁里的 scale 同样挡 0 与负数，落回缺省 1 而不是把这一键丢掉', () => {
    expect(normalizePrimPatch({ scale: 0 })).toEqual({ scale: 1 })
    expect(normalizePrimPatch({ scale: -2 })).toEqual({ scale: 1 })
    expect('scale' in normalizePrimPatch({ rotate: 3 })).toBe(false)
  })

  it('条件与动效一组逐键收', () => {
    expect(
      normalizePrimPatch({
        when: { kind: 'state', state: 'alarm' },
        anim: { kind: 'blink' },
        transition: { props: ['filter'] },
        transformOrigin: ' ',
        pointerEvents: 'none',
        keepUpright: true,
      }),
    ).toEqual({
      when: { kind: 'state', state: 'alarm' },
      anim: { kind: 'blink', durationMs: 1000 },
      transition: { props: ['filter'], durationMs: 180, easing: 'ease' },
      transformOrigin: '50% 50%',
      pointerEvents: 'none',
      keepUpright: true,
    })
  })

  it('盒外观一组逐键收', () => {
    const patch = normalizePrimPatch({
      layout: { flow: 'none' },
      fills: [{ id: 'f', kind: 'solid', color: 'red' }],
      border: { width: 2 },
      radius: 'pill',
      shadows: [{ id: 'sh' }],
      backdropBlur: -1,
      clip: true,
      cursor: 'pointer',
    })
    expect(patch).toMatchObject({
      radius: 'pill',
      backdropBlur: 0,
      clip: true,
      cursor: 'pointer',
    })
    expect(patch.layout?.flow).toBe('none')
    expect(patch.fills).toHaveLength(1)
    expect(patch.border?.width).toBe(2)
    expect(patch.shadows).toHaveLength(1)
  })

  it('矢量一组逐键收，几何画不出来时当这一键没给过', () => {
    const patch = normalizePrimPatch({
      coord: 'px',
      shape: { kind: 'rect', w: 0, h: 1 },
      fill: { kind: 'color', color: 'red' },
      strokes: [{ id: 's', width: 3 }],
      gradients: [{ id: 'g', kind: 'linear' }],
      stretch: true,
    })
    expect('shape' in patch).toBe(false)
    expect(patch).toMatchObject({
      coord: 'px',
      fill: { kind: 'color', color: 'red' },
      stretch: true,
    })
    expect(patch.strokes).toHaveLength(1)
    expect(patch.gradients).toHaveLength(1)
  })

  it('几何合法时 shape 照收', () => {
    expect(normalizePrimPatch({ shape: { kind: 'line' } })).toEqual({
      shape: { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0 },
    })
  })

  it('文本一组逐键收', () => {
    expect(
      normalizePrimPatch({
        color: 'red',
        font: { size: 12 },
        align: 'end',
        baseline: 'baseline',
        nowrap: true,
        ellipsis: true,
        titleAttr: true,
        outline: null,
      }),
    ).toEqual({
      color: 'red',
      font: { size: 12 },
      align: 'end',
      baseline: 'baseline',
      nowrap: true,
      ellipsis: true,
      titleAttr: true,
      outline: null,
    })
  })

  it('src 按 kind 落在哪张名单里判是图标还是文本', () => {
    expect(normalizePrimPatch({ src: { kind: 'label' } })).toEqual({
      src: { kind: 'label' },
    })
    expect(
      normalizePrimPatch({ src: { kind: 'sprite', id: 'ico-tap' } }),
    ).toEqual({ src: { kind: 'sprite', id: 'ico-tap' } })
  })

  it('两张名单都认不出的 src 当这一键没给过', () => {
    expect('src' in normalizePrimPatch({ src: { kind: 'video' } })).toBe(false)
    expect('src' in normalizePrimPatch({ src: 'label' })).toBe(false)
  })
})

describe('txt 的行高', () => {
  /** 只取行高那一格，缺席时就是生产缺省 */
  function lineHeightOf(raw: unknown): number | null {
    const prim = normalizePrim({ id: 't', kind: 'txt', lineHeight: raw }, 0)
    if (prim === null || prim.kind !== 'txt') throw new Error('夹具建不出图元')
    return prim.lineHeight
  }

  it('缺席、非数、非正数一律回 null（= 跟随主题）', () => {
    expect(lineHeightOf(undefined)).toBeNull()
    expect(lineHeightOf('tall')).toBeNull()
    // ⚠ 0 不当有效值：`line-height: 0` 会把整行压成一条缝而且不报错
    expect(lineHeightOf(0)).toBeNull()
    expect(lineHeightOf(-1)).toBeNull()
  })

  it('正数原样留下，小数不取整', () => {
    expect(lineHeightOf(1)).toBe(1)
    expect(lineHeightOf(1.55)).toBe(1.55)
  })

  it('补丁面上同样是一个键：给了才收，收下的非法值成 null', () => {
    expect(normalizePrimPatch({ lineHeight: 1.1 })).toEqual({ lineHeight: 1.1 })
    expect(normalizePrimPatch({ lineHeight: 0 })).toEqual({ lineHeight: null })
    expect('lineHeight' in normalizePrimPatch({})).toBe(false)
  })
})
