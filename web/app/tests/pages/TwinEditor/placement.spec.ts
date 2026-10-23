/** @fileoverview 新建锚点与信息牌先拾取位置，取消无草稿，落点与归夹可整笔撤销。 */
import type { BindingPayload, DashboardPayload } from '@dt/contracts'
import type * as ThreeCore from '@dt/three-core'
import type { EditorSceneOptions } from '@dt/three-core'
import {
  TWIN_CONFIG_KEY,
  normalizeTwinConfig,
  type TwinConfig,
} from '@dt/twin-config'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as dashboardApi from '@/api/dashboard'
import * as apiClient from '@/api/client'
import type * as RealtimeChannel from '@/composables/useRealtimeChannel'
import TwinEditor from '@/pages/TwinEditor/index.vue'
import TwinLeftPane from '@/pages/TwinEditor/components/TwinLeftPane.vue'
import TwinViewport from '@/pages/TwinEditor/components/TwinViewport.vue'

const seam = vi.hoisted<{ scene: EditorSceneOptions | null }>(() => ({
  scene: null,
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { dashboardId: 'd1', nodeId: 'n1' }, query: {} }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}))

vi.mock('@/composables/useRealtimeChannel', async () => {
  const actual = await vi.importActual<typeof RealtimeChannel>(
    '@/composables/useRealtimeChannel',
  )
  const { fakeRealtimeChannel } = await import('@/testing/realtimeChannel')
  return { ...actual, useRealtimeChannel: fakeRealtimeChannel }
})

// ⚠ happy-dom 无 WebGL，只替换场景内核，页面、拾取提示与文档写入保持真实。
vi.mock('@dt/three-core', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeCore>()
  class FakeEditorScene {
    readonly setConfig = vi.fn()
    readonly setSelection = vi.fn()
    readonly setPickMode = vi.fn()
    readonly setNavigationMode = vi.fn()
    readonly setGizmoMode = vi.fn()
    readonly setValues = vi.fn()
    readonly isolatePart = vi.fn()
    readonly dispose = vi.fn()
    constructor(options: EditorSceneOptions) {
      seam.scene = options
    }
  }
  return { ...actual, EditorScene: FakeEditorScene }
})

function payload(config: Partial<TwinConfig>): DashboardPayload {
  return {
    id: 'd1',
    projectId: 'p1',
    name: '测试大屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    chromeJson: {},
    themeJson: {},
    createdAt: '',
    updatedAt: '',
    nodes: [
      {
        id: 'n1',
        dashboardId: 'd1',
        parentId: null,
        clientKey: null,
        moduleType: 'twin-view',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        zIndex: 0,
        isVisible: true,
        configJson: { [TWIN_CONFIG_KEY]: config },
        bindings: [],
        createdAt: '',
        updatedAt: '',
      },
    ],
  }
}

async function setup(
  config: Partial<TwinConfig> = {},
  bindings: BindingPayload[] = [],
) {
  const data = payload(config)
  data.nodes[0]?.bindings.push(...bindings)
  vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(data)
  const wrapper = mount(TwinEditor, {
    global: {
      stubs: {
        AppShell: { template: '<div><slot name="actions" /><slot /></div>' },
        TwinConfigPreview: true,
        TwinRightPane: true,
        TwinOverlays: true,
        TwinBatchConfig: true,
      },
    },
  })
  await flushPromises()
  const viewport = wrapper.getComponent(TwinViewport)
  const left = wrapper.getComponent(TwinLeftPane)
  const currentConfig = (): TwinConfig => left.props('config')
  const pick = async () => {
    if (seam.scene === null) throw new Error('视口未挂载')
    seam.scene.on.pickPosition([3, 2, 1])
    await flushPromises()
  }
  return { wrapper, viewport, left, currentConfig, pick }
}

enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
  seam.scene = null
  localStorage.clear()
  vi.spyOn(Math, 'random').mockReturnValue(0.25)
})
afterEach(() => vi.restoreAllMocks())

