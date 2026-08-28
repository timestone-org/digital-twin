/**
 * @fileoverview 守三件套 props 真的装配到了模块手里（清单缺省铺底的 config、
 * 求值后的 values、带状态的 meta），以及三条失败边界各自**只影响一格**：
 * 清单缺失、渲染抛错（不许冒泡）、异步 chunk 加载失败（重试一次后占位）。
 * 另守「数据可能过期」那一档的画法：不盖整格、只加角标，且设计态不冒角标。
 */
import type { BindingPayload, ModuleConnectionState } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type PropType } from 'vue'
import { describe, expect, it } from 'vitest'

import ModuleRenderer from '../src/ModuleRenderer.vue'
import type { BindingValueReader } from '../src/moduleValues'
import { provideRuntimeData } from '../src/runtimeData'
import {
  asAsyncModule,
  fakeBinding,
  fakeCatalog,
  fakeManifest,
  fakeModuleComponent,
} from '../src/testing/fixtures'

let chunkAttempts = 0

const simple = fakeManifest({
  type: 'simple',
  configSchema: [
    { key: 'title', label: '标题', type: 'string', default: '缺省标题' },
  ],
  bindings: [{ key: 'power', label: '功率', dataType: 'number' }],
  component: () => asAsyncModule(fakeModuleComponent({ mark: 'seen' })),
})

const strict = fakeManifest({
  type: 'strict',
  bindings: [
    { key: 'power', label: '功率', dataType: 'number', isRequired: true },
  ],
  component: () => asAsyncModule(fakeModuleComponent({ mark: 'seen' })),
})

const boom = fakeManifest({
  type: 'boom',
  component: () =>
    asAsyncModule(
      fakeModuleComponent({ mark: 'boom', throws: '模块内部炸了' }),
    ),
})

/** 抛了一个没有消息的异常：占位仍要成立，不许因此渲染出一行空白。 */
const silentBoom = fakeManifest({
  type: 'silent-boom',
  component: () =>
    asAsyncModule(fakeModuleComponent({ mark: 'silent', throws: '' })),
})

const brokenChunk = fakeManifest({
  type: 'broken-chunk',
  component: () => {
    chunkAttempts += 1
    return Promise.reject(new Error('chunk 拉不下来'))
  },
})

/** 真 `import()` 交出来的形状：带模块标记的命名空间对象。 */
const namespaced = fakeManifest({
  type: 'namespaced',
  component: () =>
    Promise.resolve({
      default: fakeModuleComponent({ mark: 'namespaced' }),
      [Symbol.toStringTag]: 'Module',
    }),
})

/** 自报「逐格状态我自己交代」的多点位模块。 */
const owns = fakeManifest({
  type: 'owns-status',
  bindings: [{ key: 'power', label: '功率', dataType: 'number' }],
  ownsStatusDisplay: true,
  component: () => asAsyncModule(fakeModuleComponent({ mark: 'owns' })),
})

/** 同上，但必绑：`unbound` 那一档仍归浮层。 */
const ownsStrict = fakeManifest({
  type: 'owns-strict',
  bindings: [
    { key: 'power', label: '功率', dataType: 'number', isRequired: true },
  ],
  ownsStatusDisplay: true,
  component: () => asAsyncModule(fakeModuleComponent({ mark: 'owns' })),
})

const catalog = fakeCatalog([
  simple,
  strict,
  boom,
  silentBoom,
  brokenChunk,
  namespaced,
  owns,
  ownsStrict,
])

const PENDING_READER: BindingValueReader = () => ({ state: 'pending' })

/** 一格的装配说明：`bare` 表示连 config 与 bindings 都不传。 */
interface Cell {
  moduleType: string
  config?: Record<string, unknown>
  bindings?: readonly BindingPayload[]
  bare?: boolean
}

/** 桩通道的连接态；只有 `mountWired` 起的宿主才把它装进取数源。 */
const channelState = ref<ModuleConnectionState>('open')
// ⚠ 用模块级开关而不是 prop：在 setup 的根作用域上读 prop 会丢响应性，
// 而这条判断只需要在挂载那一刻定死
let isWired = false

