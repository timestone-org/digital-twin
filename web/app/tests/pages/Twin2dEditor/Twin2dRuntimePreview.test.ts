/**
 * @fileoverview 契约：画布角上的画中画按这块在大屏上的宽高比画当前草稿，走的是
 * 运行态那一条渲染链，并且取数与运行态同源。
 *
 * ⚠ 框必须与大屏格子同比例、内容按设计像素缩放：不缩的话同一份配置里的字号与留白
 * 在小框里占的比例远大于大屏上，预览等于白预览。
 * ⚠ 草稿注回的键来自清单，模块类型来自节点行——两者写死的话，这一页就不再是
 * 「谁声明了子编辑器就编谁」，而换个模块进来只表现为预览画的是存量配置。
 * ⚠ 取不到读数要说出口：一块空白既可能是没绑点位，也可能是绑了还没保存，两者查法不同。
 * ⚠ 用真注册表而不是替身：`getModule` 换成假的之后，「清单没声明子编辑器」这条
 * 退路就只在替身上成立，而它正是真注册表当下的样子。
 */
import type {
  BindingView,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { __resetProviders } from '@dt/datasources'
import { registerModule } from '@dt/modules'
import { useRuntimeData } from '@dt/runtime'
import { TWIN_2D_CONFIG_KEY, normalizeTwin2dConfig } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'

import { installDashboardModules } from '@/bootstrap/dashboard'
import Twin2dRuntimePreview from '@/pages/Twin2dEditor/components/Twin2dRuntimePreview.vue'

type PointListener = (nodeKey: string, sample: unknown) => void

let emit: PointListener = () => undefined

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({ subscribe: () => () => undefined }),
}))

vi.mock('@/runtime/pointStream', () => ({
  createPointSubscribe:
    (_channel: unknown, topicOf: () => string | null) =>
    (_keys: readonly string[], onValue: PointListener) => {
      if (topicOf() === null) return () => undefined
      emit = onValue
      return () => undefined
    },
}))

/** 清单上声明了子编辑器：草稿该注回它说的那个键。 */
const DECLARED: ModuleManifest = {
  type: 'x-declared',
  displayName: '声明了子编辑器的模块',
  category: '孪生',
  defaultSize: { width: 1280, height: 480 },
  configSchema: [],
  bindings: [],
  subEditor: {
    configKey: 'painted',
    routeName: 'twin-2d-editor',
    label: '打开 2D 孪生编辑器',
  },
  component: () => Promise.resolve({ default: {} }),
}

/** 清单还没声明子编辑器：退回本页读写用的那个键。 */
const UNDECLARED: ModuleManifest = {
  type: 'x-undeclared',
  displayName: '还没声明子编辑器的模块',
  category: '孪生',
  defaultSize: { width: 1280, height: 480 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

installDashboardModules()
registerModule(DECLARED)
registerModule(UNDECLARED)

const DRAFT = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600 },
  nodes: [
    { id: 'n-hx', styleId: 'heat-exchanger', x: 10, y: 10, label: '换热站' },
  ],
})

const BOUND: BindingView = {
  id: 'b1',
  fieldKey: 'nodeValues[0].value',
  sourceKind: 'opcua',
  nodeKey: 'src-1:PT101',
  staticValueJson: null,
  computeJson: null,
  transformJson: null,
  detailJson: null,
}

const READING = {
  state: 'ok' as const,
  value: 3.5,
  timestampMs: 7,
  quality: 'good' as const,
}

