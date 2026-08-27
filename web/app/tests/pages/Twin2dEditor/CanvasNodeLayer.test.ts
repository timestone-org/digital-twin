/**
 * @fileoverview 契约：节点层一次手势只抛一次 `change`（落 commit 归上层，一手势一步
 * 撤销）、拖到一半被卸载要补上这一次、手势收场之后不再接管指针，以及 sprite 宿主一份
 * 都不在这一层。另锁选中、旋转四档与端口点。
 *
 * ⚠ 逐帧抛不报错，只是撤销键从此按不回上一步——拖一个节点就能塞进几百帧。
 * ⚠ 卸载不补收场同样不报错：拖到一半切走的改动既没进撤销栈也没落库。
 * ⚠ sprite 宿主由画布壳挂一次：这一层再挂一份，同一份 symbol 在文档里就重号了。
 */
import { Twin2dNodeBox } from '@dt/twin2d'
import type {
  Twin2dIconResolver,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dPortAt,
  Twin2dSide,
} from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import CanvasNodeLayer from '@/pages/Twin2dEditor/components/CanvasNodeLayer.vue'
import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'
import type { Twin2dSnapOptions } from '@/pages/Twin2dEditor/scripts/snapping'
import { useCanvasPointer } from '@/pages/Twin2dEditor/scripts/useCanvasPointer'

/** 节点的设计尺寸 */
const SIZE = { w: 40, h: 20 }

/** 关掉吸附的那一档：位移原样落地，断言里不必再算网格 */
const FREE: Twin2dSnapOptions = { ...TWIN_2D_DEFAULT_SNAP, enabled: false }

function makePort(id: string, at: Twin2dPortAt, side: Twin2dSide): Twin2dPort {
  return {
    id,
    name: id.toUpperCase(),
    at,
    dir: 'passive',
    side,
    showName: false,
    marker: null,
  }
}

const STYLE: Twin2dNodeStyle = {
  id: 's1',
  name: '二极管',
  category: 'circuit',
  accent: 'var(--accent-primary)',
  defaultStatus: 'hidden',
  size: SIZE,
  prims: [],
  ports: [
    makePort('a', { kind: 'xy', x: 0, y: 0.5 }, 'left'),
    makePort('k', { kind: 'xy', x: 1, y: 0.5 }, 'right'),
  ],
  slots: [],
  variants: [],
}

const BASE_NODE: Twin2dNode = {
  id: 'n1',
  styleId: 's1',
  x: 100,
  y: 50,
  w: 40,
  h: 20,
  rotate: 0,
  flipX: false,
  flipY: false,
  label: '',
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

function makeNode(over: Partial<Twin2dNode> = {}): Twin2dNode {
  return { ...BASE_NODE, ...over }
}

/** 第二个节点摆得离第一个远远的，免得吸附把它俩牵到一起 */
const NODE_B = makeNode({ id: 'n2', x: 300, y: 200 })

interface LayerProps {
  nodes: readonly Twin2dNode[]
  nodeStyles: readonly Twin2dNodeStyle[]
  selectedIds: readonly string[]
  snap: Twin2dSnapOptions
  scale: number
  resolveIcon?: Twin2dIconResolver
}

/** 层里抛出来的三类事件，加上冒到画布壳上的那几下按 */
interface Seen {
  changes: (readonly Twin2dNode[])[]
  picks: [string, boolean][]
  ports: [string, string][]
  /** ⚠ 接下的那一按必须停在这一层，冒上去就会被画布壳当成「点了空白」 */
  bubbled: number
}

interface Harness {
  wrapper: VueWrapper
  seen: Seen
}

/**
 * 装一层节点层。
 * ⚠ 手势状态机装在**外层**：画布壳持有、各层共用同一台，卸载补收场也是它做的。
 */
function mountLayer(over: Partial<LayerProps> = {}): Harness {
  const seen: Seen = { changes: [], picks: [], ports: [], bubbled: 0 }
  const props: LayerProps = {
    nodes: [makeNode()],
    nodeStyles: [STYLE],
    selectedIds: [],
    snap: FREE,
    scale: 1,
    ...over,
  }
  const host = defineComponent({
    setup() {
      // 视口不缩不移，client 坐标直接当设计坐标用
      const pointer = useCanvasPointer({
        toDesign: (at) => ({ x: at.clientX, y: at.clientY }),
      })
      // 外面这一层站的是画布壳：本层是它的子节点，冒不冒得上去才有得看
      return () =>
        h('div', [
          h(CanvasNodeLayer, {
            ...props,
            startGesture: pointer.start,
            onPick: (id: string, additive: boolean) => {
              seen.picks.push([id, additive])
            },
            onChange: (nodes: readonly Twin2dNode[]) => {
              seen.changes.push(nodes)
            },
            onPortGrab: (nodeId: string, portId: string) => {
              seen.ports.push([nodeId, portId])
            },
          }),
        ])
    },
  })
  const wrapper: VueWrapper = mount(host)
  // 冒泡记在本层根上：接下的那一按在节点身上就停住了，冒不到这里
  // ⚠ 只能用原生监听记：Vue 挂上去的处理器会按 `_vts` 丢掉「与挂载同一毫秒里发出」
  // 的事件，拿它记冒泡的用例单跑绿、整份跑红
  wrapper
    .get('[data-test="node-layer"]')
    .element.addEventListener('pointerdown', () => {
      seen.bubbled += 1
    })
  return { wrapper, seen }
}

function nodeEl(wrapper: VueWrapper, id: string): Element {
  return wrapper.get(`[data-test="node"][data-id="${id}"]`).element
}

function down(
  el: Element,
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  el.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: x,
      clientY: y,
      bubbles: true,
      ...init,
    }),
  )
}

