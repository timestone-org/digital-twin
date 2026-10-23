/** @fileoverview 台账公式列经真实大屏装配后必须显示，并保留派生槽运算。 */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BindingPayload, DashboardNodeView } from '@dt/contracts'
import { computeModuleValues, useRuntimeData } from '@dt/runtime'
import type { RuntimeDataSource } from '@dt/runtime'

import * as client from '@/api/client'
import { toBinding } from '@/api/dashboardWire'
import { installDashboardSeries } from '@/bootstrap/dashboard'
import { useDashboardValues } from '@/composables/useDashboardValues'
import { useTwin2dLiveValues } from '@/pages/Twin2dEditor/scripts/useTwin2dLiveValues'
import { useTwinLiveValues } from '@/pages/TwinEditor/scripts/useTwinLiveValues'
import { normalizeTwinConfig } from '@dt/twin-config'

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({ connectionState: { value: 'open' } }),
}))

const DATASET_BINDING: BindingPayload = {
  id: 'b1',
  nodeId: 'n1',
  fieldKey: 'value',
  sourceKind: 'dataset',
  nodeKey: null,
  staticValueJson: null,
  computeJson: null,
  detailJson: { datasetKey: 'ds:nyyh:烟气余热输出', range: {} },
  transformJson: null,
  createdAt: '',
  updatedAt: '',
}

function dailyBinding(timezone?: string): BindingPayload {
  return toBinding({
    id: 'daily',
    node_id: 'n1',
    field_key: 'daily',
    source_kind: 'dataset',
    node_key: null,
    static_value_json: null,
    compute_json: null,
    transform_json: null,
    created_at: '',
    updated_at: '',
    detail_json: {
      dataset_key: 'ds:nyyh:烟气余热输出',
      range: { last_window: 'today' },
      ...(timezone === undefined ? {} : { timezone }),
    },
  })
}

const NODE: DashboardNodeView = {
  id: 'n1',
  parentId: null,
  clientKey: null,
  moduleType: 'demo',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  zIndex: 0,
  isVisible: true,
  configJson: {},
  bindings: [
    DATASET_BINDING,
    {
      ...DATASET_BINDING,
      id: 'b2',
      fieldKey: 'total',
      sourceKind: 'computed',
      detailJson: null,
      computeJson: { op: 'sum', inputs: ['value'] },
    },
  ],
}

let requestMock: ReturnType<typeof vi.fn>
const mounted: ReturnType<typeof mount>[] = []
let formulaValue = 5.8059097391
let latestFailure = false
let latestStatus = 503
let latestTimestamp: string | null = null