const Host = defineComponent({
  name: 'RendererHost',
  props: {
    cells: { type: Array as PropType<readonly Cell[]>, required: true },
    reader: {
      type: Function as PropType<BindingValueReader>,
      required: true,
    },
  },
  setup(props) {
    provideRuntimeData(
      isWired
        ? {
            readBinding: () => props.reader,
            connectionState: () => channelState.value,
          }
        : { readBinding: () => props.reader },
    )
    return () => h('div', props.cells.map(toCell))
  },
})

function toCell(cell: Cell) {
  if (cell.bare === true) {
    return h(ModuleRenderer, {
      moduleType: cell.moduleType,
      getManifest: catalog,
    })
  }
  return h(ModuleRenderer, {
    moduleType: cell.moduleType,
    config: cell.config ?? {},
    bindings: cell.bindings ?? [],
    nodeId: 'node-1',
    getManifest: catalog,
  })
}

function mountCells(cells: readonly Cell[], reader = PENDING_READER) {
  isWired = false
  return mount(Host, { props: { cells, reader } })
}

/**
 * 装了实时通道的宿主：连接态由 `channelState` 说了算。
 * @param cells 这一屏的格子
 * @param state 挂载时的连接态
 * @param reader 取数读取器
 */
function mountWired(
  cells: readonly Cell[],
  state: ModuleConnectionState,
  reader = OK_READER,
) {
  isWired = true
  channelState.value = state
  return mount(Host, { props: { cells, reader } })
}

const POWER_BINDING = fakeBinding({
  id: 'b1',
  fieldKey: 'power',
  sourceKind: 'opcua',
})

const OK_READER: BindingValueReader = () => ({
  state: 'ok',
  value: 42,
  timestampMs: 1700,
})

describe('三件套的装配', () => {
  it('config 是清单缺省铺底、用户配置覆盖', async () => {
    const wrapper = mountCells([{ moduleType: 'simple', config: { pad: 20 } }])
    await flushPromises()

    expect(wrapper.get('.seen').attributes('data-config')).toBe(
      '{"title":"缺省标题","pad":20}',
    )
  })

  it('values 是求值后的绑定值', async () => {
    const wrapper = mountCells(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      OK_READER,
    )
    await flushPromises()

    expect(wrapper.get('.seen').attributes('data-values')).toBe('{"power":42}')
  })

  it('meta 带着状态、节点身份与取值时刻', async () => {
    const wrapper = mountCells(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      OK_READER,
    )
    await flushPromises()

    expect(wrapper.get('.seen').attributes('data-meta')).toBe(
      '{"status":"connected","nodeId":"node-1","valueTimeMs":1700}',
    )
  })

  it('不给配置与绑定时照常渲染，模块拿到两个空袋子', async () => {
    const wrapper = mountCells([{ moduleType: 'simple', bare: true }])
    await flushPromises()

    expect(wrapper.get('.seen').attributes('data-values')).toBe('{}')
    expect(wrapper.get('.seen').attributes('data-config')).toBe(
      '{"title":"缺省标题"}',
    )
  })

  it('正常态不盖状态浮层', async () => {
    const wrapper = mountCells(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      OK_READER,
    )
    await flushPromises()

    expect(wrapper.find('.dt-module-status').exists()).toBe(false)
  })
})

