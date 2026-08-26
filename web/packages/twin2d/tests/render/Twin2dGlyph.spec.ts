/**
 * @fileoverview 图标渲染件守的契约：四来源各落对的宿主元素、`ico.color` 按 symbol
 * 分档生效（4 枚插画式的染不上、另 7 枚染得上）、素材解析槽未注入时整枝不渲染
 * 而不是留一个空 `src`，以及手绘一档摊平成绘制遍时的层序。
 *
 * ⚠ 这几件事错了都不报错：颜色控件点了没反应、图标静默消失、空 `src` 让浏览器
 * 把当前页地址再请求一遍——只有这份用例看得出来。
 */
import { DtIcon } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { paintIco } from '../../src/paintText'
import Twin2dGlyph from '../../src/render/Twin2dGlyph.vue'
import type { Twin2dPaintCtx } from '../../src/paintCommon'
import type { Twin2dIconResolver } from '../../src/paintText'
import type { Twin2dNode } from '../../src/types'
import type {
  Twin2dDrawPart,
  Twin2dIcoPrim,
  Twin2dIcoSrc,
} from '../../src/typesPrim'

const NODE: Twin2dNode = {
  id: 'n1',
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

const CTX: Twin2dPaintCtx = { node: NODE, boxW: 200, boxH: 120, idPrefix: 'a1' }

const BASE: Twin2dIcoPrim = {
  id: 'glyph',
  kind: 'ico',
  at: { kind: 'flow' },
  size: { w: 28, h: 28 },
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
  pointerEvents: 'none',
  keepUpright: false,
  src: { kind: 'none' },
  color: 'var(--t2-accent)',
}

const DRAW_PART: Twin2dDrawPart = {
  shape: { kind: 'line', x1: 0, y1: 12, x2: 24, y2: 12 },
  fill: { kind: 'none' },
  strokes: [
    {
      id: 'base',
      width: 4,
      color: 'var(--surface-panel)',
      dash: [],
      cap: 'round',
      join: 'round',
      opacity: 1,
      nonScaling: false,
    },
    {
      id: 'core',
      width: 2,
      color: 'var(--t2-accent)',
      dash: [],
      cap: 'round',
      join: 'round',
      opacity: 1,
      nonScaling: false,
    },
  ],
}

/**
 * ⚠ 未注入那一档是「一个键都不给」，不是「给 undefined」：给了键就等于装了一个槽，
 * 那正是这份用例要分开的两种情形。
 */
function render(
  patch: Partial<Twin2dIcoPrim>,
  resolveIcon?: Twin2dIconResolver,
) {
  const slot = resolveIcon === undefined ? {} : { resolveIcon }
  return mount(Twin2dGlyph, {
    props: { prim: { ...BASE, ...patch }, ctx: CTX, ...slot },
  })
}

describe('空档与隐藏', () => {
  it('none 档什么都不渲染', () => {
    expect(render({}).find('*').exists()).toBe(false)
  })

  // hidden 那一档 paintBase 连样式都不产，留下元素就是个没尺寸没定位的空壳
  it('hidden 的图元整枝不渲染', () => {
    const src: Twin2dIcoSrc = { kind: 'sprite', id: 'ico-vsl-tank' }

    expect(render({ src, hidden: true }).find('svg').exists()).toBe(false)
  })
})

describe('name 档', () => {
  it('交给 DtIcon，注册名原样传下去', () => {
    const src: Twin2dIcoSrc = { kind: 'name', name: 'activity' }

    const icon = render({ src }).findComponent(DtIcon)
    expect(icon.exists()).toBe(true)
    expect(icon.props('name')).toBe('activity')
  })

  it('像素宽度当 DtIcon 的边长', () => {
    const src: Twin2dIcoSrc = { kind: 'name', name: 'activity' }

    const wrapper = render({ src, size: { w: 40, h: 40 } })

    expect(wrapper.findComponent(DtIcon).props('size')).toBe(40)
  })

  // ⚠ 百分比与 auto 写进 width 属性是非法值，DtIcon 会整体回落，
  // 配的那个宽度看着「没生效」——所以那两档干脆不传，让它用自己的缺省
  it('百分比宽度不往下传，让 DtIcon 用自己的缺省', () => {
    const src: Twin2dIcoSrc = { kind: 'name', name: 'activity' }

    const wrapper = render({ src, size: { w: '50%', h: '50%' } })

    expect(wrapper.findComponent(DtIcon).props('size')).toBe(18)
  })

  it('ico.color 生效', () => {
    const src: Twin2dIcoSrc = { kind: 'name', name: 'activity' }

    expect(render({ src }).attributes('style')).toContain(
      'color: var(--t2-accent)',
    )
  })
})

describe('sprite 档', () => {
  it('外壳 viewBox 恒定，画幅由 <use> 贴合进来', () => {
    const src: Twin2dIcoSrc = { kind: 'sprite', id: 'ico-src-solar' }

    expect(render({ src }).attributes('viewBox')).toBe('0 0 48 48')
  })

  it('<use> 指向 symbol 的 id', () => {
    const src: Twin2dIcoSrc = { kind: 'sprite', id: 'ico-term-radiator' }

    expect(render({ src }).get('use').attributes('href')).toBe(
      '#ico-term-radiator',
    )
  })

  // 7 枚单色 symbol 通篇 currentColor，染得上
  it('单色档吃 ico.color', () => {
    const src: Twin2dIcoSrc = { kind: 'sprite', id: 'ico-vsl-tank' }

    expect(render({ src }).attributes('style')).toContain(
      'color: var(--t2-accent)',
    )
  })

  // ⚠ 4 枚能源源图标的颜色是插画的一部分、写死在 sprite 里：产一个被忽略的
  // color 声明会让检查器与渲染面对「这里能不能染色」的答案有两份
  it('插画式的四枚一个 color 声明都不产', () => {
    const src: Twin2dIcoSrc = { kind: 'sprite', id: 'ico-src-waste-heat' }

    expect(render({ src }).attributes('style')).not.toContain('color:')
  })
})

describe('asset 档', () => {
  it('注入的解析槽产出什么就是 src 什么', () => {
    const src: Twin2dIcoSrc = { kind: 'asset', ref: 'asset:7f3a' }

    const wrapper = render({ src }, (ref) => `/oss/icons/${ref}`)

    expect(wrapper.get('img').attributes('src')).toBe('/oss/icons/asset:7f3a')
  })

  // ⚠ 空 src 的 <img> 会让浏览器把当前页地址重新请求一遍；这一档该整枝不渲染，
  // 「图标为什么没了」由诊断面板说，不是靠一个空壳暗示
  it('未注入解析槽时整枝不渲染，不留一个空 src', () => {
    const src: Twin2dIcoSrc = { kind: 'asset', ref: 'asset:7f3a' }

    const wrapper = render({ src })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('src')
  })

  it('解析槽回空串时同样不渲染', () => {
    const src: Twin2dIcoSrc = { kind: 'asset', ref: 'asset:7f3a' }

    const wrapper = render({ src }, () => '')

    expect(wrapper.find('img').exists()).toBe(false)
  })

  // 图片里的颜色拿不到 currentColor，这一档配了色也只是骗人
  it('ico.color 对图片无效，不产 color 声明', () => {
    const src: Twin2dIcoSrc = { kind: 'asset', ref: 'asset:7f3a' }

    const wrapper = render({ src }, () => '/oss/icons/7f3a')

    expect(wrapper.attributes('style')).not.toContain('color:')
  })

  it('是装饰件，不给辅助技术念图名', () => {
    const src: Twin2dIcoSrc = { kind: 'asset', ref: 'asset:7f3a' }

    const wrapper = render({ src }, () => '/oss/icons/7f3a')

    expect(wrapper.get('img').attributes('alt')).toBe('')
  })
})

describe('draw 档', () => {
  const src: Twin2dIcoSrc = {
    kind: 'draw',
    viewBox: [24, 24],
    parts: [DRAW_PART],
  }

  it('画幅来自 src.viewBox', () => {
    expect(render({ src }).attributes('viewBox')).toBe('0 0 24 24')
  })

  it('一笔里的多遍描边按文档序各出一个元素', () => {
    const wrapper = render({ src })

    const widths = wrapper
      .findAll('line')
      .map((item) => item.attributes('stroke-width'))
    expect(widths).toEqual(['4', '2'])
  })

  it('几何属性逐遍带上，坐标就是 viewBox 像素', () => {
    const wrapper = render({ src })

    expect(wrapper.get('line').attributes('x2')).toBe('24')
  })

  it('多笔按文档序叠，后一笔画在前一笔上面', () => {
    const second: Twin2dDrawPart = {
      shape: { kind: 'ellipse', cx: 12, cy: 12, rx: 6, ry: 6 },
      fill: { kind: 'color', color: 'var(--t2-accent)' },
      strokes: [],
    }
    const twoParts: Twin2dIcoSrc = {
      kind: 'draw',
      viewBox: [24, 24],
      parts: [DRAW_PART, second],
    }

    const drawn = render({ src: twoParts }).findAll('line, ellipse')

    expect(drawn.map((item) => item.element.tagName)).toEqual([
      'line',
      'line',
      'ellipse',
    ])
  })

  // ⚠ 手绘一笔没有渐变表：引渐变时必须落回不上色，去够别的图元里同名的那个
  // 会让这枚图标被隔壁的配色染了，两边都不报错
  it('引渐变的填充退回不上色', () => {
    const gradientPart: Twin2dIcoSrc = {
      kind: 'draw',
      viewBox: [24, 24],
      parts: [
        {
          shape: { kind: 'rect', x: 0, y: 0, w: 24, h: 24, rx: 0 },
          fill: { kind: 'gradient', id: 'g1' },
          strokes: [],
        },
      ],
    }

    expect(render({ src: gradientPart }).get('rect').attributes('fill')).toBe(
      'none',
    )
  })

  it('ico.color 生效（描边写的是 currentColor 时靠它取色）', () => {
    expect(render({ src }).attributes('style')).toContain(
      'color: var(--t2-accent)',
    )
  })
})

describe('样式只有一份真源', () => {
  it('每一条内联样式都来自 paintIco', () => {
    const src: Twin2dIcoSrc = { kind: 'sprite', id: 'ico-hx' }
    const prim: Twin2dIcoPrim = { ...BASE, src }

    const style = render({ src }).attributes('style') ?? ''

    for (const [key, value] of Object.entries(paintIco(prim, CTX).style)) {
      expect(style).toContain(`${key}: ${value}`)
    }
  })

  it('keyframes 那一档的类名也来自 paintIco', () => {
    const src: Twin2dIcoSrc = { kind: 'sprite', id: 'ico-hx' }

    const wrapper = render({ src, anim: { kind: 'breathe', durationMs: 1200 } })

    expect(wrapper.classes()).toContain('t2-anim-breathe')
  })
})