function fire(
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  window.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, ...init }),
  )
}

/** 一次完整的拖动：起手 → 一帧 → 松手 */
function dragBy(
  el: Element,
  from: readonly [number, number],
  to: readonly [number, number],
  init: PointerEventInit = {},
): void {
  down(el, from[0], from[1], init)
  fire('pointermove', to[0], to[1], init)
  fire('pointerup', to[0], to[1], init)
}

describe('画节点', () => {
  it('每个节点画一次，复用同一个渲染件', () => {
    const { wrapper } = mountLayer({ nodes: [makeNode(), NODE_B] })

    expect(wrapper.findAll('[data-test="node"]')).toHaveLength(2)
    expect(nodeEl(wrapper, 'n1').getAttribute('style')).toContain(
      'translate(100px, 50px)',
    )
  })

  // ⚠ 造一个空壳出来会在图上留一块吃指针的透明区，而看不出它是谁
  it('样式悬空的节点整个不画', () => {
    const { wrapper } = mountLayer({
      nodes: [makeNode(), makeNode({ id: 'n2', styleId: 'gone' })],
    })

    expect(wrapper.findAll('[data-test="node"]')).toHaveLength(1)
  })

  it('选中的节点带选中类，没选中的不带', () => {
    const { wrapper } = mountLayer({
      nodes: [makeNode(), NODE_B],
      selectedIds: ['n1'],
    })

    expect(nodeEl(wrapper, 'n1').classList.contains('t2e-node--picked')).toBe(
      true,
    )
    expect(nodeEl(wrapper, 'n2').classList.contains('t2e-node--picked')).toBe(
      false,
    )
  })

  // ⚠ 图元少了盒尺寸会按 1×1 画，而 prop 名写错时 typecheck 与 lint 双双放行
  it('把素材解析槽原样递给渲染件', () => {
    const resolveIcon: Twin2dIconResolver = (ref) => `/oss/${ref}`

    const { wrapper } = mountLayer({ resolveIcon })

    expect(wrapper.findComponent(Twin2dNodeBox).props('resolveIcon')).toBe(
      resolveIcon,
    )
  })

  it('选中框与手柄按倍率反着缩，缩小时不跟着变成一个点', () => {
    const { wrapper } = mountLayer({ scale: 3 })

    expect(
      wrapper.get('[data-test="node-layer"]').attributes('style'),
    ).toContain('--t2e-dot: 3px')
  })
})

describe('sprite 宿主', () => {
  // ⚠ 宿主归画布壳挂：这一层再挂一份，同一份 symbol 在文档里就重号，而浏览器
  // 只认头一个——两份不同版本的图标集并存时，看到的是哪一份全凭挂载先后
  it('一份都不在这一层', () => {
    const { wrapper } = mountLayer()

    expect(wrapper.findAll('.twin2d-icon-sprite')).toHaveLength(0)
  })
})

