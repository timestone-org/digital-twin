/**
 * @fileoverview 锁住图元基类的输出契约：transition 六档闭合属性名各一条、null 时
 * 不产声明而不是产 'none'；pointerEvents / transformOrigin / minWidth / maxWidth
 * 四项各一条（漏一项的表现都是「配了没反应」）；box 恒定输出的三样与 minWidth 字段
 * 是两件事；hidden 不产样式；keepUpright 的反向角只从 transform.ts 取；
 * rotate 与 scale 合成一条 transform，顺序与节点级同族。
 * 另锁六个 `--t2-*` 的注入与 offline → --state-idle 那一档。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_BOX_CONSTANTS,
  injectVars,
  paintBase,
  statusColor,
} from '../src/paintCommon'
import { keepUprightCss } from '../src/transform'
import type { Twin2dPaintCtx } from '../src/paintCommon'
import type { Twin2dNode, Twin2dNodeStyle } from '../src/types'
import type {
  Twin2dBoxPrim,
  Twin2dPlacement,
  Twin2dPrim,
} from '../src/typesPrim'

const BASE_NODE: Twin2dNode = {
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

const BASE_STYLE: Twin2dNodeStyle = {
  id: 's1',
  name: '换热站',
  category: 'plant',
  accent: '',
  defaultStatus: 'online',
  size: { w: 200, h: 120 },
  prims: [],
  ports: [],
  slots: [],
  variants: [],
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

const CTX: Twin2dPaintCtx = {
  node: BASE_NODE,
  boxW: 200,
  boxH: 120,
  idPrefix: 't2-1',
}

function prim(patch: Partial<Twin2dBoxPrim>): Twin2dPrim {
  return { ...BASE_PRIM, ...patch }
}

function ctxWith(node: Twin2dNode): Twin2dPaintCtx {
  return { ...CTX, node }
}

describe('paintBase 的恒定几项', () => {
  it('z / opacity / transform-origin / pointer-events 恒定输出，漏一项就是「配了没反应」', () => {
    const out = paintBase(
      prim({ z: 30, opacity: 0.4, transformOrigin: '50% 100%' }),
      CTX,
    )
    expect(out.style['z-index']).toBe('30')
    expect(out.style['opacity']).toBe('0.4')
    expect(out.style['transform-origin']).toBe('50% 100%')
    expect(out.style['pointer-events']).toBe('auto')
  })

  it('悬浮卡的 pointerEvents:none 原样落进样式：不落它就 hover 自我抖动', () => {
    const out = paintBase(prim({ pointerEvents: 'none' }), CTX)
    expect(out.style['pointer-events']).toBe('none')
  })

  it('transformOrigin 里的脏值被消毒回缺省而不是原样注入', () => {
    const out = paintBase(prim({ transformOrigin: 'url(http://x/a.png)' }), CTX)
    expect(out.style['transform-origin']).toBe('50% 50%')
  })

  it('classes 与 attrs 缺省是空的，attrs 留给 vec', () => {
    const out = paintBase(prim({}), CTX)
    expect(out.classes).toEqual([])
    expect(out.attrs).toEqual({})
  })
})

describe('paintBase 的 hidden', () => {
  it('hidden 的图元一条样式都不产，整枝由渲染层摘掉', () => {
    const out = paintBase(prim({ hidden: true, z: 30, opacity: 0.5 }), CTX)
    expect(out).toEqual({ style: {}, classes: [], attrs: {} })
  })
})

describe('paintBase 的尺寸与宽度上下限', () => {
  it('裸数按设计像素、串形原样，两项都出', () => {
    const out = paintBase(prim({ size: { w: 34, h: '2em' } }), CTX)
    expect(out.style['width']).toBe('34px')
    expect(out.style['height']).toBe('2em')
  })

  it('fill 摆位不出宽高：几何由四向 inset 定死，再给宽高会与 right/bottom 打架', () => {
    const at: Twin2dPlacement = { kind: 'fill', inset: [0, 0, 0, 0] }
    const out = paintBase(prim({ at }), CTX)
    expect(out.style['width']).toBeUndefined()
    expect(out.style['height']).toBeUndefined()
    expect(out.style['inset']).toBe('0px 0px 0px 0px')
  })

  it('minWidth / maxWidth 显式给了才出，各出一条', () => {
    const out = paintBase(prim({ minWidth: 188, maxWidth: 220 }), CTX)
    expect(out.style['min-width']).toBe('188px')
    expect(out.style['max-width']).toBe('220px')
  })

  it('minWidth / maxWidth 为 null 时一条都不产，null 是「不设限」不是 0', () => {
    const out = paintBase(prim({}), CTX)
    expect(out.style['min-width']).toBeUndefined()
    expect(out.style['max-width']).toBeUndefined()
  })
})

describe('box 恒定输出的三样与 minWidth 字段是两件事', () => {
  it('三样是 min-width:0 / min-height:0 / box-sizing:border-box', () => {
    expect({ ...TWIN_2D_BOX_CONSTANTS }).toEqual({
      'min-width': '0',
      'min-height': '0',
      'box-sizing': 'border-box',
    })
  })

  it('minWidth 缺席时恒定的 0 留着，给了 188 才被顶掉', () => {
    const bare = { ...TWIN_2D_BOX_CONSTANTS, ...paintBase(prim({}), CTX).style }
    expect(bare['min-width']).toBe('0')
    const wide = {
      ...TWIN_2D_BOX_CONSTANTS,
      ...paintBase(prim({ minWidth: 188 }), CTX).style,
    }
    expect(wide['min-width']).toBe('188px')
    expect(wide['box-sizing']).toBe('border-box')
  })
})

describe('paintBase 的 transition', () => {
  it('六档闭合属性名各出一条，形如 `<prop> <dur>ms <easing>`', () => {
    const out = paintBase(
      prim({
        transition: {
          props: [
            'transform',
            'opacity',
            'background',
            'border-color',
            'box-shadow',
            'filter',
          ],
          durationMs: 180,
          easing: 'ease',
        },
      }),
      CTX,
    )
    expect(out.style['transition']).toBe(
      [
        'transform 180ms ease',
        'opacity 180ms ease',
        'background 180ms ease',
        'border-color 180ms ease',
        'box-shadow 180ms ease',
        'filter 180ms ease',
      ].join(', '),
    )
  })

  it('transition 为 null 时不产这条声明，而不是产 none', () => {
    const out = paintBase(prim({ transition: null }), CTX)
    expect(out.style['transition']).toBeUndefined()
    expect(Object.values(out.style)).not.toContain('none')
  })

  it('props 为空数组也不产声明：空值的 transition 是一条非法声明', () => {
    const out = paintBase(
      prim({ transition: { props: [], durationMs: 180, easing: 'ease' } }),
      CTX,
    )
    expect(out.style['transition']).toBeUndefined()
  })

  it('脏 easing 被消毒回 ease', () => {
    const out = paintBase(
      prim({
        transition: {
          props: ['opacity'],
          durationMs: 180,
          easing: '@import url(x)',
        },
      }),
      CTX,
    )
    expect(out.style['transition']).toBe('opacity 180ms ease')
  })
})

describe('paintBase 的 anim 与 transition 是两件事', () => {
  it('keyframes 档挂固定类名并把时长写成 --t2-anim-dur', () => {
    const out = paintBase(
      prim({ anim: { kind: 'breathe', durationMs: 1000 } }),
      CTX,
    )
    expect(out.classes).toEqual(['t2-anim-breathe'])
    expect(out.style['--t2-anim-dur']).toBe('1000ms')
    expect(out.style['transition']).toBeUndefined()
  })

  it('anim 为 none 或 null 都不挂类、不写时长', () => {
    const none = paintBase(prim({ anim: { kind: 'none', durationMs: 0 } }), CTX)
    expect(none.classes).toEqual([])
    expect(none.style['--t2-anim-dur']).toBeUndefined()
    expect(paintBase(prim({ anim: null }), CTX).classes).toEqual([])
  })
})

describe('paintBase 的 transform 合成', () => {
  it('没摆位位移、没 keepUpright、rotate 为 0 时不产 transform', () => {
    const out = paintBase(prim({}), CTX)
    expect(out.style['transform']).toBeUndefined()
  })

  it('摆位的位移与图元自己的 rotate 合成同一条，摆位在前', () => {
    const at: Twin2dPlacement = { kind: 'anchor', anchor: 'c', dx: 0, dy: 0 }
    const out = paintBase(prim({ at, rotate: 15 }), CTX)
    expect(out.style['transform']).toBe(
      'translate(calc(-50% + 0px), calc(-50% + 0px)) rotate(15deg)',
    )
  })

  it('keepUpright 的反向角取自 transform.ts，不在这里再算一遍', () => {
    const turned: Twin2dNode = { ...BASE_NODE, rotate: 90, flipY: true }
    const out = paintBase(prim({ keepUpright: true }), ctxWith(turned))
    expect(out.style['transform']).toBe(keepUprightCss(turned))
    expect(out.style['transform']).toBe('scale(1, -1) rotate(-90deg)')
  })

  it('节点没转时 keepUpright 不产多余的恒等变换', () => {
    const out = paintBase(prim({ keepUpright: true }), CTX)
    expect(out.style['transform']).toBeUndefined()
  })

  it('图元级的等比缩放单独给时只出 scale 一段', () => {
    const out = paintBase(prim({ scale: 1.08 }), CTX)
    expect(out.style['transform']).toBe('scale(1.08)')
  })

  it('scale 恰好为 1 是恒等变换，不产多余的一段', () => {
    expect(
      paintBase(prim({ scale: 1 }), CTX).style['transform'],
    ).toBeUndefined()
  })

  it('rotate 与 scale 同时给：顺序是先 rotate 后 scale，与节点级同族', () => {
    const out = paintBase(prim({ rotate: 15, scale: 1.08 }), CTX)
    expect(out.style['transform']).toBe('rotate(15deg) scale(1.08)')
  })

  it('⚠ keepUpright 与 scale 并存时反向角一字不变——等比缩放与旋转可交换', () => {
    const turned: Twin2dNode = { ...BASE_NODE, rotate: 90, flipY: true }
    const out = paintBase(
      prim({ keepUpright: true, scale: 1.08 }),
      ctxWith(turned),
    )
    expect(out.style['transform']).toBe(`${keepUprightCss(turned)} scale(1.08)`)
    expect(out.style['transform']).toBe(
      'scale(1, -1) rotate(-90deg) scale(1.08)',
    )
  })

  it('四段齐全时顺序是 摆位 → 反向 → 自身 rotate → 自身 scale', () => {
    const turned: Twin2dNode = { ...BASE_NODE, rotate: 180 }
    const at: Twin2dPlacement = { kind: 'anchor', anchor: 't', dx: 2, dy: -3 }
    const out = paintBase(
      prim({ at, keepUpright: true, rotate: 45, scale: 1.025 }),
      ctxWith(turned),
    )
    expect(out.style['transform']).toBe(
      'translate(calc(-50% + 2px), calc(-115% + -3px)) scale(1, 1) rotate(-180deg) rotate(45deg) scale(1.025)',
    )
  })

  it('三段齐全时顺序是 摆位 → 反向 → 自身 rotate', () => {
    const turned: Twin2dNode = { ...BASE_NODE, rotate: 180 }
    const at: Twin2dPlacement = { kind: 'anchor', anchor: 't', dx: 2, dy: -3 }
    const out = paintBase(
      prim({ at, keepUpright: true, rotate: 45 }),
      ctxWith(turned),
    )
    expect(out.style['transform']).toBe(
      'translate(calc(-50% + 2px), calc(-115% + -3px)) scale(1, 1) rotate(-180deg) rotate(45deg)',
    )
  })

  it('perim 摆位按父级盒尺寸算落点，盒尺寸从 ctx 来', () => {
    const at: Twin2dPlacement = {
      kind: 'perim',
      t: 0.125,
      gap: 0,
      dx: 0,
      dy: 0,
    }
    const out = paintBase(prim({ at }), CTX)
    expect(out.style['position']).toBe('absolute')
    expect(out.style['left']).toBe('50%')
    expect(out.style['top']).toBe('0%')
  })
})

describe('statusColor 五档', () => {
  it('offline 走 --state-idle 而不是不存在的 --state-offline', () => {
    expect(statusColor('offline')).toBe('var(--state-idle)')
  })

  it('其余三档逐档照抄，hidden 回 null', () => {
    expect(statusColor('online')).toBe('var(--state-success)')
    expect(statusColor('warning')).toBe('var(--state-warning)')
    expect(statusColor('alarm')).toBe('var(--state-danger)')
    expect(statusColor('hidden')).toBeNull()
  })
})

describe('injectVars 的 --t2-*', () => {
  it('六个变量齐出，accent 收底到 --accent-primary', () => {
    expect(injectVars(BASE_NODE, BASE_STYLE, '', 'online')).toEqual({
      '--t2-accent': 'var(--accent-primary)',
      '--t2-badge': 'var(--accent-primary)',
      '--t2-fill-a': 'var(--surface-panel)',
      '--t2-fill-b': 'var(--surface-raised)',
      '--t2-anim-dur': '1000ms',
      '--t2-status': 'var(--state-success)',
    })
  })

  it('accent 三级兜底：节点 → 样式 → 语义 token，字面色在头位就地收链', () => {
    const style: Twin2dNodeStyle = { ...BASE_STYLE, accent: '--twin-steam' }
    const chained = injectVars(BASE_NODE, style, '', 'online')
    expect(chained['--t2-accent']).toBe(
      'var(--twin-steam, var(--accent-primary))',
    )
    const literal = injectVars(
      { ...BASE_NODE, accent: '#62ff8a' },
      style,
      '',
      'online',
    )
    expect(literal['--t2-accent']).toBe('#62ff8a')
  })

  it('变体的 accentOverride 顶掉节点自己的强调色', () => {
    const vars = injectVars(
      { ...BASE_NODE, accent: '#62ff8a' },
      BASE_STYLE,
      '#ff6b6b',
      'alarm',
    )
    expect(vars['--t2-accent']).toBe('#ff6b6b')
  })

  it('脏 accentOverride 不算覆盖，退回节点自己的强调色', () => {
    const vars = injectVars(
      { ...BASE_NODE, accent: '#62ff8a' },
      BASE_STYLE,
      'url(http://x)',
      'alarm',
    )
    expect(vars['--t2-accent']).toBe('#62ff8a')
  })

  it('badge 缺省跟着 accent 走，给了就用给的', () => {
    const fallback = injectVars(
      { ...BASE_NODE, accent: '#62ff8a' },
      BASE_STYLE,
      '',
      'online',
    )
    expect(fallback['--t2-badge']).toBe('#62ff8a')
    const own = injectVars(
      { ...BASE_NODE, badgeColor: '#ff9b54' },
      BASE_STYLE,
      '',
      'online',
    )
    expect(own['--t2-badge']).toBe('#ff9b54')
  })

  it('hidden 档不产 --t2-status：产个空值会让整条声明报废', () => {
    const vars = injectVars(BASE_NODE, BASE_STYLE, '', 'hidden')
    expect(vars['--t2-status']).toBeUndefined()
    expect(Object.keys(vars)).toHaveLength(5)
  })
})