function mountDashboard(hasDatasetAccess = true, initialNode = NODE) {
  const nodes = ref([initialNode])
  const scope = ref('d1')
  let source: RuntimeDataSource | null = null
  const child = defineComponent({
    setup() {
      const runtime = useRuntimeData()
      source = runtime
      return () =>
        h(
          'span',
          JSON.stringify(
            computeModuleValues({
              specs: [],
              bindings: nodes.value[0]?.bindings ?? [],
              read: runtime.readBinding(),
            }).values,
          ),
        )
    },
  })
  const host = defineComponent({
    setup() {
      const values = useDashboardValues(
        () => nodes.value,
        () => scope.value,
        undefined,
        hasDatasetAccess,
      )
      installDashboardSeries({
        readPoint: values.read,
        readBinding: values.readBinding,
      })
      return () => h(child)
    },
  })
  const wrapper = mount(host)
  mounted.push(wrapper)
  return {
    wrapper,
    nodes,
    scope,
    read: (binding = DATASET_BINDING) => source?.readBinding()(binding, {}),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  formulaValue = 5.8059097391
  latestFailure = false
  latestStatus = 503
  latestTimestamp = null
  requestMock = vi.fn().mockImplementation((path: string) => {
    if (path === '/dataset-tables')
      return Promise.resolve({
        items: [
          {
            id: 't1',
            code: 'nyyh',
            collect_mode: 'aggregate',
            collect_interval_ms: 300000,
          },
        ],
        page: 1,
        size: 200,
        total: 1,
      })
    return latestFailure
      ? Promise.reject(
          new client.BizError(
            1,
            `${latestStatus} 不可用`,
            latestStatus,
            'trace',
          ),
        )
      : Promise.resolve({
          ts: latestTimestamp ?? new Date(Date.now() - 300000).toISOString(),
          values: {},
          computed: { 烟气余热输出: formulaValue },
        })
  })
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('台账标量的屏级装配', () => {
  it('当日绑定跨上海零点清空昨日累计，同列普通绑定仍保留最新值', async () => {
    vi.setSystemTime(new Date('2026-10-23T15:59:30Z'))
    latestTimestamp = '2026-10-23T15:55:00Z'
    const daily = dailyBinding('Asia/Shanghai')
    const { wrapper, read } = mountDashboard(true, {
      ...NODE,
      bindings: [DATASET_BINDING, daily],
    })
    await flushPromises()
    expect(read(daily)).toMatchObject({ value: formulaValue })
    latestFailure = true
    await vi.advanceTimersByTimeAsync(60000)
    expect(read(daily)).toMatchObject({ state: 'ok', value: null })
    expect(wrapper.text()).toContain('"daily":null')
    expect(read()).toMatchObject({ value: formulaValue, isStale: true })
    latestFailure = false
    latestTimestamp = '2026-10-23T16:00:00Z'
    formulaValue = 0
    await vi.advanceTimersByTimeAsync(60000)
    expect(read(daily)).toMatchObject({ state: 'ok', value: 0 })
  })

  it('latest 尚是昨日时按各绑定的业务时区决定当日，无时区不读浏览器设置', async () => {
    vi.setSystemTime(new Date('2026-10-23T16:01:00Z'))
    latestTimestamp = '2026-10-23T15:55:00Z'
    const shanghai = dailyBinding()
    const utc = { ...dailyBinding('UTC'), id: 'utc', fieldKey: 'utc' }
    const invalid = {
      ...dailyBinding('Mars/Olympus'),
      id: 'invalid',
      fieldKey: 'invalid',
    }
    const { read } = mountDashboard(true, {
      ...NODE,
      bindings: [shanghai, utc, invalid],
    })
    await flushPromises()
    expect(read(shanghai)).toMatchObject({ state: 'ok', value: null })
    expect(read(utc)).toMatchObject({ state: 'ok', value: formulaValue })
    expect(read(invalid)).toEqual({
      state: 'error',
      message: '当日台账绑定的时区无效',
    })
    latestTimestamp = '2026-10-23T17:00:00Z'
    await vi.advanceTimersByTimeAsync(60000)
    expect(read(shanghai)).toMatchObject({ state: 'ok', value: null })
  })

  it('已保存的台账公式列经过序列装配后仍显示真实值，computed 输入也可读取', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()
    expect(wrapper.text()).toContain('"value":5.8059097391')
    expect(wrapper.text()).toContain('"total":5.8059097391')
    expect(requestMock).toHaveBeenCalledWith(
      '/dataset-tables/t1/latest',
      expect.objectContaining({
        baseUrl: '/api/v1/platform',
        signal: expect.any(AbortSignal),
      }),
    )
    wrapper.unmount()
  })

  it('一次按表请求，分钟刷新可读到新值；卸载后停止请求', async () => {
    const { wrapper } = mountDashboard()
    await flushPromises()
    expect(requestMock).toHaveBeenCalledTimes(2)
    formulaValue = 9
    await vi.advanceTimersByTimeAsync(60000)
    expect(wrapper.text()).toContain('"value":9')
    expect(requestMock).toHaveBeenCalledTimes(4)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(120000)
    expect(requestMock).toHaveBeenCalledTimes(4)
  })

  it('刷新失败保留最后值并标陈旧，恢复成功才撤掉标记', async () => {
    const { read } = mountDashboard()
    await flushPromises()
    latestFailure = true
    await vi.advanceTimersByTimeAsync(60000)
    expect(read()).toMatchObject({
      state: 'ok',
      value: 5.8059097391,
      isStale: true,
    })
    latestFailure = false
    await vi.advanceTimersByTimeAsync(60000)
    expect(read()).toMatchObject({
      state: 'ok',
      value: 5.8059097391,
      dependsOnRealtime: false,
    })
    expect(read()).not.toHaveProperty('isStale')
  })

  it('latest 请求成功但桶时间一直不前进时，超过应到的下一桶后标陈旧', async () => {
    latestTimestamp = new Date(Date.now() - 300000).toISOString()
    const { read } = mountDashboard()
    await flushPromises()
    expect(read()).not.toHaveProperty('isStale')
    await vi.advanceTimersByTimeAsync(420000)
    expect(read()).toMatchObject({
      state: 'ok',
      value: 5.8059097391,
      isStale: true,
    })
  })

  it('首轮失败显示具体原因，不拿零值冒充台账读数', async () => {
    latestFailure = true
    const { read } = mountDashboard()
    await flushPromises()
    expect(read()).toEqual({
      state: 'error',
      message: '台账最新值取数失败：503 不可用',
    })
  })

  it.each([401, 403, 404])(
    '刷新得到 %s 后清除旧值，不以陈旧缓存继续展示',
    async (status) => {
      const { read } = mountDashboard()
      await flushPromises()
      latestFailure = true
      latestStatus = status
      await vi.advanceTimersByTimeAsync(60000)
      expect(read()).toEqual({
        state: 'error',
        message: `台账最新值取数失败：${status} 不可用`,
      })
    },
  )

  it('匿名公开屏明确提示且不调用台账 API', async () => {
    const { read } = mountDashboard(false)
    await flushPromises()
    expect(read()).toEqual({
      state: 'error',
      message: '公开大屏不提供台账数据，请登录后查看',
    })
    await vi.advanceTimersByTimeAsync(60000)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('隐藏时暂停，回到前台立即重新读取', async () => {
    mountDashboard()
    await flushPromises()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(120000)
    expect(requestMock).toHaveBeenCalledTimes(2)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(requestMock).toHaveBeenCalledTimes(4)
  })

  it('切屏作废在途请求，旧屏晚返回也不能覆盖新屏读数', async () => {
    let resolveOld: ((value: unknown) => void) | undefined
    requestMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const { wrapper, scope } = mountDashboard()
    scope.value = 'd2'
    formulaValue = 8
    await flushPromises()
    expect(wrapper.text()).toContain('"value":8')
    resolveOld?.({ items: [], page: 1, size: 200, total: 0 })
    await flushPromises()
    expect(wrapper.text()).toContain('"value":8')
    const oldOptions: unknown = requestMock.mock.calls[0]?.[1]
    expect(oldOptions).toMatchObject({ signal: { aborted: true } })
  })
})

describe('孪生子编辑器的台账装配', () => {
  it('2D 子编辑器读取同一真实列，卸载时终止读取', async () => {
    let live: ReturnType<typeof useTwin2dLiveValues> | null = null
    const wrapper = mount(
      defineComponent({
        setup() {
          live = useTwin2dLiveValues(
            () => 'd1',
            () => [DATASET_BINDING],
          )
          return () => h('div')
        },
      }),
    )
    mounted.push(wrapper)
    await flushPromises()
    const read = () => live?.readBinding()(DATASET_BINDING, {})
    expect(read()).toMatchObject({
      state: 'ok',
      value: 5.8059097391,
      dependsOnRealtime: false,
    })
    wrapper.unmount()
    const options: unknown = requestMock.mock.calls[1]?.[1]
    expect(options).toMatchObject({ signal: { aborted: true } })
    await vi.advanceTimersByTimeAsync(120000)
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it('3D 子编辑器绑定公式列，数据过期后移除旧值并明确报错', async () => {
    let live: ReturnType<typeof useTwinLiveValues> | null = null
    const bound = { ...DATASET_BINDING, fieldKey: 'panelValues[0].value' }
    const config = normalizeTwinConfig({
      panels: [{ id: 'p1', fields: [{ key: 'heat', label: '余热' }] }],
    })
    const wrapper = mount(
      defineComponent({
        setup() {
          live = useTwinLiveValues(
            () => 'd1',
            () => config,
            () => [bound],
          )
          return () => h('div')
        },
      }),
    )
    mounted.push(wrapper)
    await flushPromises()
    const values = () => live?.scene.value
    const read = () => live?.readBinding()(bound, {})
    expect(values()?.panels).toEqual({ 'p1::heat': { value: 5.8059097391 } })
    latestFailure = true
    await vi.advanceTimersByTimeAsync(60000)
    expect(values()?.panels).toEqual({})
    expect(read()).toEqual({
      state: 'error',
      message: '台账数据已过期，请检查台账采集与重算',
    })
  })
})
