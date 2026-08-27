/**
 * @fileoverview 守 2D 孪生模块壳的渲染契约：七个配置键真的读到了、逐槽取数四档在墙上
 * 各自可辨（那一格自己变色 + 角上一枚整块汇总角标）、实时状态覆盖静态状态而「无数据」
 * 不覆盖、连线取值归一，以及配了联动才吞冒泡。
 * ⚠ 这几类错法既不报错也不空白：图照样画得出来，只是那一路数据永远不到。
 */
import { TWIN_2D_CONFIG_KEY, Twin2dStage } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/twin-2d-view/Component.vue'

/** 序列类来源在同步取值器那里的原话，画布上原样挂到 `title` 上。 */
const SERIES_MESSAGE = '序列要异步取数，画布上不展开'

/** 节点读数那一行的 fieldKey。 */
const READING_FIELD = 'nodeValues[0].value'

/**
 * 一个只画一格读数的样式：整个节点上只有这一个 `txt` 图元，于是节点的文本就是那一格
 * 读数本身，四档各自看得清清楚楚。
 */
const PROBE_STYLE = {
  id: 'probe',
  name: '探针',
  size: { w: 120, h: 60 },
  prims: [{ id: 'reading', kind: 'txt', src: { kind: 'slot', slot: 'temp' } }],
  slots: [{ key: 'temp', label: '温度', unit: '°C', placeholder: '--' }],
}

/** 一个节点、一条槽位的最小图。 */
const SCENE = {
  version: 1,
  canvas: { width: 400, height: 300 },
  styles: [PROBE_STYLE],
  nodes: [{ id: 'n1', styleId: 'probe', x: 20, y: 20, label: '一号' }],
}

/** 画的是一个派生槽：它自己不进绑定行，值由实时槽算出来。 */
const DERIVED_SCENE = {
  version: 1,
  canvas: { width: 400, height: 300 },
  styles: [
    {
      id: 'probe',
      name: '探针',
      size: { w: 120, h: 60 },
      prims: [{ id: 'total', kind: 'txt', src: { kind: 'slot', slot: 'sum' } }],
      slots: [
        { key: 'temp', label: '温度', unit: '°C' },
        {
          key: 'sum',
          label: '合计',
          unit: '°C',
          kind: 'derived',
          expr: {
            kind: 'sum',
            of: [
              { kind: 'slot', slot: 'temp' },
              { kind: 'lit', value: 1 },
            ],
          },
        },
      ],
    },
  ],
  nodes: [{ id: 'n1', styleId: 'probe' }],
}

/** 图元引到一个样式上根本没有的槽键。 */
const DANGLING_SCENE = {
  version: 1,
  canvas: { width: 400, height: 300 },
  styles: [
    {
      id: 'probe',
      name: '探针',
      size: { w: 120, h: 60 },
      prims: [
        { id: 'ghost', kind: 'txt', src: { kind: 'slot', slot: '打错了' } },
      ],
      slots: [{ key: 'temp', label: '温度', placeholder: '--' }],
    },
  ],
  nodes: [{ id: 'n1', styleId: 'probe' }],
}

/** 两个节点一条连线，用来看连线取值归一。 */
const LINKED_SCENE = {
  version: 1,
  canvas: { width: 400, height: 300 },
  styles: [PROBE_STYLE],
  nodes: [
    { id: 'a', styleId: 'probe', x: 20, y: 20 },
    { id: 'b', styleId: 'probe', x: 240, y: 20 },
  ],
  edges: [{ id: 'e1', from: { nodeId: 'a' }, to: { nodeId: 'b' } }],
}

/** 一张带两条标注的图：一条压在连线之下、一条盖在节点之上。 */
const MARKED_SCENE = {
  version: 1,
  canvas: { width: 400, height: 300 },
  styles: [PROBE_STYLE],
  nodes: [{ id: 'n1', styleId: 'probe' }],
  marks: [
    {
      id: 'frame',
      kind: 'rect',
      x: 8,
      y: 8,
      w: 380,
      h: 280,
      text: '一号站房',
      zOrder: 'below',
    },
    {
      id: 'title',
      kind: 'text',
      x: 120,
      y: 4,
      w: 160,
      h: 32,
      text: '系统图',
      zOrder: 'above',
    },
  ],
}

