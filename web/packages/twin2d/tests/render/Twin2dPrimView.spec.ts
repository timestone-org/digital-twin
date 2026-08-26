/**
 * @fileoverview 图元递归渲染件守的契约：四种 kind 各落对宿主元素、box 的子树真递归下去、
 * `hidden` 与 `when` 不成立的那一枝**整枝**不渲染（不是留一个空壳）、子树拿到的盒尺寸是
 * 这个 box 自己的，以及样式与显示串只有 paint 一族这一份真源。
 *
 * ⚠ 这几件事错了都不报错：递归组件没自引用则整棵子树静默消失；留空壳会让一棵深树照样
 * 把浏览器摁死；盒尺寸没换会让子盒里的 `unit` 档 vec 与 `perim` 药丸贴到整个节点的边上。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { paintBox } from '../../src/paintBox'
import { paintText } from '../../src/paintText'
import Twin2dPrimView from '../../src/render/Twin2dPrimView.vue'
import type { Twin2dState } from '../../src/kinds'
import type { Twin2dPaintCtx } from '../../src/paintCommon'
import type { Twin2dIconResolver, Twin2dSlotRead } from '../../src/paintText'
import type { Twin2dNode } from '../../src/types'
import type {
  Twin2dBorder,
  Twin2dBoxPrim,
  Twin2dIcoPrim,
  Twin2dLayout,
  Twin2dPrim as Twin2dPrimType,
  Twin2dPrimBase,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../../src/typesPrim'
import type { Twin2dVariantCtx } from '../../src/variants'

/** 按槽键取口径与读数，与组件那个可选 prop 同型。 */
type SlotReader = (key: string) => Twin2dSlotRead | null

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

/** 非方形盒：两轴换算写反了才看得出来 */
const CTX: Twin2dPaintCtx = { node: NODE, boxW: 200, boxH: 120, idPrefix: 'a1' }

const BASE: Omit<Twin2dPrimBase, 'id'> = {
  at: { kind: 'flow' },
  size: { w: 40, h: 40 },
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

/** 四向内边距各不相同：简写的值序写错了才看得出来 */
const LAYOUT: Twin2dLayout = {
  flow: 'row',
  gap: 6,
  align: 'center',
  justify: 'start',
  wrap: false,
  pad: [4, 8, 12, 16],
}

const BORDER: Twin2dBorder = {
  width: 0,
  style: 'none',
  color: '',
  sides: { top: true, right: true, bottom: true, left: true },
}

function boxOf(patch: Partial<Twin2dBoxPrim> = {}): Twin2dBoxPrim {
  return {
    ...BASE,
    id: 'shell',
    kind: 'box',
    layout: LAYOUT,
    fills: [],
    border: BORDER,
    radius: 0,
    shadows: [],
    backdropBlur: 0,
    clip: false,
    cursor: 'default',
    children: [],
    ...patch,
  }
}

function vecOf(patch: Partial<Twin2dVecPrim> = {}): Twin2dVecPrim {
  return {
    ...BASE,
    id: 'outline',
    kind: 'vec',
    coord: 'px',
    shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10, rx: 0 },
    fill: { kind: 'none' },
    strokes: [],
    gradients: [],
    stretch: false,
    ...patch,
  }
}

function icoOf(patch: Partial<Twin2dIcoPrim> = {}): Twin2dIcoPrim {
  return {
    ...BASE,
    id: 'glyph',
    kind: 'ico',
    src: { kind: 'sprite', id: 'ico-hx' },
    color: 'currentColor',
    ...patch,
  }
}

function txtOf(patch: Partial<Twin2dTxtPrim> = {}): Twin2dTxtPrim {
  return {
    ...BASE,
    id: 'label',
    kind: 'txt',
    src: { kind: 'lit', text: '读数' },
    font: {},
    lineHeight: null,
    align: 'start',
    baseline: 'auto',
    nowrap: false,
    ellipsis: false,
    titleAttr: false,
    shadows: [],
    outline: null,
    ...patch,
  }
}