describe('状态的交代', () => {
  it('还在等首帧时盖一层加载态', async () => {
    const wrapper = mountCells([
      { moduleType: 'simple', bindings: [POWER_BINDING] },
    ])
    await flushPromises()

    expect(wrapper.get('.dt-module-status--cover').text()).toContain('加载中')
  })

  it('很久没变的值照常显示，正常态什么都不画', async () => {
    const wrapper = mountCells(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      () => ({ state: 'ok', value: 42, timestampMs: 1_700_000_000_000 }),
    )
    await flushPromises()

    expect(wrapper.find('.dt-module-status').exists()).toBe(false)
    expect(wrapper.find('.seen').exists()).toBe(true)
  })

  it('必绑槽没配来源时说的是没绑，不是没数据', async () => {
    const wrapper = mountCells([{ moduleType: 'strict' }])
    await flushPromises()

    expect(wrapper.get('.dt-module-status--cover').text()).toContain(
      '未绑定数据来源',
    )
  })

  it('取不到时把原因摆出来，不静默留白', async () => {
    const wrapper = mountCells(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      () => ({ state: 'error', message: '归档服务超时' }),
    )
    await flushPromises()

    expect(wrapper.get('.dt-module-status__message').text()).toBe(
      'power：归档服务超时',
    )
  })
})

describe('自己交代状态的模块', () => {
  it('取不到时不盖整格——十个指标坏一个不该让另外九个一起看不见', async () => {
    const wrapper = mountCells(
      [{ moduleType: 'owns-status', bindings: [POWER_BINDING] }],
      () => ({ state: 'error', message: '快照读不到' }),
    )
    await flushPromises()

    expect(wrapper.find('.dt-module-status').exists()).toBe(false)
    expect(wrapper.find('.owns').exists()).toBe(true)
  })

  it('等首帧时也不盖，模块自己画「等待首帧」', async () => {
    const wrapper = mountCells([
      { moduleType: 'owns-status', bindings: [POWER_BINDING] },
    ])
    await flushPromises()

    expect(wrapper.find('.dt-module-status').exists()).toBe(false)
  })

  it('必绑槽一条都没配时照盖：那时模块连布局都摆不出来', async () => {
    const wrapper = mountCells([{ moduleType: 'owns-strict' }])
    await flushPromises()

    expect(wrapper.get('.dt-module-status--cover').text()).toContain(
      '未绑定数据来源',
    )
  })

  it('逐槽结论只下发给自报的模块，其余模块的 meta 里没有这一项', async () => {
    const wrapper = mountCells(
      [
        { moduleType: 'owns-status', bindings: [POWER_BINDING] },
        { moduleType: 'simple', bindings: [POWER_BINDING] },
      ],
      () => ({ state: 'error', message: '快照读不到' }),
    )
    await flushPromises()

    expect(wrapper.get('.owns').attributes('data-meta')).toContain(
      '"slots":{"power":{"state":"error","message":"快照读不到"}}',
    )
    expect(wrapper.get('.seen').attributes('data-meta')).not.toContain('slots')
  })
})

describe('通道断了：数据可能过期', () => {
  it('不盖整格——旧值照常显示，只在右上角挂一枚角标', async () => {
    const wrapper = mountWired(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      'reconnecting',
    )
    await flushPromises()

    expect(wrapper.get('.dt-module-status--badge').text()).toBe('数据可能过期')
    expect(wrapper.find('.dt-module-status--cover').exists()).toBe(false)
    expect(wrapper.get('.seen').attributes('data-values')).toBe('{"power":42}')
  })

  it('角标不在模块自己的节点里，也就挡不住模块的内容', async () => {
    const wrapper = mountWired(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      'closed',
    )
    await flushPromises()

    expect(wrapper.get('.seen').find('.dt-module-status--badge').exists()).toBe(
      false,
    )
    expect(wrapper.find('.dt-module-status__veil').exists()).toBe(true)
  })

  it('通道连着时一枚角标都没有', async () => {
    const wrapper = mountWired(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      'open',
    )
    await flushPromises()

    expect(wrapper.find('.dt-module-status').exists()).toBe(false)
  })

  it('连着的时候断掉，屏上的旧值当场被标成可能过期', async () => {
    const wrapper = mountWired(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      'open',
    )
    await flushPromises()
    expect(wrapper.find('.dt-module-status--badge').exists()).toBe(false)

    channelState.value = 'reconnecting'
    await nextTick()

    expect(wrapper.find('.dt-module-status--badge').exists()).toBe(true)
  })

  it('⚠ 设计态与独立渲染不装连接态，于是永远不冒这枚角标', async () => {
    // 编辑器画布上冒一枚「数据可能过期」，等于让人去查一条不存在的故障
    const wrapper = mountCells(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      OK_READER,
    )
    await flushPromises()

    expect(wrapper.find('.dt-module-status').exists()).toBe(false)
  })

  it('连接态照实透传进 meta，模块要自己画也拿得到', async () => {
    const wrapper = mountWired(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      'reconnecting',
    )
    await flushPromises()

    expect(wrapper.get('.seen').attributes('data-meta')).toContain(
      '"connectionState":"reconnecting"',
    )
  })

  it('一个值都没有时说的还是加载中——空格不许被说成有数据', async () => {
    const wrapper = mountWired(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      'closed',
      PENDING_READER,
    )
    await flushPromises()

    expect(wrapper.get('.dt-module-status--cover').text()).toContain('加载中')
    expect(wrapper.find('.dt-module-status--badge').exists()).toBe(false)
  })

  it('自报交代状态的模块也挂角标：通道断了是整条链路的事', async () => {
    const wrapper = mountWired(
      [{ moduleType: 'owns-status', bindings: [POWER_BINDING] }],
      'closed',
    )
    await flushPromises()

    expect(wrapper.get('.dt-module-status--badge').text()).toBe('数据可能过期')
    expect(wrapper.find('.owns').exists()).toBe(true)
  })
})

