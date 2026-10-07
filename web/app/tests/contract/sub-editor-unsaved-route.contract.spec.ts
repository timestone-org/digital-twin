/** @fileoverview 真实路由复用卡片与 2D 子编辑器时，确认离开前保留草稿与资源归属。 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { TWIN_2D_CONFIG_KEY } from '@dt/twin2d'
import { DtConfirmHost, useConfirm } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { Router } from 'vue-router'

import * as dashboardApi from '@/api/dashboard'
import CardEditor from '@/pages/CardEditor/index.vue'
import Twin2dEditor from '@/pages/Twin2dEditor/index.vue'

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({ subscribe: () => () => undefined }),
}))
// 助手是独立的进程外装配；这里只测试编辑草稿与路由。
vi.mock('@/pages/Twin2dEditor/scripts/useTwin2dAi', () => ({
  TWIN_2D_AI_STARTERS: [],
  useTwin2dAi: () => ({}),
}))

const KINDS = ['card', 'twin-2d'] as const
type Kind = (typeof KINDS)[number]
const wrappers: VueWrapper[] = []

function node(id: string, nodeId: string, kind: Kind): DashboardNodePayload {
  return {
    id: nodeId,
    dashboardId: id,
    parentId: null,
    clientKey: null,
    moduleType: kind === 'card' ? 'data-card' : 'twin-2d-view',
    x: 0,
    y: 0,
    w: 420,
    h: 220,
    zIndex: 0,
    isVisible: true,
    configJson:
      kind === 'card'
        ? {
            parts: [{ kind: 'label' }],
            cells: [{ label: `${id}:${nodeId}`, unit: '℃' }],
          }
        : {
            [TWIN_2D_CONFIG_KEY]: {
              canvas: { width: 800, height: 600, grid: 20 },
            },
          },
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function dashboard(id: string, kind: Kind): DashboardPayload {
  return {
    id,
    projectId: 'p1',
    name: id,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 7,
    schemaVersion: 1,
    isPublic: false,
    chromeJson: {},
    themeJson: {},
    createdAt: '',
    updatedAt: '',
    nodes: [node(id, 'n1', kind), node(id, 'n2', kind)],
  }
}

function path(kind: Kind, id: string, nodeId = 'n1'): string {
  return `/dashboards/${id}/edit/${kind}/${nodeId}`
}

async function render(
  kind: Kind,
): Promise<{ wrapper: VueWrapper; router: Router }> {
  vi.spyOn(dashboardApi, 'getDashboard').mockImplementation((id) =>
    Promise.resolve(dashboard(id, kind)),
  )
  vi.spyOn(dashboardApi, 'replaceLayout').mockImplementation((id) =>
    Promise.resolve({ ...dashboard(id, kind), rowVersion: 8 }),
  )
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: `/dashboards/:dashboardId/edit/${kind}/:nodeId`,
        component: kind === 'card' ? CardEditor : Twin2dEditor,
      },
      { path: '/other', component: { template: '<p>其他页面</p>' } },
    ],
  })
  await router.push(path(kind, 'B'))
  const host = defineComponent({
    setup: () => () => h('div', [h(RouterView), h(DtConfirmHost)]),
  })
  const wrapper = mount(host, {
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: {
        AppShell: { template: '<div><slot name="actions" /><slot /></div>' },
        Teleport: true,
        AiDock: true,
        EditorStage: true,
        Twin2dRuntimePreview: true,
        CardPreviewStage: true,
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  await router.push(path(kind, 'A'))
  await flushPromises()
  return { wrapper, router }
}

function saveButton(wrapper: VueWrapper, kind: Kind) {
  return wrapper.get(
    kind === 'card' ? '[data-test="save-card"]' : '[data-test="save"]',
  )
}

async function dirty(wrapper: VueWrapper, kind: Kind): Promise<void> {
  if (kind === 'card') {
    await wrapper.get('[data-test="pick-cell:0"]').trigger('click')
    await wrapper.get('.ce-fields input').setValue('保留草稿')
  } else {
    await wrapper.get('[data-test="canvas-width"]').setValue('777')
    await wrapper.get('[data-test="canvas-width"]').trigger('change')
  }
  await flushPromises()
  expect(saveButton(wrapper, kind).attributes('disabled')).toBeUndefined()
}

function draftValue(wrapper: VueWrapper, kind: Kind): string {
  const selector =
    kind === 'card' ? '.ce-fields input' : '[data-test="canvas-width"]'
  const input = wrapper.get(selector).element
  if (!(input instanceof HTMLInputElement))
    throw new Error('草稿控件不是输入框')
  return input.value
}

async function answer(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper
    .get('[role="dialog"]')
    .findAll('button')
    .find((one) => one.text() === label)
  if (button === undefined) throw new Error(`确认框缺少 ${label}`)
  await button.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})
afterEach(async () => {
  useConfirm().resolve(false)
  await flushPromises()
  while (wrappers.length > 0) wrappers.pop()?.unmount()
  vi.restoreAllMocks()
})

describe.each(KINDS)('%s 子编辑器同实例路由', (kind) => {
  it('后退先确认，取消保留原地址、输入和可保存的原资源草稿', async () => {
    const { wrapper, router } = await render(kind)
    await dirty(wrapper, kind)
    const pageElement = wrapper.findComponent(
      kind === 'card' ? CardEditor : Twin2dEditor,
    ).element
    const reads = vi.mocked(dashboardApi.getDashboard).mock.calls.length
    router.back()
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe(path(kind, 'A'))
    await answer(wrapper, '取消')
    expect(router.currentRoute.value.fullPath).toBe(path(kind, 'A'))
    expect(draftValue(wrapper, kind)).toBe(kind === 'card' ? '保留草稿' : '777')
    expect(dashboardApi.getDashboard).toHaveBeenCalledTimes(reads)
    expect(
      wrapper.findComponent(kind === 'card' ? CardEditor : Twin2dEditor)
        .element,
    ).toBe(pageElement)
    await saveButton(wrapper, kind).trigger('click')
    await flushPromises()
    expect(dashboardApi.replaceLayout).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dashboardApi.replaceLayout).mock.calls[0]?.[0]).toBe('A')
  })

  it('确认后才读取目标，目标加载失败时不可保存已离开的资源', async () => {
    const { wrapper, router } = await render(kind)
    await dirty(wrapper, kind)
    vi.mocked(dashboardApi.getDashboard).mockRejectedValueOnce(
      new Error('加载失败'),
    )
    const navigation = router.push(path(kind, 'B'))
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(draftValue(wrapper, kind)).toBe(kind === 'card' ? '保留草稿' : '777')
    await answer(wrapper, '离开')
    await navigation
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(path(kind, 'B'))
    expect(saveButton(wrapper, kind).attributes('disabled')).toBeDefined()
    expect(dashboardApi.replaceLayout).not.toHaveBeenCalled()
  })

  it('同屏换节点也先确认，确认后新草稿只保存到当前节点', async () => {
    const { wrapper, router } = await render(kind)
    await dirty(wrapper, kind)
    const navigation = router.push(path(kind, 'A', 'n2'))
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    await answer(wrapper, '离开')
    await navigation
    await flushPromises()
    expect(saveButton(wrapper, kind).attributes('disabled')).toBeDefined()
    await dirty(wrapper, kind)
    await saveButton(wrapper, kind).trigger('click')
    await flushPromises()
    const body = vi.mocked(dashboardApi.replaceLayout).mock.calls[0]?.[1]
    const savedNode = body?.nodes.find((one) => one.id === 'n2')
    const otherNode = body?.nodes.find((one) => one.id === 'n1')
    expect(savedNode?.config_json).toMatchObject(
      kind === 'card'
        ? { cells: [{ label: '保留草稿', unit: '℃' }] }
        : { [TWIN_2D_CONFIG_KEY]: { canvas: { width: 777 } } },
    )
    expect(otherNode?.config_json).toMatchObject(
      kind === 'card'
        ? { cells: [{ label: 'A:n1', unit: '℃' }] }
        : { [TWIN_2D_CONFIG_KEY]: { canvas: { width: 800 } } },
    )
  })

  it('只改查询参数保留草稿且无需离开确认', async () => {
    const { wrapper, router } = await render(kind)
    await dirty(wrapper, kind)
    await router.push(`${path(kind, 'A')}?theme=light`)
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(draftValue(wrapper, kind)).toBe(kind === 'card' ? '保留草稿' : '777')
    expect(saveButton(wrapper, kind).attributes('disabled')).toBeUndefined()
  })

  it('无草稿时参数切换直接加载目标', async () => {
    const { wrapper, router } = await render(kind)
    await router.push(path(kind, 'B'))
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(path(kind, 'B'))
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(saveButton(wrapper, kind).attributes('disabled')).toBeDefined()
  })
})