function variantCtx(states: readonly Twin2dState[] = []): Twin2dVariantCtx {
  return {
    states: new Set(states),
    status: null,
    tags: new Map(),
    slots: new Map(),
    fields: new Map(),
  }
}

/**
 * ⚠ 未注入那两个槽是「一个键都不给」，不是「给 undefined」：给了键就等于装了一个槽，
 * 那正是这份用例要分开的两种情形。
 */
function render(
  prim: Twin2dPrimType,
  variant: Twin2dVariantCtx = variantCtx(),
  read?: SlotReader,
  icon?: Twin2dIconResolver,
) {
  const slots = {
    ...(read === undefined ? {} : { readSlot: read }),
    ...(icon === undefined ? {} : { resolveIcon: icon }),
  }
  return mount(Twin2dPrimView, { props: { prim, ctx: CTX, variant, ...slots } })
}

describe('四种 kind 各落对宿主元素', () => {
  it('box 落一个 div', () => {
    expect(render(boxOf()).html()).toMatch(/^<div/)
  })

  it('vec 交给叶子件，落一个 svg', () => {
    expect(render(vecOf()).get('svg').classes()).toContain('t2-vec')
  })

  it('ico 交给叶子件，落一个图标宿主', () => {
    expect(render(icoOf()).get('svg').classes()).toContain('t2-glyph')
  })

  it('txt 落一段文字', () => {
    expect(render(txtOf()).text()).toBe('读数')
  })

  // .t2-prim 只补一条所有图元都一样的盒模型；漏在哪一档上都表现为「那一种图元的
  // 宽度算法跟别的不一样」，而每一处内联样式看着都对
  it('四档都带上 .t2-prim', () => {
    const prims = [boxOf(), vecOf(), icoOf(), txtOf()]

    const carried = prims.map((prim) =>
      render(prim).classes().includes('t2-prim'),
    )

    expect(carried).toEqual([true, true, true, true])
  })
})

describe('递归', () => {
  it('三层树最深那层真渲染出来', () => {
    const leaf = txtOf({ id: 'leaf', src: { kind: 'lit', text: '最深一层' } })
    const mid = boxOf({ id: 'mid', children: [leaf] })

    const wrapper = render(boxOf({ children: [mid] }))

    expect(wrapper.findAll('div')).toHaveLength(3)
    expect(wrapper.text()).toBe('最深一层')
  })

  it('同层子图元按文档序渲染', () => {
    const first = txtOf({ id: 'a', src: { kind: 'lit', text: '甲' } })
    const second = txtOf({ id: 'b', src: { kind: 'lit', text: '乙' } })

    const wrapper = render(boxOf({ children: [first, second] }))

    expect(wrapper.text()).toBe('甲乙')
  })

  it('嵌两个 box 也能一路递归到底', () => {
    const leaf = vecOf({ id: 'leaf' })
    const inner = boxOf({ id: 'inner', children: [leaf] })
    const mid = boxOf({ id: 'mid', children: [inner] })

    expect(
      render(boxOf({ children: [mid] }))
        .find('svg')
        .exists(),
    ).toBe(true)
  })
})

