/**
 * @fileoverview 守三件套 props 真的装配到了模块手里（清单缺省铺底的 config、
 * 求值后的 values、带状态的 meta），以及三条失败边界各自**只影响一格**：
 * 清单缺失、渲染抛错（不许冒泡）、异步 chunk 加载失败（重试一次后占位）。
 */
import type { BindingPayload } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, type PropType } from 'vue'
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

const catalog = fakeCatalog([
  simple,
  strict,
  boom,
  silentBoom,
  brokenChunk,
  namespaced,
])

const PENDING_READER: BindingValueReader = () => ({ state: 'pending' })

/** 一格的装配说明：`bare` 表示连 config 与 bindings 都不传。 */
interface Cell {
  moduleType: string
  config?: Record<string, unknown>
  bindings?: readonly BindingPayload[]
  bare?: boolean
}

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
    provideRuntimeData({ readBinding: () => props.reader })
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

  it('陈旧的值照常显示，但角上标出来', async () => {
    const wrapper = mountCells(
      [{ moduleType: 'simple', bindings: [POWER_BINDING] }],
      () => ({ state: 'ok', value: 42, isStale: true }),
    )
    await flushPromises()

    expect(wrapper.get('.dt-module-status--badge').text()).toBe('数据陈旧')
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
