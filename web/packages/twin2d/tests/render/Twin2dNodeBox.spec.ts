/**
 * @fileoverview 一个节点守的契约：根容器的位姿与六个 `--t2-*`、状态三级解析与五档配色、
 * hover 由本组件自检并走变体补丁（含抬 z 与「未被碰到的图元保持原引用」）、节点级
 * `patch` / `layers` 与变体的先后，以及图元树拿到的盒尺寸与两个注入槽。
 *
 * ⚠ 这些错了都不报错：状态映射抄错只是颜色不对；hover 不抬 z 只在两个节点靠得近时
 * 才看得出来；整树重建让 hover 一个节点重绘整张图，而每一帧的画面都是「对」的。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import Twin2dNodeBox from '../../src/render/Twin2dNodeBox.vue'
import Twin2dPrimView from '../../src/render/Twin2dPrimView.vue'
import type { Twin2dSlotValues } from '../../src/expr'
import type { Twin2dStatus } from '../../src/kinds'
import type { Twin2dIconResolver, Twin2dSlotRead } from '../../src/paintText'
import type {
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dVariant,
} from '../../src/types'
import type {
  Twin2dBorder,
  Twin2dBoxPrim,
  Twin2dIcoPrim,
  Twin2dLayout,
  Twin2dPrim as Twin2dPrimNode,
  Twin2dPrimBase,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../../src/typesPrim'

/** 按槽键取口径与读数，与组件那个可选 prop 同型。 */
type SlotReader = (key: string) => Twin2dSlotRead | null

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
    id: 'frame',
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