describe('子树拿到的盒尺寸是这个 box 自己的', () => {
  // ⚠ 子孙拿盒尺寸算 perim 的周长落点与 unit 档 vec 的坐标换算：不换的表现是
  // 子盒里的图元贴到整个节点的边上去，而两处单看都说得通
  it('像素尺寸直接落到子树', () => {
    const box = boxOf({ size: { w: 80, h: 60 }, children: [vecOf()] })

    expect(render(box).get('svg').attributes('viewBox')).toBe('0 0 80 60')
  })

  it('百分比各按父级那一轴换算', () => {
    const box = boxOf({ size: { w: '50%', h: '50%' }, children: [vecOf()] })

    expect(render(box).get('svg').attributes('viewBox')).toBe('0 0 100 60')
  })

  // em 与 auto 的真值要等布局完才知道，渲染期取不到，回落父级盒尺寸
  it('auto 回落父级盒尺寸', () => {
    const box = boxOf({ size: { w: 'auto', h: 'auto' }, children: [vecOf()] })

    expect(render(box).get('svg').attributes('viewBox')).toBe('0 0 200 120')
  })

  it('fill 一档按四向内缩算，上下归高、左右归宽', () => {
    const box = boxOf({
      at: { kind: 'fill', inset: [10, 20, 10, 20] },
      children: [vecOf()],
    })

    expect(render(box).get('svg').attributes('viewBox')).toBe('0 0 160 100')
  })

  // ⚠ 兜到 1 而不是 0：viewBox="0 0 0 0" 会让整层什么都不画
  it('内缩把盒吃成负数时兜到 1', () => {
    const box = boxOf({
      at: { kind: 'fill', inset: ['100%', '100%', '100%', '100%'] },
      children: [vecOf()],
    })

    expect(render(box).get('svg').attributes('viewBox')).toBe('0 0 1 1')
  })
})