it('台账过期时主编辑视口明确提示，静态文案不再冒充实时台账', async () => {
  const requestMock = vi
    .fn()
    .mockResolvedValueOnce({
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
    .mockResolvedValueOnce({
      ts: '2020-01-01T00:00:00Z',
      values: {},
      computed: { heat: 5 },
    })
  vi.spyOn(apiClient, 'requestData').mockImplementation(requestMock)
  const { wrapper, viewport } = await setup(
    normalizeTwinConfig({
      panels: [
        {
          id: 'p1',
          fields: [{ key: 'heat', label: '余热', staticText: '100' }],
        },
      ],
    }),
    [
      {
        id: 'b1',
        nodeId: 'n1',
        fieldKey: 'panelValues[0].value',
        sourceKind: 'dataset',
        nodeKey: null,
        staticValueJson: null,
        computeJson: null,
        transformJson: null,
        detailJson: { datasetKey: 'ds:nyyh:heat', range: {} },
        createdAt: '',
        updatedAt: '',
      },
    ],
  )
  expect(wrapper.text()).toContain('台账数据已过期，请检查台账采集与重算')
  expect(wrapper.text()).toContain('静态文案不代表当前台账读数')
  expect(viewport.props('values')?.panels).toEqual({})
})

describe.each([
  ['anchors', '锚点'],
  ['panels', '信息牌'],
] as const)('点击放置 %s', (kind, label) => {
  it('点击添加后先引导放置，拾取后才创建并选中，一次撤销完全移除', async () => {
    const { wrapper, viewport, currentConfig, pick } = await setup()
    await wrapper.get(`[aria-label="新增${label}"]`).trigger('click')

    expect(currentConfig()[kind]).toEqual([])
    expect(viewport.props('pickMode')).toBe('position')
    expect(viewport.text()).toContain(`设置新${label}的位置`)
    await pick()

    const created = currentConfig()[kind][0]
    expect(created?.position).toEqual([3, 2, 1])
    expect(viewport.props('selection')).toEqual({ kind, id: created?.id })
    expect(viewport.props('pickMode')).toBeNull()
    await wrapper.get('[aria-label="撤销"]').trigger('click')
    expect(currentConfig()[kind]).toEqual([])
    expect(
      wrapper.get('[aria-label="撤销"]').attributes('disabled'),
    ).toBeDefined()
    await wrapper.get('[aria-label="重做"]').trigger('click')
    expect(currentConfig()[kind][0]?.position).toEqual([3, 2, 1])
  })

  it.each(['button', 'escape'] as const)(
    '%s 取消不会创建实体或留下撤销记录',
    async (cancel) => {
      const { wrapper, viewport, currentConfig, pick } = await setup()
      await wrapper.get(`[aria-label="新增${label}"]`).trigger('click')
      expect(viewport.props('pickMode')).toBe('position')
      if (cancel === 'button') {
        await viewport.get('.twin-viewport__pick-cancel').trigger('click')
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await flushPromises()
      }
      await pick()
      expect(currentConfig()[kind]).toEqual([])
      expect(viewport.props('pickMode')).toBeNull()
      expect(
        wrapper.get('[aria-label="撤销"]').attributes('disabled'),
      ).toBeDefined()
    },
  )

  it('文件夹内添加也先拾取，创建与归夹一次撤销', async () => {
    const { wrapper, viewport, currentConfig, pick } = await setup({
      folders: [{ id: 'folder', kind, name: '分组', itemIds: [] }],
    })
    await wrapper.get('[data-test="folder-add"]').trigger('click')
    expect(currentConfig()[kind]).toEqual([])
    expect(viewport.props('pickMode')).toBe('position')
    await pick()
    expect(currentConfig()[kind][0]?.position).toEqual([3, 2, 1])
    expect(currentConfig().folders[0]?.itemIds).toEqual([
      currentConfig()[kind][0]?.id,
    ])
    await wrapper.get('[aria-label="撤销"]').trigger('click')
    expect(currentConfig()[kind]).toEqual([])
    expect(currentConfig().folders[0]?.itemIds).toEqual([])
  })

  it('等待放置时文件夹被删除，不把新实体落到根目录', async () => {
    const { wrapper, left, viewport, currentConfig, pick } = await setup({
      folders: [{ id: 'folder', kind, name: '分组', itemIds: [] }],
    })
    await wrapper.get('[data-test="folder-add"]').trigger('click')
    left.vm.$emit('removeFolder', 'folder')
    await pick()
    expect(currentConfig()[kind]).toEqual([])
    expect(currentConfig().folders).toEqual([])
    expect(viewport.props('pickMode')).toBeNull()
    await wrapper.get('[aria-label="撤销"]').trigger('click')
    expect(currentConfig().folders[0]?.id).toBe('folder')
  })
})

it('切换新增种类后只创建最后选择的实体', async () => {
  const { wrapper, currentConfig, viewport, pick } = await setup()
  await wrapper.get('[aria-label="新增锚点"]').trigger('click')
  await wrapper.get('[aria-label="新增信息牌"]').trigger('click')
  expect(viewport.text()).toContain('设置新信息牌的位置')
  await pick()
  expect(currentConfig().anchors).toEqual([])
  expect(currentConfig().panels).toHaveLength(1)
})

it('改为新增其他实体时结束尚未完成的放置', async () => {
  const { wrapper, currentConfig, viewport, pick } = await setup()
  await wrapper.get('[aria-label="新增锚点"]').trigger('click')
  await wrapper.get('[aria-label="新增箭头"]').trigger('click')
  expect(viewport.props('pickMode')).toBeNull()
  await pick()
  expect(currentConfig().anchors).toEqual([])
  expect(currentConfig().arrows).toHaveLength(1)
})