interface RenderOptions {
  config?: Record<string, unknown>
  values?: Record<string, unknown>
  meta?: Record<string, unknown>
  attach?: boolean
}

function render(options: RenderOptions = {}) {
  const props = {
    config: options.config ?? { [TWIN_2D_CONFIG_KEY]: SCENE },
    values: options.values ?? {},
    ...(options.meta === undefined ? {} : { meta: options.meta }),
  }
  return mount(Component, {
    props,
    ...(options.attach === true ? { attachTo: document.body } : {}),
  })
}

/** 舞台真正收到的那四个顶层配置键。 */
function stageView(wrapper: ReturnType<typeof render>): unknown {
  return wrapper.getComponent(Twin2dStage).props('view')
}

/** 一层标注里各条的 id，文档序。 */
function idsOf(wrapper: ReturnType<typeof render>, layer: string): string[] {
  return wrapper
    .findAll(`[data-layer="${layer}"] [data-test="mark"]`)
    .map((node) => node.attributes('data-id') ?? '')
}

/** 舞台自下而上那六层。 */
function layerOrder(wrapper: ReturnType<typeof render>): (string | null)[] {
  return [...wrapper.get('.t2-stage__viewport').element.children].map((el) =>
    el.getAttribute('data-layer'),
  )
}

/** 一格读数的显示串；节点上只有这一个图元。 */
function readingText(wrapper: ReturnType<typeof render>): string {
  return wrapper.get('.t2-node').text()
}

/** 那一格读数自己的内联样式串。 */
function readingStyle(wrapper: ReturnType<typeof render>): string {
  return wrapper.get('.t2-node .t2-prim').attributes('style') ?? ''
}

/** 那一格读数自己挂的类名。 */
function readingClasses(wrapper: ReturnType<typeof render>): readonly string[] {
  return wrapper.get('.t2-node .t2-prim').classes()
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('七个顶层配置键都在模块壳里读', () => {
  it('标题落到统一标题条上，留空就不画标题条', () => {
    const withTitle = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, title: '一号站房' },
    })

    expect(withTitle.text()).toContain('一号站房')
    expect(render().text()).not.toContain('一号站房')
  })

  it('图那一段归一化后交给舞台', () => {
    expect(render().findAll('.t2-node')).toHaveLength(1)
  })

  it('缩放方式递给舞台，认不出的值回落完整显示', () => {
    const picked = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, fitMode: 'width' },
    })
    const dirty = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, fitMode: '斜着放' },
    })

    expect(stageView(picked)).toMatchObject({ fitMode: 'width' })
    expect(stageView(dirty)).toMatchObject({ fitMode: 'contain' })
  })

  // ⚠ 留白是百分比，越界值直接进缩放倍率：夹取漏了会算出负倍率，整张图翻过来
  it('四周留白递给舞台并夹在合法区间里', () => {
    const inRange = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, fitPadding: 12 },
    })
    const tooBig = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, fitPadding: 400 },
    })

    expect(stageView(inRange)).toMatchObject({ fitPadding: 12 })
    expect(stageView(tooBig)).toMatchObject({ fitPadding: 20 })
  })

  it('关掉内置图标集时根上挂出那一档的标记', () => {
    const off = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, showSprite: false },
    })

    expect(off.get('.dt-twin2d').classes()).toContain('dt-twin2d--no-sprite')
    expect(render().get('.dt-twin2d').classes()).not.toContain(
      'dt-twin2d--no-sprite',
    )
  })

  it('流动动画总闸递给舞台，缺省是不动', () => {
    const on = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, animateFlow: true },
    })

    expect(stageView(on)).toMatchObject({ animateFlow: true })
    expect(stageView(render())).toMatchObject({ animateFlow: false })
  })

  it('流动速度递给舞台并夹在合法区间里', () => {
    const fast = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, flowSpeed: 3 },
    })
    const absurd = render({
      config: { [TWIN_2D_CONFIG_KEY]: SCENE, flowSpeed: 900 },
    })

    expect(stageView(fast)).toMatchObject({ flowSpeed: 3 })
    expect(stageView(absurd)).toMatchObject({ flowSpeed: 5 })
  })
})