describe('整枝不渲染', () => {
  // ⚠ 空壳的子树照样递归下去，一棵深树照样把浏览器摁死，而那个壳还压在别的图元上吃指针
  it('hidden 的 box 连子树一起不渲染', () => {
    const leaf = txtOf({ src: { kind: 'lit', text: '隐藏枝里的字' } })

    const wrapper = render(boxOf({ hidden: true, children: [leaf] }))

    expect(wrapper.find('div').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('隐藏枝里的字')
  })

  it('when 不成立的 box 连子树一起不渲染', () => {
    const leaf = txtOf({ src: { kind: 'lit', text: '悬浮才有的字' } })
    const box = boxOf({
      when: { kind: 'state', state: 'hover' },
      children: [leaf],
    })

    const wrapper = render(box)

    expect(wrapper.find('div').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('悬浮才有的字')
  })

  it('when 成立时照常渲染', () => {
    const leaf = txtOf({ src: { kind: 'lit', text: '悬浮才有的字' } })
    const box = boxOf({
      when: { kind: 'state', state: 'hover' },
      children: [leaf],
    })

    expect(render(box, variantCtx(['hover'])).text()).toBe('悬浮才有的字')
  })

  // 求值上下文没往下传的表现：整棵子树里带 when 的图元一个都不出现
  it('深处的 when 各自判，求值上下文一路传下去', () => {
    const always = txtOf({ id: 'a', src: { kind: 'lit', text: '常在' } })
    const onHover = txtOf({
      id: 'b',
      when: { kind: 'state', state: 'hover' },
      src: { kind: 'lit', text: '悬浮' },
    })
    const mid = boxOf({ id: 'mid', children: [always, onHover] })
    const tree = boxOf({ children: [mid] })

    expect(render(tree).text()).toBe('常在')
    expect(render(tree, variantCtx(['hover'])).text()).toBe('常在悬浮')
  })

  it('hidden 的叶子也整枝不渲染', () => {
    expect(
      render(vecOf({ hidden: true }))
        .find('svg')
        .exists(),
    ).toBe(false)
    expect(render(txtOf({ hidden: true })).text()).toBe('')
  })
})

describe('样式只有一份真源', () => {
  it('box 每一条内联样式都来自 paintBox', () => {
    const prim = boxOf()

    const style = render(prim).attributes('style') ?? ''

    for (const [key, value] of Object.entries(paintBox(prim, CTX).style)) {
      expect(style).toContain(`${key}: ${value}`)
    }
  })

  it('txt 每一条内联样式都来自 paintText', () => {
    const prim = txtOf({ nowrap: true, ellipsis: true })

    const style = render(prim).attributes('style') ?? ''

    for (const [key, value] of Object.entries(paintText(prim, CTX).style)) {
      expect(style).toContain(`${key}: ${value}`)
    }
  })

  it('keyframes 那一档的类名也来自 paint', () => {
    const wrapper = render(boxOf({ anim: { kind: 'pulse', durationMs: 900 } }))

    expect(wrapper.classes()).toContain('t2-anim-pulse')
    expect(wrapper.attributes('style')).toContain('--t2-anim-dur: 900ms')
  })

  // ⚠ token 只给字体族，等宽数字要消费处自己配，塞进 font 简写会被丢掉（§11.2）
  it('数字字体那一档挂上 .t2-digit', () => {
    const prim = txtOf({ font: { family: 'var(--font-digit)' } })

    expect(render(prim).classes()).toContain('t2-digit')
  })
})

describe('txt 的显示串', () => {
  it('label 档读节点显示名', () => {
    expect(render(txtOf({ src: { kind: 'label' } })).text()).toBe('一号换热站')
  })

  it('id 档读节点 id', () => {
    expect(render(txtOf({ src: { kind: 'id' } })).text()).toBe('n1')
  })

  // ⚠ 精度、单位与映射表是槽位的口径，在模板里再拼一遍就是第二个真源（§11.3）
  it('slot 档走槽位口径出精度与单位', () => {
    const read: SlotReader = () => ({
      slot: {
        precision: 1,
        format: 'auto',
        unit: 'kW',
        enumMap: {},
        placeholder: '',
      },
      value: 63.4,
    })

    const wrapper = render(
      txtOf({ src: { kind: 'slot', slot: 'p' } }),
      undefined,
      read,
    )

    expect(wrapper.text()).toBe('63.4 kW')
  })

  // 未注入取数槽时显示「—」：空串看着像「这一格没配」，而实际是「没人喂读数」
  it('未注入取数槽时 slot 档显示占位符', () => {
    expect(render(txtOf({ src: { kind: 'slot', slot: 'p' } })).text()).toBe('—')
  })

  it('取数槽一路传到最深那层', () => {
    const read: SlotReader = () => ({
      slot: {
        precision: 0,
        format: 'auto',
        unit: 't/h',
        enumMap: {},
        placeholder: '',
      },
      value: 12,
    })
    const leaf = txtOf({ id: 'leaf', src: { kind: 'slot', slot: 'q' } })
    const mid = boxOf({ id: 'mid', children: [leaf] })

    const wrapper = render(boxOf({ children: [mid] }), undefined, read)

    expect(wrapper.text()).toBe('12 t/h')
  })

  it('titleAttr 把完整文本挂到 title 上', () => {
    const prim = txtOf({
      titleAttr: true,
      src: { kind: 'lit', text: '很长的一段' },
    })

    expect(render(prim).attributes('title')).toBe('很长的一段')
  })

  // 空文本挂 title 会 hover 出一个空气泡
  it('空文本不挂 title', () => {
    const prim = txtOf({ titleAttr: true, src: { kind: 'lit', text: '' } })

    expect(render(prim).attributes('title')).toBeUndefined()
  })
})

describe('素材解析槽', () => {
  it('注入的解析槽一路传到 ico 那一档', () => {
    const leaf = icoOf({
      id: 'leaf',
      src: { kind: 'asset', ref: 'asset:7f3a' },
    })
    const tree = boxOf({ children: [boxOf({ id: 'mid', children: [leaf] })] })

    const wrapper = render(tree, undefined, undefined, (ref) => `/oss/${ref}`)

    expect(wrapper.get('img').attributes('src')).toBe('/oss/asset:7f3a')
  })

  // 未注入时那一档整枝不渲染，不留一个空 src 让浏览器把当前页地址再请求一遍
  it('未注入时 asset 档不渲染', () => {
    const prim = icoOf({ src: { kind: 'asset', ref: 'asset:7f3a' } })

    expect(render(prim).find('img').exists()).toBe(false)
  })
})