describe('一手势一步撤销', () => {
  it('拖过几十帧也只在松手那一下落一次 commit', () => {
    const { wrapper, seen } = mountLayer()

    down(nodeEl(wrapper, 'n1'), 100, 60)
    for (let step = 1; step <= 30; step += 1)
      fire('pointermove', 100 + step, 60)

    expect(seen.changes).toHaveLength(0)

    fire('pointerup', 130, 60)

    expect(seen.changes).toHaveLength(1)
    expect(seen.changes[0]?.[0]).toMatchObject({ x: 130, y: 50 })
  })

  it('手势期间画面上已经是新位置，落库还一次都没有', async () => {
    const { wrapper, seen } = mountLayer()

    down(nodeEl(wrapper, 'n1'), 100, 60)
    fire('pointermove', 130, 60)
    await nextTick()

    expect(nodeEl(wrapper, 'n1').getAttribute('style')).toContain(
      'translate(130px, 50px)',
    )
    expect(seen.changes).toHaveLength(0)
  })

  // ⚠ 不补这一次，拖到一半切走的改动既没进撤销栈也没落库
  it('拖到一半被卸载，补落一次 commit', () => {
    const { wrapper, seen } = mountLayer()

    down(nodeEl(wrapper, 'n1'), 100, 60)
    fire('pointermove', 140, 60)

    expect(seen.changes).toHaveLength(0)

    wrapper.unmount()

    expect(seen.changes).toHaveLength(1)
    expect(seen.changes[0]?.[0]).toMatchObject({ x: 140, y: 50 })
  })

  /**
   * ⚠ 监听没摘干净的表现很隐蔽：松手之后整站的指针事件都还在被这一层接着改图。
   * ⚠ 断言看的是「松手之后」而不是「卸载之后」：卸载之后组件抛出来的事件会被 Vue
   * 自己吞掉（`isUnmounted` 那道门），拿它断言什么都测不出来。
   */
  it('松手之后再来的指针事件不再改这张图', async () => {
    const { wrapper, seen } = mountLayer()

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [140, 60])
    fire('pointermove', 200, 60)
    fire('pointerup', 200, 60)
    await nextTick()

    expect(seen.changes).toHaveLength(1)
    expect(nodeEl(wrapper, 'n1').getAttribute('style')).toContain(
      'translate(100px, 50px)',
    )
  })

  it('被取消的手势退回去，一次 commit 都不落', async () => {
    const { wrapper, seen } = mountLayer()

    down(nodeEl(wrapper, 'n1'), 100, 60)
    fire('pointermove', 140, 60)
    fire('pointercancel', 140, 60)
    await nextTick()

    expect(seen.changes).toHaveLength(0)
    expect(nodeEl(wrapper, 'n1').getAttribute('style')).toContain(
      'translate(100px, 50px)',
    )
  })

  // ⚠ 起手阈值之内还算「点一下」：这一下也吸网格的话，点谁谁跳一格
  it('没越过起手阈值的一下不落库', () => {
    const { wrapper, seen } = mountLayer({ snap: TWIN_2D_DEFAULT_SNAP })

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [102, 60])

    expect(seen.changes).toHaveLength(0)
  })
})