describe('标注在运行态真画得出来', () => {
  // ⚠ 端到端一条：图框、标题栏、图例这些全是标注，画不出来时大屏上只少了它们，
  // 而编辑器里明明看得见——最坏的一类「配了不生效」
  it('两档 zOrder 各进各的层，DOM 顺序就是层序', () => {
    const wrapper = render({
      config: { [TWIN_2D_CONFIG_KEY]: MARKED_SCENE },
    })

    expect(idsOf(wrapper, 'marks-below')).toEqual(['frame'])
    expect(idsOf(wrapper, 'marks-above')).toEqual(['title'])
    expect(layerOrder(wrapper)).toEqual([
      'background',
      'pattern',
      'marks-below',
      'edges',
      'nodes',
      'marks-above',
    ])
  })

  it('标注的文字与几何照文档画', () => {
    const wrapper = render({
      config: { [TWIN_2D_CONFIG_KEY]: MARKED_SCENE },
    })
    const frame = wrapper.get('[data-id="frame"]')

    expect(frame.get('[data-test="mark-label"]').text()).toBe('一号站房')
    expect(frame.get('[data-test="mark-shape"]').attributes('width')).toBe(
      '380',
    )
  })
})

describe('逐槽取数四档在墙上各自可辨', () => {
  it('没配来源那一档显示槽位自己的占位符，画布上不多说一个字', () => {
    const wrapper = render({ meta: { slots: {} } })

    expect(readingText(wrapper)).toBe('--')
    expect(wrapper.find('.dt-twin2d__readout').exists()).toBe(false)
  })

  it('等首帧那一档也是占位符，另外在角上说一句还没来', () => {
    const wrapper = render({
      meta: { slots: { [READING_FIELD]: { state: 'pending' } } },
    })
    const readout = wrapper.get('.dt-twin2d__readout')

    expect(readingText(wrapper)).toBe('--')
    expect(readout.classes()).toContain('dt-twin2d__readout--pending')
    expect(readout.text()).toBe('1 个读数还没来')
    expect(readout.attributes('title')).toBeUndefined()
  })

  it('取不到那一档变色并把原因挂在 title 上', () => {
    const wrapper = render({
      meta: {
        slots: { [READING_FIELD]: { state: 'error', message: '通道断了' } },
      },
    })
    const readout = wrapper.get('.dt-twin2d__readout')

    expect(readingText(wrapper)).toBe('--')
    expect(readout.classes()).toContain('dt-twin2d__readout--error')
    expect(readout.attributes('title')).toBe('通道断了')
  })

  it('有值那一档画读数与单位，角上一个字都不多', () => {
    const wrapper = render({
      values: { nodeValues: [{ value: 36.5 }] },
      meta: { slots: { [READING_FIELD]: { state: 'ok' } } },
    })

    expect(readingText(wrapper)).toBe('36.5 °C')
    expect(wrapper.find('.dt-twin2d__readout').exists()).toBe(false)
  })

  // ⚠ 取不到时把上一帧的值留在墙上，比显示占位符危险得多：谁也看不出那个数停了
  it('取不到时不把上一帧的值留在墙上', () => {
    const wrapper = render({
      values: { nodeValues: [{ value: 36.5 }] },
      meta: { slots: { [READING_FIELD]: { state: 'error' } } },
    })

    expect(readingText(wrapper)).toBe('--')
  })

  it('没有下发逐槽结论时照常画值，设计态与独立挂载走这条', () => {
    const wrapper = render({ values: { nodeValues: [{ value: 36.5 }] } })

    expect(readingText(wrapper)).toBe('36.5 °C')
  })

  /**
   * ⚠ 派生槽自己不进绑定行（它没有数据来源），所以逐槽结论里查不到它——查不到时
   * 要照常画它算出来的值，判成「没配来源」的话，整条派生链在墙上永远是占位符。
   */
  it('派生槽不进绑定行，却照样把算出来的值画上去', () => {
    const wrapper = render({
      config: { [TWIN_2D_CONFIG_KEY]: DERIVED_SCENE },
      values: { nodeValues: [{ value: 36.5 }] },
      meta: { slots: { [READING_FIELD]: { state: 'ok' } } },
    })

    expect(readingText(wrapper)).toBe('37.5 °C')
  })

  // ⚠ 槽键拼错时回的是全局占位符而不是槽位自己那个：两者不一样才看得出
  //   「这一格没配」与「槽键拼错了」是两件事
  it('图元引到一个不存在的槽键时回全局占位符', () => {
    const wrapper = render({ config: { [TWIN_2D_CONFIG_KEY]: DANGLING_SCENE } })

    expect(readingText(wrapper)).toBe('—')
  })
})

