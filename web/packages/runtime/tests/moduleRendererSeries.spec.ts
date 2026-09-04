/**
 * @fileoverview 守时序槽在装配点上的接法：序列槽由驱动器接管、落进行内的伴生键，
 * 其余槽一律照旧走注入的读取器（那份一行没改）。另守两条不许出现的静默失败：
 * 时序槽接了拿不出历史的来源要落 error 而不是一张空图；没装批量取数口时不接管。
 */
import type { BindingPayload, SeriesOutcome, SeriesReader } from '@dt/contracts'
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

const SLOT_KEY = 'seriesValues[0].series'

/** 行内一条时序子槽 + 一条顶层标量槽，逐槽结论自己交代。 */
const chart = fakeManifest({
  type: 'chart-block',
  ownsStatusDisplay: true,
  bindings: [
    {
      key: 'seriesValues',
      label: '系列',
      dataType: 'number',
      isArray: true,
      isEntityPinned: true,
      arrayFields: [
        {
          key: 'series',
          label: '曲线',
          dataType: 'number',
          isTimeSeries: true,
        },
      ],
    },
    { key: 'power', label: '功率', dataType: 'number' },
  ],
  component: () => asAsyncModule(fakeModuleComponent({ mark: 'chart' })),
})

const catalog = fakeCatalog([chart])

/** 注入的读取器：对序列类来源就是这一句，本轮一行没改它。 */
const BASE_READER: BindingValueReader = () => ({
  state: 'error',
  message: '序列要异步取数，画布上不展开',
})

function seriesBinding(fieldKey: string): BindingPayload {
  return fakeBinding({
    id: `b-${fieldKey}`,
    fieldKey,
    sourceKind: 'archive',
    detailJson: { nodeKey: 'src:p0', range: { lastWindow: '1h' } },
  })
}

// ⚠ 用模块级开关而不是 prop：在 setup 的根作用域上读 prop 会丢响应性，
// 而装不装批量取数口这件事只需要在挂载那一刻定死
let seriesReader: SeriesReader | undefined

const Host = defineComponent({
  name: 'SeriesHost',
  props: {
    bindings: {
      type: Array as PropType<readonly BindingPayload[]>,
      required: true,
    },
  },
  setup(props) {
    provideRuntimeData({
      readBinding: () => BASE_READER,
      ...(seriesReader === undefined ? {} : { readSeries: seriesReader }),
    })
    return () =>
      h(ModuleRenderer, {
        moduleType: 'chart-block',
        config: {},
        bindings: props.bindings,
        nodeId: 'node-1',
        getManifest: catalog,
      })
  },
})

/** 一口气回一批固定结论的取数口。 */
function readerOf(outcomes: ReadonlyMap<string, SeriesOutcome>): SeriesReader {
  return () => Promise.resolve(outcomes)
}

/**
 * 挂一格图表模块。
 * @param bindings 这一格的绑定
 * @param reader 批量取数口；不给就是没装
 */
function mountChart(
  bindings: readonly BindingPayload[],
  reader?: SeriesReader,
) {
  seriesReader = reader
  return mount(Host, { props: { bindings } })
}

const TRUNCATED: ReadonlyMap<string, SeriesOutcome> = new Map([
  [
    SLOT_KEY,
    {
      state: 'ok',
      points: [
        { t: 1, v: 10 },
        { t: 2, v: 20 },
      ],
      isTruncated: true,
      truncatedSide: 'late',
      isStale: false,
    },
  ],
])

describe('序列注入', () => {
  it('序列落进行内的伴生键，末值同时进那一行的标量键', async () => {
    const wrapper = mountChart([seriesBinding(SLOT_KEY)], readerOf(TRUNCATED))
    await flushPromises()

    expect(wrapper.get('.chart').attributes('data-values')).toBe(
      '{"seriesValues":[{"seriesPoints":[{"t":1,"v":10},{"t":2,"v":20}],' +
        '"series":20}]}',
    )
  })

  it('触顶标记真的到得了模块手上的逐槽结论', async () => {
    const wrapper = mountChart([seriesBinding(SLOT_KEY)], readerOf(TRUNCATED))
    await flushPromises()

    expect(wrapper.get('.chart').attributes('data-meta')).toContain(
      '"seriesValues[0].series":{"state":"ok","isTruncated":true',
    )
  })

  it('取不到时落 error，且一个点都不注入', async () => {
    const wrapper = mountChart(
      [seriesBinding(SLOT_KEY)],
      readerOf(new Map([[SLOT_KEY, { state: 'error', message: '端点 503' }]])),
    )
    await flushPromises()

    expect(wrapper.get('.chart').attributes('data-values')).toBe('{}')
    expect(wrapper.get('.chart').attributes('data-meta')).toContain('端点 503')
  })
})

describe('接了拿不出历史的来源', () => {
  it('时序槽落一句说得清的 error，而不是一张空图', async () => {
    const bare = fakeBinding({
      id: 'b-bare',
      fieldKey: SLOT_KEY,
      sourceKind: 'opcua',
      nodeKey: 'src:p0',
    })
    const wrapper = mountChart([bare], readerOf(new Map()))
    await flushPromises()

    expect(wrapper.get('.chart').attributes('data-values')).toBe('{}')
    expect(wrapper.get('.chart').attributes('data-meta')).toContain(
      '这一档来源给不出历史序列',
    )
  })
})

describe('其余槽照旧', () => {
  it('非时序槽绑了序列类来源，仍是注入的读取器那句话', async () => {
    const wrapper = mountChart([seriesBinding('power')], readerOf(TRUNCATED))
    await flushPromises()

    expect(wrapper.get('.chart').attributes('data-meta')).toContain(
      '序列要异步取数，画布上不展开',
    )
  })

  it('没装批量取数口时时序槽也退回注入的读取器', async () => {
    const wrapper = mountChart([seriesBinding(SLOT_KEY)])
    await flushPromises()

    expect(wrapper.get('.chart').attributes('data-meta')).toContain(
      '序列要异步取数，画布上不展开',
    )
  })
})