describe('拖动', () => {
  it('多选时整批一起挪同一个差值', () => {
    const { wrapper, seen } = mountLayer({
      nodes: [makeNode(), NODE_B],
      selectedIds: ['n1', 'n2'],
    })

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [140, 70])

    expect(seen.changes[0]).toMatchObject([
      { id: 'n1', x: 140, y: 60 },
      { id: 'n2', x: 340, y: 210 },
    ])
  })

  it('按住 Shift 只走位移大的那根轴', () => {
    const { wrapper, seen } = mountLayer()

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [140, 65], { shiftKey: true })

    expect(seen.changes[0]?.[0]).toMatchObject({ x: 140, y: 50 })
  })

  it('按住 Shift 竖着拖就只走竖轴', () => {
    const { wrapper, seen } = mountLayer()

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [105, 100], { shiftKey: true })

    expect(seen.changes[0]?.[0]).toMatchObject({ x: 100, y: 90 })
  })

  it('按住 Alt 的那一帧不吸附', () => {
    const { wrapper, seen } = mountLayer({ snap: TWIN_2D_DEFAULT_SNAP })

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [107, 60], { altKey: true })

    expect(seen.changes[0]?.[0]).toMatchObject({ x: 107 })
  })

  // ⚠ 落回原处却换了一份新表的话，撤销栈上就留下一格什么都没变的空步
  it('吸回原来那一格的一下不落库', () => {
    const { wrapper, seen } = mountLayer({
      nodes: [makeNode({ x: 100, y: 40 })],
      snap: TWIN_2D_DEFAULT_SNAP,
    })

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [105, 60])

    expect(seen.changes).toHaveLength(0)
  })

  it('竖着对齐时画的是一条竖线', async () => {
    const { wrapper } = mountLayer({
      nodes: [makeNode(), makeNode({ id: 'n2', x: 100, y: 300 })],
      snap: TWIN_2D_DEFAULT_SNAP,
    })

    down(nodeEl(wrapper, 'n1'), 100, 60)
    fire('pointermove', 105, 60)
    await nextTick()

    expect(
      wrapper.get('[data-test="node-guide"]').attributes('style'),
    ).toContain('left: 100px')
  })

  it('吸到同级节点的边线上，并把这一帧的参考线画出来', async () => {
    const { wrapper, seen } = mountLayer({
      nodes: [makeNode(), makeNode({ id: 'n2', x: 300, y: 50 })],
      snap: TWIN_2D_DEFAULT_SNAP,
    })

    down(nodeEl(wrapper, 'n1'), 100, 60)
    fire('pointermove', 127, 63)
    await nextTick()

    const guide = wrapper.get('[data-test="node-guide"]')
    expect(guide.attributes('style')).toContain('top: 50px')

    fire('pointerup', 127, 63)
    await nextTick()

    expect(seen.changes[0]?.[0]).toMatchObject({ x: 120, y: 50 })
    expect(wrapper.findAll('[data-test="node-guide"]')).toHaveLength(0)
  })
})

describe('这一按归谁', () => {
  it('接下的那一按停在本层，不冒到画布壳上', () => {
    const { wrapper, seen } = mountLayer()

    down(nodeEl(wrapper, 'n1'), 100, 60)

    expect(seen.bubbled).toBe(0)
    expect(seen.picks).toEqual([['n1', false]])
  })

  // ⚠ 一并吞掉的表现是「按在节点上就平移不了」，而按在空白处一切正常
  it('中键照常冒上去给画布壳平移，也不起拖动', () => {
    const { wrapper, seen } = mountLayer()

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [140, 60], { button: 1 })

    expect(seen.bubbled).toBe(1)
    expect(seen.picks).toEqual([])
    expect(seen.changes).toHaveLength(0)
  })

  it('中键按在手柄与端口点上一样不接', () => {
    const { wrapper, seen } = mountLayer({ selectedIds: ['n1'] })

    down(wrapper.get('[data-test="node-rotate"]').element, 120, 28, {
      button: 1,
    })
    down(wrapper.get('[data-test="node-port"][data-id="a"]').element, 100, 60, {
      button: 1,
    })

    expect(seen.ports).toEqual([])
    expect(seen.bubbled).toBe(2)
  })

  it('端口点接下的那一按同样不冒上去', () => {
    const { wrapper, seen } = mountLayer({ selectedIds: ['n1'] })

    down(wrapper.get('[data-test="node-port"][data-id="a"]').element, 100, 60)

    expect(seen.bubbled).toBe(0)
    expect(seen.ports).toEqual([['n1', 'a']])
  })
})

describe('点选', () => {
  it('点一个没选中的节点，先选中它再开拖', () => {
    const { wrapper, seen } = mountLayer({ nodes: [makeNode(), NODE_B] })

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [140, 60])

    expect(seen.picks).toEqual([['n1', false]])
    expect(seen.changes).toHaveLength(1)
  })

  it('Ctrl 点是加选，不起拖动', () => {
    const { wrapper, seen } = mountLayer()

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [140, 60], { ctrlKey: true })

    expect(seen.picks).toEqual([['n1', true]])
    expect(seen.changes).toHaveLength(0)
  })

  it('⌘ 点同样是加选', () => {
    const { wrapper, seen } = mountLayer()

    down(nodeEl(wrapper, 'n1'), 100, 60, { metaKey: true })
    fire('pointerup', 100, 60, { metaKey: true })

    expect(seen.picks).toEqual([['n1', true]])
  })

  // ⚠ 起手就收窄的话，多选之后一拖就只剩一个节点在动
  it('点已选中的节点没挪动，松手才收窄成单选', () => {
    const { wrapper, seen } = mountLayer({
      nodes: [makeNode(), NODE_B],
      selectedIds: ['n1', 'n2'],
    })

    down(nodeEl(wrapper, 'n1'), 100, 60)
    fire('pointerup', 100, 60)

    expect(seen.picks).toEqual([['n1', false]])
  })

  it('点已选中的节点并拖动，整批选中不动', () => {
    const { wrapper, seen } = mountLayer({
      nodes: [makeNode(), NODE_B],
      selectedIds: ['n1', 'n2'],
    })

    dragBy(nodeEl(wrapper, 'n1'), [100, 60], [140, 60])

    expect(seen.picks).toEqual([])
    expect(seen.changes).toHaveLength(1)
  })
})