/**
 * ⚠ 角标交代的是「整块有几格非 ok」，逐格上色交代的是「哪一格」。只剩角标那一半时，
 * 画布上「这一格的点位坏了」与「这一格从没配过」长得一模一样——本模块自报
 * `ownsStatusDisplay`，运行时不会再盖一层整格浮层来补这句话（§9.6）。
 */
describe('四档不只写在角标上，那一格自己也变', () => {
  it('取不到时变色的是那一格本身，角标同时还在', () => {
    const wrapper = render({
      meta: {
        slots: { [READING_FIELD]: { state: 'error', message: '通道断了' } },
      },
    })

    expect(readingStyle(wrapper)).toContain('color: var(--state-danger)')
    expect(wrapper.find('.dt-twin2d__readout--error').exists()).toBe(true)
  })

  it('取不到的原因也挂在那一格自己的 title 上', () => {
    const wrapper = render({
      meta: {
        slots: { [READING_FIELD]: { state: 'error', message: '通道断了' } },
      },
    })

    expect(wrapper.get('.t2-node .t2-prim').attributes('title')).toBe(
      '通道断了',
    )
  })

  // ⚠ 这两档在墙上是同一个占位符，透明度与呼吸是它们唯一的区分手段
  it('未配来源与等首帧在那一格上仍然分得开', () => {
    const unbound = render({ meta: { slots: {} } })
    const pending = render({
      meta: { slots: { [READING_FIELD]: { state: 'pending' } } },
    })

    expect(readingText(unbound)).toBe(readingText(pending))
    expect(readingStyle(unbound)).toContain('color: var(--text-disabled)')
    expect(readingStyle(unbound)).not.toContain('opacity: 0.45')
    expect(readingStyle(pending)).toContain('opacity: 0.45')
    expect(readingClasses(pending)).toContain('t2-anim-breathe')
  })

  it('有值那一档那一格不带任何档位色', () => {
    const wrapper = render({
      values: { nodeValues: [{ value: 36.5 }] },
      meta: { slots: { [READING_FIELD]: { state: 'ok' } } },
    })

    expect(readingStyle(wrapper)).not.toContain('var(--text-disabled)')
    expect(readingStyle(wrapper)).not.toContain('var(--state-danger)')
  })

  // 设计态与独立挂载没有数据线：一片灰的预览比什么都不说更容易被当成真的坏了
  it('没有下发逐槽结论时一格都不上色', () => {
    const wrapper = render({ values: { nodeValues: [{ value: 36.5 }] } })

    expect(readingStyle(wrapper)).not.toContain('var(--text-disabled)')
  })

  // ⚠ 派生槽不进绑定行、查不到 fieldKey；判成「未配来源」的话整条派生链永远是灰的
  it('派生槽算出来的值不被当成未配来源灰掉', () => {
    const wrapper = render({
      config: { [TWIN_2D_CONFIG_KEY]: DERIVED_SCENE },
      values: { nodeValues: [{ value: 36.5 }] },
      meta: { slots: { [READING_FIELD]: { state: 'ok' } } },
    })

    expect(readingStyle(wrapper)).not.toContain('var(--text-disabled)')
  })
})

describe('序列类来源在这块图上取不到数', () => {
  /**
   * ⚠ 断言的是那句原话本身而不是半匹配：文案改了要当场红一条，
   * 而不是让一句改过的话继续被放行。
   */
  it('历史来源那一档把原话挂到 title 上', () => {
    const wrapper = render({
      meta: {
        slots: { [READING_FIELD]: { state: 'error', message: SERIES_MESSAGE } },
      },
    })

    expect(wrapper.get('.dt-twin2d__readout').attributes('title')).toBe(
      '序列要异步取数，画布上不展开',
    )
  })

  it('台账来源那一档与历史是同一条分支、同一句话', () => {
    const wrapper = render({
      meta: {
        slots: { [READING_FIELD]: { state: 'error', message: SERIES_MESSAGE } },
      },
    })

    expect(wrapper.get('.dt-twin2d__readout').attributes('title')).toBe(
      '序列要异步取数，画布上不展开',
    )
  })
})

