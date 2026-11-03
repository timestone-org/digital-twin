/** @fileoverview 2D 孪生台账标量在编辑预览与公开页面中的真实渲染对照。 */
import type {
  DashboardNodePayload,
  DashboardNodeView,
  DashboardPayload,
  PublicDashboardPayload,
} from '@dt/contracts'
import { __resetProviders } from '@dt/datasources'
import { __resetConfigControls, __resetModules, getModule } from '@dt/modules'
import { TWIN_2D_CONFIG_KEY } from '@dt/twin2d'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'

import { configureApiClient } from '@/api/client'
import { toPublicBinding } from '@/api/dashboardShareWire'
import {
  __resetDashboardBootstrap,
  installDashboardModules,
} from '@/bootstrap/dashboard'
import EditorPreview from '@/pages/DashboardEditor/components/EditorPreview.vue'
import { useEditorDataSources } from '@/pages/DashboardEditor/scripts/useEditorDataSources'
import PublicDashboard from '@/pages/PublicDashboard/index.vue'

const routeToken = ref('test-ticket')
vi.mock('vue-router', () => ({
  useRoute: () => ({
    get params() {
      return { publicToken: routeToken.value }
    },
  }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/composables/useRealtimeChannel', () => ({
  usePublicRealtimeChannel: () => channel(),
  useRealtimeChannel: () => channel(),
  closeRealtimeChannel: vi.fn(),
}))

function channel() {
  return {
    isConnected: ref(true),
    connectionState: ref('open'),
    isRejected: ref(false),
    subscribe: vi.fn(() => () => undefined),
  }
}

const getPublicDashboard =
  vi.fn<
    (token: string, signal?: AbortSignal) => Promise<PublicDashboardPayload>
  >()
vi.mock('@/api/dashboardShare', () => ({
  getPublicDashboard: (token: string, signal?: AbortSignal) =>
    getPublicDashboard(token, signal),
}))

const TS = '2026-11-03T01:00:00Z'
const VALUE = 36.5
let fetchMock: MockInstance<typeof globalThis.fetch>

function response(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      code: status === 200 ? 0 : 41016,
      message: '读数不可用',
      data,
      trace_id: 'trace',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

function publicLatest(value = VALUE) {
  return {
    items: [
      {
        dataset_key: 'ds:nyyh:制丝排潮运行状态',
        status: 'ok',
        value,
        ts: TS,
        stale_at: null,
        message: null,
      },
    ],
  }
}

function fetchDataset(input: string | URL | Request): Promise<Response> {
  const path =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  if (path.includes('/public-dashboards/'))
    return Promise.resolve(
      response(publicLatest(routeToken.value === 'other-ticket' ? 42 : VALUE)),
    )
  if (path.startsWith('/api/v1/platform/dataset-tables?'))
    return Promise.resolve(
      response({
        items: [
          {
            id: 'table',
            code: 'nyyh',
            collect_mode: 'aggregate',
            collect_interval_ms: 300000,
          },
        ],
        page: 1,
        size: 200,
        total: 1,
      }),
    )
  if (path === '/api/v1/platform/dataset-tables/table/latest')
    return Promise.resolve(
      response({ ts: TS, values: { 制丝排潮运行状态: VALUE }, computed: {} }),
    )
  return Promise.reject(new Error(`未预期的请求：${path}`))
}
const NODE: DashboardNodeView = {
  id: 'twin-module',
  parentId: null,
  clientKey: null,
  moduleType: 'twin-2d-view',
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  zIndex: 0,
  isVisible: true,
  configJson: {
    [TWIN_2D_CONFIG_KEY]: {
      version: 1,
      canvas: { width: 400, height: 300 },
      styles: [
        {
          id: 'reading-probe',
          name: '读数',
          size: { w: 120, h: 60 },
          prims: [
            {
              id: 'reading',
              kind: 'txt',
              src: { kind: 'slot', slot: 'value' },
            },
          ],
          slots: [{ key: 'value', label: '运行状态', placeholder: '--' }],
        },
      ],
      nodes: [{ id: 'device', styleId: 'reading-probe', x: 20, y: 20 }],
    },
  },
  bindings: [
    toPublicBinding({
      id: 'dataset-binding',
      field_key: 'nodeValues[0].value',
      source_kind: 'dataset',
      node_key: null,
      static_value_json: null,
      compute_json: null,
      detail_json: { dataset_key: 'ds:nyyh:制丝排潮运行状态', range: {} },
      transform_json: null,
    }),
  ],
}

const PUBLIC_PAYLOAD: PublicDashboardPayload = {
  name: '能源银行2D',
  description: null,
  designWidth: 400,
  designHeight: 300,
  schemaVersion: 1,
  themeJson: {},
  chromeJson: {},
  updatedAt: TS,
  nodes: [NODE],
}

const EDITOR_NODE: DashboardNodePayload = {
  ...NODE,
  dashboardId: 'dashboard',
  createdAt: TS,
  updatedAt: TS,
  bindings: NODE.bindings.map((binding) => ({
    ...binding,
    nodeId: NODE.id,
    createdAt: TS,
    updatedAt: TS,
  })),
}

function editorHost() {
  return defineComponent({
    setup() {
      installDashboardModules()
      const dashboard = ref<DashboardPayload | null>({
        ...PUBLIC_PAYLOAD,
        id: 'dashboard',
        projectId: 'project',
        rowVersion: 1,
        isPublic: true,
        createdAt: TS,
        nodes: [EDITOR_NODE],
      })
      useEditorDataSources(dashboard, () => [EDITOR_NODE])
      return () =>
        h(EditorPreview, {
          nodes: [EDITOR_NODE],
          design: { width: 400, height: 300 },
          getManifest: getModule,
          chromeJson: {},
          dashboardId: 'dashboard',
        })
    },
  })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
  routeToken.value = 'test-ticket'
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(TS))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  getPublicDashboard.mockReset().mockResolvedValue(PUBLIC_PAYLOAD)
  configureApiClient({ getToken: () => 'ordinary-session' })
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchDataset)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  configureApiClient({ getToken: () => null })
})