describe('三条失败边界', () => {
  it('清单里没有这个类型就是一格占位，并把类型名摆出来', async () => {
    const wrapper = mountCells([{ moduleType: 'vendor-gauge' }])
    await flushPromises()

    expect(wrapper.get('.dt-module-fallback').text()).toContain('未知模块类型')
    expect(wrapper.get('.dt-module-fallback').text()).toContain('vendor-gauge')
  })

  it('模块渲染抛错时只换掉这一格，隔壁那格照常渲染', async () => {
    const wrapper = mountCells([
      { moduleType: 'boom' },
      { moduleType: 'simple' },
    ])
    await flushPromises()

    expect(wrapper.findAll('.dt-module-fallback')).toHaveLength(1)
    expect(wrapper.get('.dt-module-fallback').text()).toContain('模块渲染失败')
    expect(wrapper.find('.seen').exists()).toBe(true)
  })

  it('异常没带消息时占位只说标题，不留一行空白', async () => {
    const wrapper = mountCells([{ moduleType: 'silent-boom' }])
    await flushPromises()

    expect(wrapper.get('.dt-module-fallback').text()).toBe('模块渲染失败')
    expect(wrapper.find('.dt-module-fallback__detail').exists()).toBe(false)
  })

  it('异步 chunk 加载失败先重试一次，仍失败才换成占位', async () => {
    chunkAttempts = 0
    const wrapper = mountCells([{ moduleType: 'broken-chunk' }])
    await flushPromises()
    await flushPromises()

    expect(chunkAttempts).toBe(2)
    expect(wrapper.get('.dt-module-fallback').text()).toContain('模块加载失败')
  })
})

/**
 * ⚠ 清单契约只要求 `Promise<{ default: Component }>`，而 Vue 只对带
 * `Symbol.toStringTag: 'Module'` 的结果剥 `default`——两种形状都必须渲染得出来，
 * 否则不走 `import()` 的第三方清单会得到一格既不渲染也不占位的空白。
 */
describe('清单交出来的两种模块形状', () => {
  it('纯对象 `{ default: C }` 渲染得出来', async () => {
    const wrapper = mountCells([{ moduleType: 'simple' }])
    await flushPromises()

    expect(wrapper.find('.seen').exists()).toBe(true)
    expect(wrapper.find('.dt-module-fallback').exists()).toBe(false)
  })

  it('带模块标记的命名空间对象也渲染得出来', async () => {
    const wrapper = mountCells([{ moduleType: 'namespaced' }])
    await flushPromises()

    expect(wrapper.find('.namespaced').exists()).toBe(true)
    expect(wrapper.find('.dt-module-fallback').exists()).toBe(false)
  })
})