describe('实时状态归一后覆盖静态状态', () => {
  function withStatus(raw: unknown, staticStatus: string) {
    return render({
      config: {
        [TWIN_2D_CONFIG_KEY]: {
          ...SCENE,
          nodes: [{ id: 'n1', styleId: 'probe', status: staticStatus }],
        },
      },
      values: { nodeStatus: [{ status: raw }] },
    })
  }

  it('数值状态归一成节点渲染状态并盖掉配置里那一档', () => {
    expect(
      withStatus(1, 'alarm').get('.t2-node').attributes('data-status'),
    ).toBe('online')
  })

  it('现场发的词也认，告警那一组落到待机档', () => {
    expect(
      withStatus('Warning', 'online').get('.t2-node').attributes('data-status'),
    ).toBe('warning')
  })

  /**
   * ⚠ 认不出的值一律落「无数据」，而「无数据」**不覆盖**配置里的静态状态：
   * 把一个配成报警的节点洗成灰的，与把没有数据的设备显示成运行是同一类谎。
   */
  it('认不出的值不把配置里配好的状态洗掉', () => {
    expect(
      withStatus('乱码', 'alarm').get('.t2-node').attributes('data-status'),
    ).toBe('alarm')
  })

  it('一个状态点位都没绑时整图沿用配置里的状态', () => {
    const wrapper = render({
      config: {
        [TWIN_2D_CONFIG_KEY]: {
          ...SCENE,
          nodes: [{ id: 'n1', styleId: 'probe', status: 'offline' }],
        },
      },
    })

    expect(wrapper.get('.t2-node').attributes('data-status')).toBe('offline')
  })
})

describe('连线取值归一后交给舞台', () => {
  function edgeState(values: Record<string, unknown>): unknown {
    const wrapper = render({
      config: { [TWIN_2D_CONFIG_KEY]: LINKED_SCENE },
      values,
    })
    const live = wrapper.getComponent(Twin2dStage).props('live')
    return (live as { edges: Record<string, unknown> }).edges['e1']
  }

  it('真假词表与流向词表各归各的', () => {
    expect(
      edgeState({ edgeValues: [{ active: 'ON', direction: -3 }] }),
    ).toMatchObject({ active: true, reversed: true })
  })

  it('认不出的活跃值回落成活跃，不把一条好线画成灰的', () => {
    expect(edgeState({ edgeValues: [{ active: '说不好' }] })).toMatchObject({
      active: true,
    })
  })

  it('标签读数格式化后进连线标签，没绑就留空', () => {
    expect(edgeState({ edgeValues: [{ value: 12.34 }] })).toMatchObject({
      label: '12.3',
    })
    expect(edgeState({})).toBeUndefined()
  })
})

describe('联动上抛与冒泡', () => {
  it('点节点上抛的是节点 id，不是显示名', async () => {
    const wrapper = render()

    await wrapper.get('.t2-node').trigger('click')

    expect(wrapper.emitted('interaction')).toEqual([
      [{ event: 'select', value: 'n1' }],
    ])
  })

  it('点在没有节点的地方一个事件都不发', async () => {
    const wrapper = render()

    await wrapper.get('.dt-twin2d').trigger('click')

    expect(wrapper.emitted('interaction')).toBeUndefined()
  })

  // ⚠ 两边都吞或都不吞，toggle 类动作会被整块兜底再捕获一次而当场自我抵消
  it('配了联动规则才吞冒泡', async () => {
    const spy = vi.fn()
    document.body.addEventListener('click', spy)
    const wrapper = render({ meta: { interactive: true }, attach: true })

    await wrapper.get('.t2-node').trigger('click')

    expect(spy).not.toHaveBeenCalled()
    wrapper.unmount()
    document.body.removeEventListener('click', spy)
  })

  it('没配联动规则时照旧让点击冒上去', async () => {
    const spy = vi.fn()
    document.body.addEventListener('click', spy)
    const wrapper = render({ attach: true })

    await wrapper.get('.t2-node').trigger('click')

    expect(spy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    document.body.removeEventListener('click', spy)
  })
})

describe('空文档', () => {
  // 取不到就说取不到：绝不留一块什么都不说的空画布
  it('一个节点都没画时给一句话而不是一片空白', () => {
    const wrapper = render({ config: {} })

    expect(wrapper.get('.t2-stage__empty').text()).not.toBe('')
    expect(wrapper.findAll('.t2-node')).toHaveLength(0)
  })
})