function node(
  overrides: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'x-declared',
    x: 0,
    y: 0,
    w: 1280,
    h: 480,
    zIndex: 1,
    isVisible: true,
    configJson: { title: '余热系统', painted: { version: 1, nodes: [] } },
    bindings: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

/** 替身渲染件：把注入下来的读取器对一条绑定求值的结果画成文字。 */
const RendererStub = defineComponent({
  name: 'ModuleRenderer',
  props: {
    moduleType: { type: String, default: '' },
    config: {
      type: Object as PropType<Record<string, unknown>>,
      default: null,
    },
    bindings: { type: Array as PropType<BindingView[]>, default: null },
    nodeId: { type: String, default: '' },
    getManifest: {
      type: Function as PropType<(type: string) => ModuleManifest | undefined>,
      default: null,
    },
  },
  setup() {
    const runtime = useRuntimeData()
    return () =>
      h(
        'span',
        { 'data-test': 'renderer-slot' },
        JSON.stringify(runtime.readBinding()(BOUND, {})),
      )
  },
})

function mountPreview(props: Record<string, unknown> = {}) {
  return mount(Twin2dRuntimePreview, {
    props: { node: node(), config: DRAFT, bindings: [], ...props },
    global: { stubs: { ModuleRenderer: RendererStub } },
  })
}

async function opened(props: Record<string, unknown> = {}) {
  const wrapper = mountPreview(props)
  await wrapper.get('[data-test="open-preview"]').trigger('click')
  return wrapper
}

function rendererOf(wrapper: ReturnType<typeof mountPreview>) {
  return wrapper.getComponent({ name: 'ModuleRenderer' })
}

beforeEach(() => {
  __resetProviders()
  emit = () => undefined
})

describe('开关', () => {
  it('缺省收着，一格运行态渲染都不挂', () => {
    const wrapper = mountPreview()

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
  })

  it('点开才挂上运行态渲染', async () => {
    const wrapper = await opened()

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(true)
  })

  it('关掉就卸下来', async () => {
    const wrapper = await opened()

    await wrapper.get('[data-test="close-preview"]').trigger('click')

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
  })
})

describe('比例', () => {
  it('框按大屏格子的宽高比缩，不是按一个固定比例', async () => {
    const wrapper = await opened()

    const style = wrapper.get('[data-test="preview-box"]').attributes('style')
    expect(style).toContain('width: 320px')
    expect(style).toContain('height: 120px')
  })

  it('竖长的格子照样按它自己的比例', async () => {
    const wrapper = await opened({ node: node({ w: 400, h: 800 }) })

    const style = wrapper.get('[data-test="preview-box"]').attributes('style')
    expect(style).toContain('width: 110px')
    expect(style).toContain('height: 220px')
  })

  it('放大档还是同一个比例，只是更大', async () => {
    const wrapper = await opened()

    await wrapper.get('[data-test="toggle-wide"]').trigger('click')

    const style = wrapper.get('[data-test="preview-box"]').attributes('style')
    expect(style).toContain('width: 760px')
    expect(style).toContain('height: 285px')
  })

  it('里层按设计像素铺开，再整体缩到框那么大', async () => {
    const wrapper = await opened()

    const style = wrapper.get('.twin2d-preview__stage').attributes('style')
    expect(style).toContain('width: 1280px')
    expect(style).toContain('height: 480px')
    expect(style).toContain('scale(0.25)')
  })

  it('条上写着这块在大屏上占多大', async () => {
    const wrapper = await opened()

    expect(wrapper.text()).toContain('1280 × 480')
  })
})

describe('喂给模块的那一袋', () => {
  it('草稿注回清单声明的那个键，其余配置原样带上', async () => {
    const wrapper = await opened()

    expect(rendererOf(wrapper).props('config')).toEqual({
      title: '余热系统',
      painted: DRAFT,
    })
  })

  it('模块类型来自节点行，不是这一页写死的', async () => {
    const wrapper = await opened({ node: node({ moduleType: 'x-undeclared' }) })

    expect(rendererOf(wrapper).props('moduleType')).toBe('x-undeclared')
  })

  // ⚠ 清单没声明子编辑器时退回本页读写用的那个键：预览注回的键必须与落库写回的
  // 键是同一个，否则预览画的是存量配置、保存写的是另一处，而两边都不报错
  it('清单没声明子编辑器时，注回的是本页读写用的那个键', async () => {
    const wrapper = await opened({ node: node({ moduleType: 'x-undeclared' }) })

    expect(rendererOf(wrapper).props('config')).toEqual({
      title: '余热系统',
      painted: { version: 1, nodes: [] },
      [TWIN_2D_CONFIG_KEY]: DRAFT,
    })
  })

  it('绑定与节点 id 一并透传，联动与 meta 才认得出这一格', async () => {
    const wrapper = await opened({ bindings: [BOUND] })

    expect(rendererOf(wrapper).props('bindings')).toEqual([BOUND])
    expect(rendererOf(wrapper).props('nodeId')).toBe('n1')
  })
})

describe('预览不了的时候', () => {
  it('模块没注册就直说，不留一块空白', async () => {
    const wrapper = await opened({ node: node({ moduleType: 'x-missing' }) })

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="preview-blocked"]').text()).toContain(
      '预览不了',
    )
  })

  it('大屏上取不到尺寸时也直说', async () => {
    const wrapper = await opened({ node: node({ w: 0 }) })

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="preview-blocked"]').exists()).toBe(true)
  })

  it('配置还没读出来时也直说', async () => {
    const wrapper = await opened({ config: null })

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="preview-blocked"]').exists()).toBe(true)
  })

  it('节点还没读出来时连尺寸读数都不编一个', async () => {
    const wrapper = await opened({ node: null })

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('×')
  })
})