function txtOf(patch: Partial<Twin2dTxtPrim> = {}): Twin2dTxtPrim {
  return {
    ...BASE,
    id: 'label',
    kind: 'txt',
    src: { kind: 'label' },
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

function vecOf(patch: Partial<Twin2dVecPrim> = {}): Twin2dVecPrim {
  return {
    ...BASE,
    id: 'dot',
    kind: 'vec',
    coord: 'unit',
    shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rx: 0 },
    fill: { kind: 'none' },
    strokes: [],
    gradients: [],
    stretch: false,
    ...patch,
  }
}

/** 非方形节点：两轴换算写反了才看得出来 */
function nodeOf(patch: Partial<Twin2dNode> = {}): Twin2dNode {
  return {
    id: 'n1',
    styleId: 's1',
    x: 40,
    y: 20,
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
    ...patch,
  }
}

function styleOf(patch: Partial<Twin2dNodeStyle> = {}): Twin2dNodeStyle {
  return {
    id: 's1',
    name: '换热站',
    category: 'device',
    accent: '',
    defaultStatus: 'online',
    size: { w: 160, h: 90 },
    prims: [boxOf({ children: [txtOf()] }), vecOf()],
    ports: [],
    slots: [],
    variants: [],
    ...patch,
  }
}

/** 带一个局部渐变的样式：渐变 id 要靠实例前缀才在整个文档里唯一。 */
function gradientStyle(): Twin2dNodeStyle {
  return styleOf({
    prims: [
      vecOf({
        gradients: [
          {
            id: 'g1',
            kind: 'linear',
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 1,
            stops: [
              { id: 's0', at: 0, color: 'var(--t2-fill-a)' },
              { id: 's1', at: 1, color: 'var(--t2-fill-b)' },
            ],
          },
        ],
      }),
    ],
  })
}

/** hover 抬起来的那一条：抬 z 是为了别被右邻节点整块盖住。 */
function hoverVariant(patch: Partial<Twin2dVariant> = {}): Twin2dVariant {
  return {
    id: 'v-hover',
    when: { kind: 'state', state: 'hover' },
    patch: { frame: { opacity: 0.5 } },
    rootPatch: { z: 30 },
    ...patch,
  }
}

interface RenderOptions {
  node?: Twin2dNode
  nodeStyle?: Twin2dNodeStyle
  status?: Twin2dStatus | null
  slotValues?: Twin2dSlotValues
  readSlot?: SlotReader
  resolveIcon?: Twin2dIconResolver
  idPrefix?: string
}

/**
 * ⚠ 两个注入槽是「一个键都不给」而不是「给 undefined」：给了键就等于装了一个槽，
 * 那正是这份用例要分开的两种情形。
 */
function render(options: RenderOptions = {}) {
  const { readSlot, resolveIcon, ...rest } = options
  return mount(Twin2dNodeBox, {
    props: {
      node: rest.node ?? nodeOf(),
      nodeStyle: rest.nodeStyle ?? styleOf(),
      ...(rest.status === undefined ? {} : { status: rest.status }),
      ...(rest.slotValues === undefined ? {} : { slotValues: rest.slotValues }),
      ...(rest.idPrefix === undefined ? {} : { idPrefix: rest.idPrefix }),
      ...(readSlot === undefined ? {} : { readSlot }),
      ...(resolveIcon === undefined ? {} : { resolveIcon }),
    },
  })
}

function styleOfRoot(wrapper: ReturnType<typeof render>): string {
  return wrapper.get('[data-test="node"]').attributes('style') ?? ''
}

/** 按图元 id 取那个子件当下拿到的图元对象。 */
function primAt(
  wrapper: ReturnType<typeof render>,
  id: string,
): Twin2dPrimNode | undefined {
  return wrapper
    .findAllComponents(Twin2dPrimView)
    .map((child) => child.props('prim') as Twin2dPrimNode)
    .find((prim) => prim.id === id)
}

describe('根容器', () => {
  it('挂 .t2-node 与按生效状态的那个类', () => {
    const wrapper = render()

    expect(wrapper.classes()).toContain('t2-node')
    expect(wrapper.classes()).toContain('t2-node--online')
  })

  it('尺寸取节点自己的宽高', () => {
    const style = styleOfRoot(render())

    expect(style).toContain('width: 200px')
    expect(style).toContain('height: 120px')
  })

  // ⚠ 0 是「跟样式的 size 走」的哨兵，不是「宽 0」：直接用会画出一个什么都没有的节点
  it('宽高为 0 时跟样式的 size 走', () => {
    const style = styleOfRoot(render({ node: nodeOf({ w: 0, h: 0 }) }))

    expect(style).toContain('width: 160px')
    expect(style).toContain('height: 90px')
  })

  // ⚠ 位移量以 left/top 为 0 为前提，靠 auto 的静态位置兜着只是恰好对
  it('left 与 top 恒为 0，位移全交给 transform', () => {
    const style = styleOfRoot(render())

    expect(style).toContain('left: 0')
    expect(style).toContain('top: 0')
  })

  it('位姿是 translate → rotate → scale 三段', () => {
    const node = nodeOf({ rotate: 90, flipX: true })

    expect(styleOfRoot(render({ node }))).toContain(
      'transform: translate(40px, 20px) rotate(90deg) scale(-1, 1)',
    )
  })

  it('六个 --t2-* 都注在根上', () => {
    const style = styleOfRoot(render())

    for (const name of [
      '--t2-accent',
      '--t2-badge',
      '--t2-fill-a',
      '--t2-fill-b',
      '--t2-anim-dur',
      '--t2-status',
    ]) {
      expect(style).toContain(`${name}:`)
    }
  })
})

describe('生效状态三级', () => {
  it('数据线上的覆盖压过节点上的静态状态', () => {
    const node = nodeOf({ status: 'online' })

    const style = styleOfRoot(render({ node, status: 'alarm' }))

    expect(style).toContain('--t2-status: var(--state-danger)')
  })

  // ⚠ null 是「这条数据线没说」而不是「离线」：把没有数据的设备显示成一个确定状态，
  // 是这套系统里代价最大的一种谎
  it('覆盖为 null 时用节点上的静态状态', () => {
    const node = nodeOf({ status: 'alarm' })

    const style = styleOfRoot(render({ node, status: null }))

    expect(style).toContain('--t2-status: var(--state-danger)')
  })

  it('节点没给状态时用样式的缺省', () => {
    const nodeStyle = styleOf({ defaultStatus: 'warning' })

    const style = styleOfRoot(render({ nodeStyle }))

    expect(style).toContain('--t2-status: var(--state-warning)')
  })

  // offline 取 --state-idle（本仓没有 --state-offline，写错了整条声明报废）、
  // 待机档取 --state-warning，这两处刻意不同名
  it.each([
    ['online', 'var(--state-success)'],
    ['warning', 'var(--state-warning)'],
    ['alarm', 'var(--state-danger)'],
    ['offline', 'var(--state-idle)'],
  ] as const)('%s 档的状态色是 %s', (status, color) => {
    const style = styleOfRoot(render({ status }))

    expect(style).toContain(`--t2-status: ${color}`)
  })

  // hidden 是「整个状态点不渲染」：产一个空值会让 var(--t2-status) 整条声明报废
  it('hidden 档一条 --t2-status 都不产', () => {
    const nodeStyle = styleOf({ defaultStatus: 'hidden' })

    const style = styleOfRoot(render({ nodeStyle }))

    expect(style).not.toContain('--t2-status')
  })

  it('生效状态也落在 data 属性上', () => {
    const wrapper = render({ status: 'alarm' })

    expect(wrapper.attributes('data-status')).toBe('alarm')
  })
})

describe('hover 自检', () => {
  it('mouseenter 让 hover 变体的补丁落到对应子图元上', async () => {
    const nodeStyle = styleOf({ variants: [hoverVariant()] })
    const wrapper = render({ nodeStyle })

    await wrapper.trigger('mouseenter')

    expect(primAt(wrapper, 'frame')?.opacity).toBe(0.5)
  })

  it('未 hover 时那条补丁一点都不生效', () => {
    const nodeStyle = styleOf({ variants: [hoverVariant()] })

    expect(primAt(render({ nodeStyle }), 'frame')?.opacity).toBe(1)
  })

  it('mouseleave 之后补丁撤回', async () => {
    const nodeStyle = styleOf({ variants: [hoverVariant()] })
    const wrapper = render({ nodeStyle })

    await wrapper.trigger('mouseenter')
    await wrapper.trigger('mouseleave')

    expect(primAt(wrapper, 'frame')?.opacity).toBe(1)
  })

  // ⚠ 不抬 z 的表现是悬浮卡被右邻节点整块盖住，而它只在两个节点靠得近时才看得出来
  it('hover 变体的 z 抬到根的 z-index 上', async () => {
    const nodeStyle = styleOf({ variants: [hoverVariant()] })
    const wrapper = render({ nodeStyle })

    await wrapper.trigger('mouseenter')

    expect(styleOfRoot(wrapper)).toContain('z-index: 30')
  })

  it('没配 z 的那一条不产 z-index，让层序留给 DOM 顺序', () => {
    const nodeStyle = styleOf({ variants: [hoverVariant({ rootPatch: {} })] })

    expect(styleOfRoot(render({ nodeStyle }))).not.toContain('z-index')
  })

  // ⚠ 整树重建会让每一帧都换掉所有子组件的 props 引用，hover 一个节点就重绘整张图
  it('hover 只换被补丁碰到的那一枝，其余保持原引用', async () => {
    const nodeStyle = styleOf({ variants: [hoverVariant()] })
    const wrapper = render({ nodeStyle })
    const frameBefore = primAt(wrapper, 'frame')
    const dotBefore = primAt(wrapper, 'dot')

    await wrapper.trigger('mouseenter')

    expect(primAt(wrapper, 'dot')).toBe(dotBefore)
    expect(primAt(wrapper, 'frame')).not.toBe(frameBefore)
  })

  it('抬升排在最左、等比缩放排在最右', async () => {
    const nodeStyle = styleOf({
      variants: [hoverVariant({ rootPatch: { lift: 3, scale: 1.025 } })],
    })
    const wrapper = render({ node: nodeOf({ rotate: 90 }), nodeStyle })

    await wrapper.trigger('mouseenter')

    expect(styleOfRoot(wrapper)).toContain(
      'transform: translateY(-3px) translate(40px, 20px) rotate(90deg) scale(1, 1) scale(1.025)',
    )
  })

  // inset 与外阴影只差一个前缀，抄错的表现是「内发光跑到外面去」
  it('内阴影带上 inset 前缀', async () => {
    const nodeStyle = styleOf({
      variants: [
        hoverVariant({
          rootPatch: {
            shadows: [
              {
                id: 'inner',
                x: 0,
                y: 2,
                blur: 18,
                spread: 0,
                color: 'var(--t2-accent)',
                inset: true,
              },
            ],
          },
        }),
      ],
    })
    const wrapper = render({ nodeStyle })

    await wrapper.trigger('mouseenter')

    expect(styleOfRoot(wrapper)).toContain(
      'box-shadow: inset 0px 2px 18px 0px var(--t2-accent)',
    )
  })

  it('变体的三样根覆盖各自落到一条声明上', async () => {
    const nodeStyle = styleOf({
      variants: [
        hoverVariant({
          rootPatch: {
            accent: 'var(--state-danger)',
            borderColor: 'var(--state-danger)',
            shadows: [
              {
                id: 'glow',
                x: 0,
                y: 0,
                blur: 16,
                spread: 0,
                color: 'var(--state-danger)',
                inset: false,
              },
            ],
          },
        }),
      ],
    })
    const wrapper = render({ nodeStyle })

    await wrapper.trigger('mouseenter')

    const style = styleOfRoot(wrapper)
    // ⚠ 强调色恒带兜底链：内联的 var() 拼错时没有兜底会让整条声明失效，而内联优先级
    // 更高，连根上的兜底一起遮掉
    expect(style).toContain(
      '--t2-accent: var(--state-danger, var(--accent-primary))',
    )
    expect(style).toContain('border-color: var(--state-danger)')
    expect(style).toContain('box-shadow: 0px 0px 16px 0px var(--state-danger)')
  })
})

describe('节点级覆盖与变体的先后', () => {
  // ⚠ 节点级 patch 走的是变体那条浅合并，条件恒成立；变体那边一改这里就静默失效
  it('节点 patch 无条件生效，不需要任何变体命中', () => {
    const node = nodeOf({ patch: { label: { opacity: 0.25 } } })

    expect(primAt(render({ node }), 'label')?.opacity).toBe(0.25)
  })

  it('追加图元排在样式图元之后', () => {
    const node = nodeOf({
      layers: [txtOf({ id: 'extra', src: { kind: 'lit', text: '追加' } })],
    })

    const ids = render({ node })
      .findAllComponents(Twin2dPrimView)
      .map((child) => (child.props('prim') as Twin2dPrimNode).id)

    expect(ids).toEqual(['frame', 'label', 'dot', 'extra'])
  })

  it('变体盖得住节点自己的 patch', async () => {
    const node = nodeOf({ patch: { frame: { opacity: 0.25 } } })
    const nodeStyle = styleOf({ variants: [hoverVariant()] })
    const wrapper = render({ node, nodeStyle })

    await wrapper.trigger('mouseenter')

    expect(primAt(wrapper, 'frame')?.opacity).toBe(0.5)
  })

  it('节点上的自由标签喂给 tag 那一档条件', () => {
    const node = nodeOf({ tags: { subtype: 'solar' } })
    const nodeStyle = styleOf({
      variants: [
        {
          id: 'v-tag',
          when: { kind: 'tag', key: 'subtype', in: ['solar'] },
          patch: { dot: { opacity: 0.75 } },
          rootPatch: {},
        },
      ],
    })

    expect(primAt(render({ node, nodeStyle }), 'dot')?.opacity).toBe(0.75)
  })

  it('槽读数喂给 slot 那一档条件', () => {
    const nodeStyle = styleOf({
      variants: [
        {
          id: 'v-slot',
          when: {
            kind: 'slot',
            slot: 'temp',
            op: 'gt',
            value: 40,
            value2: null,
          },
          patch: { dot: { opacity: 0.4 } },
          rootPatch: {},
        },
      ],
    })

    const hot = render({ nodeStyle, slotValues: new Map([['temp', 60]]) })
    const cold = render({ nodeStyle, slotValues: new Map([['temp', 20]]) })

    expect(primAt(hot, 'dot')?.opacity).toBe(0.4)
    expect(primAt(cold, 'dot')?.opacity).toBe(1)
  })
})

describe('图元树的上下文', () => {
  // ⚠ 子孙拿盒尺寸算 perim 摆位的周长落点与 unit 档 vec 的坐标换算，喂错的表现是
  // 药丸与描边贴到别的地方去，而每一处单看都说得通
  it('子图元拿到的盒尺寸是节点盒', () => {
    const wrapper = render()

    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 200 120')
  })

  it('宽高为 0 的节点喂给子图元的是样式尺寸', () => {
    const wrapper = render({ node: nodeOf({ w: 0, h: 0 }) })

    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 160 90')
  })

  it('实例前缀落到局部渐变的 DOM id 上', () => {
    const wrapper = render({ nodeStyle: gradientStyle(), idPrefix: 'stage7' })

    expect(wrapper.get('linearGradient').attributes('id')).toContain('stage7')
  })

  // ⚠ 缺省不能是空串：同一份样式在同一张图上出现两次时局部渐变 id 会相撞，浏览器
  // 只认头一个，表现是「另一个节点的颜色跑到这个节点上」
  it('不给实例前缀时同一应用里的两个节点各拿一个', () => {
    const nodeStyle = gradientStyle()
    const Pair = defineComponent({
      setup() {
        return () => [
          h(Twin2dNodeBox, { node: nodeOf(), nodeStyle }),
          h(Twin2dNodeBox, { node: nodeOf({ id: 'n2' }), nodeStyle }),
        ]
      },
    })

    const ids = mount(Pair)
      .findAll('linearGradient')
      .map((el) => el.attributes('id'))

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe('两个注入槽', () => {
  it('取数槽一路传到 txt 图元', () => {
    const read: SlotReader = () => ({
      slot: {
        precision: 1,
        format: 'auto',
        unit: 'kW',
        enumMap: {},
        placeholder: '',
      },
      value: 63.4,
      state: 'ok',
      reason: '',
    })
    const nodeStyle = styleOf({
      prims: [txtOf({ src: { kind: 'slot', slot: 'p' } })],
    })

    expect(render({ nodeStyle, readSlot: read }).text()).toBe('63.4 kW')
  })

  // 未注入时那一格显示占位符：空串看着像「这一格没配」，而实际是「没人喂读数」
  it('未注入取数槽时 slot 档显示占位符', () => {
    const nodeStyle = styleOf({
      prims: [txtOf({ src: { kind: 'slot', slot: 'p' } })],
    })

    expect(render({ nodeStyle }).text()).toBe('—')
  })

  it('label 档读的是节点显示名', () => {
    expect(render().text()).toBe('一号换热站')
  })

  it('素材解析槽一路传到 ico 图元', () => {
    const nodeStyle = styleOf({
      prims: [icoOf({ src: { kind: 'asset', ref: 'asset:7f3a' } })],
    })

    const wrapper = render({ nodeStyle, resolveIcon: (ref) => `/oss/${ref}` })

    expect(wrapper.get('img').attributes('src')).toBe('/oss/asset:7f3a')
  })

  // 未注入时那一档整枝不渲染：留一个空 src 会让浏览器把当前页地址再请求一遍
  it('未注入素材解析槽时 asset 档不渲染', () => {
    const nodeStyle = styleOf({
      prims: [icoOf({ src: { kind: 'asset', ref: 'asset:7f3a' } })],
    })

    expect(render({ nodeStyle }).find('img').exists()).toBe(false)
  })
})

describe('field 一档的条件读到的是节点字段，不是 tags', () => {
  /** 一枚只有 `when` 不同的文本图元，配上一份只挂它的样式 */
  function labelStyle(when: Twin2dTxtPrim['when']): Twin2dNodeStyle {
    return styleOf({ prims: [txtOf({ id: 'outer', when })] })
  }

  it('labelPos 落在名单里才渲染，落在别档整枝不渲染', () => {
    const when: Twin2dTxtPrim['when'] = {
      kind: 'field',
      field: 'labelPos',
      test: 'in',
      in: ['left', 'right'],
    }

    expect(
      render({
        node: nodeOf({ labelPos: 'left' }),
        nodeStyle: labelStyle(when),
      }).text(),
    ).toBe('一号换热站')
    expect(
      render({
        node: nodeOf({ labelPos: 'bottom' }),
        nodeStyle: labelStyle(when),
      }).text(),
    ).toBe('')
  })

  // ⚠ 少了这一条，角标就得在渲染层写一句 `v-if="node.badge"`，而那正是「预置数据
  //   长回渲染分支」的第一步
  it('badge 有值才渲染，且文本取的就是 node.badge', () => {
    const when: Twin2dTxtPrim['when'] = {
      kind: 'field',
      field: 'badge',
      test: 'present',
      in: [],
    }
    const nodeStyle = styleOf({
      prims: [txtOf({ id: 'badge-text', when, src: { kind: 'badge' } })],
    })

    expect(render({ node: nodeOf({ badge: 'A1' }), nodeStyle }).text()).toBe(
      'A1',
    )
    expect(render({ node: nodeOf({ badge: '' }), nodeStyle }).text()).toBe('')
  })

  it('同名 tag 顶不掉节点字段', () => {
    const when: Twin2dTxtPrim['when'] = {
      kind: 'field',
      field: 'labelPos',
      test: 'in',
      in: ['left'],
    }

    expect(
      render({
        node: nodeOf({ labelPos: 'bottom', tags: { labelPos: 'left' } }),
        nodeStyle: labelStyle(when),
      }).text(),
    ).toBe('')
  })
})
