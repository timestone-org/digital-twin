/**
 * @fileoverview 契约：跨屏跳转的「怎么跳」只有宿主页面这一份实现——
 * 联动引擎只算出目标句柄，路由由这一页拼；跳到当前这张屏一律不跳。
 * 这一页还要告诉每个控件**当前是哪张屏**，页签栏据此高亮自己那一格。
 * ⚠ 自跳不挡的话，`router.push` 到同一路由既不重载也不报错，
 * 表现正好是这套里最不想要的那种「点了没反应」；而不给当前句柄的话，
 * 一条摆在几张屏上的页签栏高亮永远停在配置里那个静态下标上，用户按着
 * 高亮去点，点的正是自己那一格，同样是「点了没反应」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import { __resetConfigControls, __resetModules } from '@dt/modules'
import { __resetProviders } from '@dt/datasources'
import type { DashboardPayload } from '@dt/contracts'

import { __resetDashboardBootstrap } from '@/bootstrap/dashboard'
import DashboardView from '@/pages/DashboardView/index.vue'

const push = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { dashboardId: 'd-1' }, path: '/dashboards/d-1' }),
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected: ref(true),
    connectionState: ref('open'),
    subscribe: vi.fn(() => () => undefined),
    onSystem: vi.fn(() => () => undefined),
  }),
}))

const dashboard = shallowRef<DashboardPayload | null>(null)

vi.mock('@/composables/useDashboardDoc', () => ({
  useDashboardDoc: () => ({
    dashboard,
    loading: ref(false),
    saving: ref(false),
    error: ref<string | null>(null),
    conflict: ref<string | null>(null),
    load: vi.fn(() => Promise.resolve(dashboard.value)),
    save: vi.fn(),
    dispose: vi.fn(),
  }),
}))

/** 一张只摆了一块可点文字的屏，文字上挂一条跳转规则。 */
function payloadJumpingTo(target: string): DashboardPayload {
  return {
    id: 'd-1',
    projectId: 'p-1',
    name: '总览屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {
      interactions: [
        {
          id: 'r-1',
          source: { nodeId: 'n-1', event: 'click' },
          action: { type: 'navigate', target },
        },
      ],
    },
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '2026-08-18T00:00:00Z',
    updatedAt: '2026-08-18T00:00:00Z',
    nodes: [
      {
        id: 'n-1',
        dashboardId: 'd-1',
        parentId: null,
        clientKey: null,
        moduleType: 'text-block',
        x: 0,
        y: 0,
        w: 400,
        h: 80,
        zIndex: 0,
        isVisible: true,
        configJson: { text: '进能耗屏' },
        createdAt: '2026-08-18T00:00:00Z',
        updatedAt: '2026-08-18T00:00:00Z',
        bindings: [],
      },
    ],
  }
}

beforeEach(() => {
  push.mockClear()
  dashboard.value = null
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
})

/** 挂上页面并点那块可点的模块。 */
async function clickTheModule(target: string) {
  dashboard.value = payloadJumpingTo(target)
  const wrapper = mount(DashboardView)
  await flushPromises()
  await vi.waitFor(() =>
    expect(wrapper.find('.dt-module--clickable').exists()).toBe(true),
  )
  await wrapper.find('.dt-module--clickable').trigger('click')
  return wrapper
}

describe('跨屏跳转', () => {
  it('点配了跳转规则的模块，跳到目标大屏的运行态路由', async () => {
    const wrapper = await clickTheModule('d-2')

    expect(push).toHaveBeenCalledWith({
      name: 'dashboard-view',
      params: { dashboardId: 'd-2' },
    })
    wrapper.unmount()
  })

  it('目标就是当前这张屏时一次都不跳', async () => {
    const wrapper = await clickTheModule('d-1')

    expect(push).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

/** 一张摆了页签栏的屏：两格各指一张屏，「默认选中」故意配成指向**别的**屏那一格。 */
function payloadWithTabs(): DashboardPayload {
  return {
    ...payloadJumpingTo('d-2'),
    chromeJson: {
      interactions: [
        {
          id: 'r-tabs',
          source: { nodeId: 'n-1', event: 'select' },
          action: {
            type: 'navigateByValue',
            routes: [
              { value: 'here', target: 'd-1' },
              { value: 'there', target: 'd-2' },
            ],
          },
        },
      ],
    },
    nodes: [
      {
        id: 'n-1',
        dashboardId: 'd-1',
        parentId: null,
        clientKey: null,
        moduleType: 'nav-tabs',
        x: 0,
        y: 0,
        w: 420,
        h: 48,
        zIndex: 0,
        isVisible: true,
        configJson: {
          items: [
            { label: '本屏', emitValue: 'here' },
            { label: '那屏', emitValue: 'there' },
          ],
          activeIndex: 2,
        },
        createdAt: '2026-08-18T00:00:00Z',
        updatedAt: '2026-08-18T00:00:00Z',
        bindings: [],
      },
    ],
  }
}

/** 挂上页面，等页签栏那两格出来。 */
async function openTabs() {
  dashboard.value = payloadWithTabs()
  const wrapper = mount(DashboardView)
  await flushPromises()
  await vi.waitFor(() =>
    expect(wrapper.findAll('.dt-tabs__item').length).toBe(2),
  )
  return wrapper
}

function activeLabels(wrapper: Awaited<ReturnType<typeof openTabs>>): string[] {
  return wrapper
    .findAll('.dt-tabs__item')
    .filter((item) => item.attributes('aria-pressed') === 'true')
    .map((item) => item.text())
}

describe('页签栏认出自己在哪张屏', () => {
  it('高亮落在指向当前这张屏的那一格，压过配置里的「默认选中」', async () => {
    const wrapper = await openTabs()

    expect(activeLabels(wrapper)).toEqual(['本屏'])
    wrapper.unmount()
  })

  it('点另一格照旧跳过去', async () => {
    const wrapper = await openTabs()

    await wrapper.findAll('.dt-tabs__item')[1]?.trigger('click')

    expect(push).toHaveBeenCalledWith({
      name: 'dashboard-view',
      params: { dashboardId: 'd-2' },
    })
    wrapper.unmount()
  })
})