describe('取数与运行态同源', () => {
  it('还没收到快照时模块读到的是「在等」，不是一个空值', async () => {
    const wrapper = await opened({ bindings: [BOUND] })

    expect(wrapper.get('[data-test="renderer-slot"]').text()).toBe(
      JSON.stringify({ state: 'pending' }),
    )
  })

  it('推来一帧之后模块当场读到那个值', async () => {
    const wrapper = await opened({ bindings: [BOUND] })

    emit('src-1:PT101', READING)
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-test="renderer-slot"]').text()).toBe(
      JSON.stringify({ state: 'ok', value: 3.5, timestampMs: 7 }),
    )
  })

  it('绑了点位却没数时说清是在等，并报出等着几个', async () => {
    const wrapper = await opened({ bindings: [BOUND] })

    const line = wrapper.get('[data-test="preview-live"]')
    expect(line.text()).toContain('还没收到读数')
    expect(line.text()).toContain('0/1')
    expect(line.attributes('data-state')).toBe('waiting')
  })

  it('收到之后改口说在推', async () => {
    const wrapper = await opened({ bindings: [BOUND] })

    emit('src-1:PT101', READING)
    await wrapper.vm.$nextTick()

    const line = wrapper.get('[data-test="preview-live"]')
    expect(line.text()).toContain('1/1')
    expect(line.attributes('data-state')).toBe('live')
  })

  it('一条实时绑定都没有时说的是「没绑」，不报比例', async () => {
    const wrapper = await opened()

    const line = wrapper.get('[data-test="preview-live"]')
    expect(line.text()).toBe('这张图没有绑实时点位')
    expect(line.attributes('data-state')).toBe('idle')
  })
})

describe('挂的确实是运行态那条链', () => {
  /**
   * ⚠ 不停一个固定的毫秒数等它：模块组件是按需 `import()` 进来的，等一个拍脑袋的
   * 时长在忙一点的机器上就是一条随机红灯。轮询到出现为止。
   */
  async function mountReal() {
    const wrapper = mount(Twin2dRuntimePreview, {
      props: {
        node: node({
          moduleType: 'twin-2d-view',
          configJson: { title: '余热系统' },
        }),
        config: DRAFT,
        bindings: [],
      },
    })
    await wrapper.get('[data-test="open-preview"]').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="preview-box"]').text()).not.toBe('')
    })
    return wrapper
  }

  // 标题条、卡片外框这些都长在模块里，在这里另拼一份必然与大屏上那一份漂开
  it('模块自己的标题条也画出来了，不是只画一张图', async () => {
    const wrapper = await mountReal()

    expect(wrapper.text()).toContain('余热系统')
  })

  it('画的是内存里的草稿，不是节点上存量的那一份', async () => {
    const wrapper = await mountReal()

    expect(wrapper.text()).toContain('换热站')
  })
})