describe('旋转手柄', () => {
  it('只在单选时给，多选不给', () => {
    const single = mountLayer({ selectedIds: ['n1'] })
    const many = mountLayer({
      nodes: [makeNode(), NODE_B],
      selectedIds: ['n1', 'n2'],
    })

    expect(single.wrapper.findAll('[data-test="node-rotate"]')).toHaveLength(1)
    expect(many.wrapper.findAll('[data-test="node-rotate"]')).toHaveLength(0)
  })

  // ⚠ 任意角度会让正交走线失去意义、端口吸附点变成无理数
  it('拖过一个直角只进一档，落一次 commit', () => {
    const { wrapper, seen } = mountLayer({ selectedIds: ['n1'] })

    dragBy(
      wrapper.get('[data-test="node-rotate"]').element,
      [120, 28],
      [152, 60],
    )

    expect(seen.changes).toHaveLength(1)
    expect(seen.changes[0]?.[0]).toMatchObject({ rotate: 90, x: 100, y: 50 })
  })

  it('转回原来那一档就不落库，不在撤销栈上留空步', () => {
    const { wrapper, seen } = mountLayer({ selectedIds: ['n1'] })

    dragBy(
      wrapper.get('[data-test="node-rotate"]').element,
      [120, 28],
      [120, 18],
    )

    expect(seen.changes).toHaveLength(0)
  })

  it('按一下手柄就松开，什么都不落', () => {
    const { wrapper, seen } = mountLayer({ selectedIds: ['n1'] })

    dragBy(
      wrapper.get('[data-test="node-rotate"]').element,
      [120, 28],
      [121, 28],
    )

    expect(seen.changes).toHaveLength(0)
  })

  it('选中的那个节点样式悬空时也不给手柄', () => {
    const { wrapper } = mountLayer({
      nodes: [makeNode({ styleId: 'gone' })],
      selectedIds: ['n1'],
    })

    expect(wrapper.findAll('[data-test="node-rotate"]')).toHaveLength(0)
  })

  it('手柄跟着节点的位姿转到侧面去', () => {
    const { wrapper } = mountLayer({
      nodes: [makeNode({ rotate: 90 })],
      selectedIds: ['n1'],
    })

    expect(
      wrapper.get('[data-test="node-rotate"]').attributes('style'),
    ).toContain('left: 152px')
  })
})

describe('端口点', () => {
  it('只画选中节点的端口', () => {
    const { wrapper } = mountLayer({
      nodes: [makeNode(), NODE_B],
      selectedIds: ['n1'],
    })

    const dots = wrapper.findAll('[data-test="node-port"]')
    expect(dots).toHaveLength(2)
    expect(dots.map((dot) => dot.attributes('data-node'))).toEqual(['n1', 'n1'])
  })

  it('一个都没选中时不画端口', () => {
    const { wrapper } = mountLayer()

    expect(wrapper.findAll('[data-test="node-port"]')).toHaveLength(0)
  })

  it('端口点落在引脚上，朝向跟着节点转', () => {
    const { wrapper } = mountLayer({
      nodes: [makeNode({ rotate: 90 })],
      selectedIds: ['n1'],
    })

    const dot = wrapper.get('[data-test="node-port"][data-id="a"]')
    expect(dot.attributes('style')).toContain('left: 120px')
    expect(dot.attributes('data-side')).toBe('top')
  })

  it('从端口点起手交给连线层，不当成拖节点', () => {
    const { wrapper, seen } = mountLayer({ selectedIds: ['n1'] })

    dragBy(
      wrapper.get('[data-test="node-port"][data-id="a"]').element,
      [100, 60],
      [180, 60],
    )

    expect(seen.ports).toEqual([['n1', 'a']])
    expect(seen.changes).toHaveLength(0)
  })
})