async function openPublic() {
  const wrapper = mount(PublicDashboard)
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.find('.t2-node').exists()).toBe(true))
  return wrapper
}

describe('2D 台账标量的页面一致性', () => {
  it('编辑器预览显示台账列已有的最新值', async () => {
    const wrapper = mount(editorHost())
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('.t2-node').exists()).toBe(true))

    expect(wrapper.get('.t2-node').text()).toBe('36.5')
  })

  it('公开页显示同一已发布绑定的台账最新值', async () => {
    const wrapper = await openPublic()

    expect(wrapper.get('.t2-node').text()).toBe('36.5')
    expect(wrapper.get('[data-test="public-status"]').text()).toBe(
      '台账数据 · 每分钟更新',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, options] = fetchMock.mock.calls[0] ?? []
    expect(path).toBe(
      '/api/v1/platform/public-dashboards/test-ticket/dataset-latest',
    )
    expect(options?.headers).not.toHaveProperty('Authorization')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([401, 403, 404])('授权失效%s后清掉既有读数', async (status) => {
    const wrapper = await openPublic()
    expect(wrapper.get('.t2-node').text()).toBe('36.5')
    fetchMock.mockResolvedValueOnce(response(null, status))

    await vi.advanceTimersByTimeAsync(60000)

    expect(wrapper.get('.t2-node').text()).toBe('--')
    expect(wrapper.text()).toContain('1 个读数取不到')
    expect(wrapper.text()).not.toContain('数据可能过期')
  })

  it('切屏等待新文档时清掉旧值且不以旧绑定查询新票据', async () => {
    const wrapper = await openPublic()
    expect(wrapper.get('.t2-node').text()).toBe('36.5')
    let resolveNew: ((value: PublicDashboardPayload) => void) | undefined
    getPublicDashboard.mockImplementationOnce(
      () =>
        new Promise<PublicDashboardPayload>((resolve) => {
          resolveNew = resolve
        }),
    )

    routeToken.value = 'other-ticket'
    await flushPromises()

    expect(wrapper.get('.t2-node').text()).toBe('--')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveNew?.(PUBLIC_PAYLOAD)
    await flushPromises()
    expect(wrapper.get('.t2-node').text()).toBe('42')
  })

  it.each([503, 0])('暂态故障%s保留最后值并显示陈旧标记', async (status) => {
    const wrapper = await openPublic()
    if (status === 0) fetchMock.mockRejectedValueOnce(new Error('断网'))
    else fetchMock.mockResolvedValueOnce(response(null, status))

    await vi.advanceTimersByTimeAsync(60000)

    expect(wrapper.get('.t2-node').text()).toBe('36.5')
    expect(wrapper.text()).toContain('数据可能过期')
  })

  it('切换票据立即取消旧读取，迟到结果不能写入新屏', async () => {
    let resolveOld: ((value: Response) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve
        }),
    )
    const wrapper = await openPublic()
    const oldSignal = fetchMock.mock.calls[0]?.[1]?.signal

    routeToken.value = 'other-ticket'
    await flushPromises()

    expect(oldSignal?.aborted).toBe(true)
    expect(wrapper.get('.t2-node').text()).toBe('42')
    resolveOld?.(response(publicLatest(36.5)))
    await flushPromises()
    expect(wrapper.get('.t2-node').text()).toBe('42')
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/platform/public-dashboards/test-ticket/dataset-latest',
      '/api/v1/platform/public-dashboards/other-ticket/dataset-latest',
    ])
  })
})
