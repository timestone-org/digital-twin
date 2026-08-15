/**
 * @fileoverview 信息牌层守四样：落点解析、取值键带牌 id、没有值时退回静态文案、
 * DOM 清得干净。
 *
 * ⚠ 取值键不带牌 id 时，两张牌上同名的字段会互相覆盖——两个读数都在，
 * 只是其中一个显示的是另一张牌的值，界面上完全看不出来。
 */
import type { TwinAnchor, TwinPanel } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { PanelLayer } from '../src/panelLayer'

const VISIBLE = {
  visible: true,
  hideBelow: null,
  hideAbove: null,
  fade: null,
} as const

const STYLE = {
  variant: 'card',
  orient: 'center',
  accent: '--accent-primary',
  background: '',
  width: 0,
  fontScale: 1,
  animate: false,
  pulse: false,
} as const

function field(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    label: key,
    unit: '',
    prefix: '',
    decimals: null,
    staticText: '',
    ...overrides,
  }
}

function panel(overrides: Partial<TwinPanel> = {}): TwinPanel {
  return {
    id: 'p1',
    name: '泵组',
    anchorId: '',
    position: [0, 0, 0],
    offset: [0, 0, 0],
    fields: [field('temp')],
    billboard: 'face',
    style: { ...STYLE },
    visibility: { ...VISIBLE },
    ...overrides,
  }
}

function anchor(id: string, position: [number, number, number]): TwinAnchor {
  return {
    id,
    name: id,
    position,
    label: '',
    unit: '',
    decimals: null,
    visibility: { ...VISIBLE },
  }
}

function cards(layer: PanelLayer): HTMLElement[] {
  return layer.group.children
    .filter((child): child is typeof child & { element: HTMLElement } =>
      'element' in child,
    )
    .map((child) => child.element)
}

function valuesOf(layer: PanelLayer): string[] {
  return cards(layer).flatMap((card) =>
    [...card.querySelectorAll('span')]
      .filter((_, index) => index % 2 === 1)
      .map((span) => span.textContent ?? ''),
  )
}

describe('建与清', () => {
  it('一张牌建一张卡片', () => {
    const layer = new PanelLayer()
    layer.build([panel()], [])

    expect(cards(layer)).toHaveLength(1)
  })

  it('看不见的牌不建卡片', () => {
    const layer = new PanelLayer()
    layer.build([panel({ visibility: { ...VISIBLE, visible: false } })], [])

    expect(cards(layer)).toHaveLength(0)
  })

  it('重建先清旧的，不叠加', () => {
    const layer = new PanelLayer()
    layer.build([panel({ id: 'p1' }), panel({ id: 'p2' })], [])
    layer.build([panel({ id: 'p3' })], [])

    expect(cards(layer)).toHaveLength(1)
  })

  // ⚠ 从场景图上摘下 CSS2D 对象带不走它的 DOM，漏了卡片会留在页面上飘着
  it('清掉时把 DOM 从页面上摘掉', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const layer = new PanelLayer()
    layer.build([panel()], [])
    const card = cards(layer)[0]
    if (card === undefined) throw new Error('本该建出卡片')
    host.append(card)

    layer.dispose()

    expect(card.isConnected).toBe(false)
    host.remove()
  })
})

describe('落点', () => {
  it('锚点优先，并叠上偏移', () => {
    const layer = new PanelLayer()
    layer.build(
      [panel({ anchorId: 'a1', position: [9, 9, 9], offset: [0, 1, 0] })],
      [anchor('a1', [1, 2, 3])],
    )

    expect(layer.group.children[0]?.position.toArray()).toEqual([1, 3, 3])
  })

  it('没给锚点时用自己的坐标', () => {
    const layer = new PanelLayer()
    layer.build([panel({ position: [4, 5, 6] })], [])

    expect(layer.group.children[0]?.position.toArray()).toEqual([4, 5, 6])
  })

  // ⚠ 退回而不是不画：一张配好字段的牌因为锚点被删就整个消失，
  //   用户只会觉得「我的牌哪去了」
  it('锚点找不到时退回自己的坐标，牌不消失', () => {
    const layer = new PanelLayer()
    layer.build([panel({ anchorId: 'gone', position: [7, 0, 0] })], [])

    expect(cards(layer)).toHaveLength(1)
    expect(layer.group.children[0]?.position.toArray()).toEqual([7, 0, 0])
  })
})

describe('取值', () => {
  it('取值键带牌 id，同名字段不互相覆盖', () => {
    const layer = new PanelLayer()
    layer.build(
      [
        panel({ id: 'p1', name: '', fields: [field('temp')] }),
        panel({ id: 'p2', name: '', fields: [field('temp')] }),
      ],
      [],
    )
    layer.setValues({
      'p1::temp': { value: 10 },
      'p2::temp': { value: 20 },
    })

    expect(valuesOf(layer)).toEqual(['10', '20'])
  })

  it('前缀、单位与小数位一起拼进去', () => {
    const layer = new PanelLayer()
    layer.build(
      [
        panel({
          name: '',
          fields: [field('temp', { prefix: '出口', unit: '℃', decimals: 1 })],
        }),
      ],
      [],
    )
    layer.setValues({ 'p1::temp': { value: 25.46 } })

    expect(valuesOf(layer)).toEqual(['出口 25.5 ℃'])
  })

  it('没有实时值时退回静态文案', () => {
    const layer = new PanelLayer()
    layer.build(
      [panel({ name: '', fields: [field('temp', { staticText: '待接入' })] })],
      [],
    )

    expect(valuesOf(layer)).toEqual(['待接入'])
  })

  it('两样都没有时说取不到，不留一块空白', () => {
    const layer = new PanelLayer()
    layer.build([panel({ name: '' })], [])

    expect(valuesOf(layer)).toEqual(['—'])
  })

  it('非有限数不上屏，退回静态文案', () => {
    const layer = new PanelLayer()
    layer.build(
      [panel({ name: '', fields: [field('temp', { staticText: '待接入' })] })],
      [],
    )
    layer.setValues({ 'p1::temp': { value: Number.NaN } })

    expect(valuesOf(layer)).toEqual(['待接入'])
  })
})

describe('文本安全', () => {
  // ⚠ 牌名与字段标签都是用户可控文本，拼进 innerHTML 就是一个注入点
  it('标签里的尖括号是文本，不是标记', () => {
    const layer = new PanelLayer()
    layer.build([panel({ name: '<img src=x onerror=alert(1)>' })], [])
    const card = cards(layer)[0]

    expect(card?.querySelector('img')).toBeNull()
    expect(card?.textContent).toContain('<img')
  })
})
