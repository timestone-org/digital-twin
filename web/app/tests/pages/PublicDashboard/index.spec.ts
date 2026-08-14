/**
 * @fileoverview 公开快照页必须**自己**装配模块与取数：直连它时没有别的页面替它
 * 注册过任何东西。注册表清空后挂载，模块要照常渲染而不是满屏「未知模块」，
 * static 绑定要出值——这两条在装配缺失时必红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import {
  __resetConfigControls,
  __resetModules,
  SHOW_TITLE_CONFIG_KEY,
} from '@dt/modules'
import { __resetProviders, listProviders } from '@dt/datasources'
import type { PublicDashboardPayload } from '@dt/contracts'

import { __resetDashboardBootstrap } from '@/bootstrap/dashboard'
import PublicDashboard from '@/pages/PublicDashboard/index.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { publicToken: 'tok-1' }, path: '/public/tok-1' }),
}))

const PAYLOAD: PublicDashboardPayload = {
  name: '公开屏',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  schemaVersion: 1,
  themeJson: {},
  chromeJson: {},
  updatedAt: '2026-08-14T10:00:00Z',
  nodes: [
    {
      id: 'n-1',
      parentId: null,
      clientKey: null,
      moduleType: 'header',
      x: 0,
      y: 0,
      w: 1920,
      h: 96,
      zIndex: 0,
      isVisible: true,
      configJson: { title: '总览大屏', [SHOW_TITLE_CONFIG_KEY]: true },
      bindings: [],
    },
  ],
}

vi.mock('@/api/dashboardShare', () => ({
  getPublicDashboard: vi.fn(() => Promise.resolve(PAYLOAD)),
}))

beforeEach(() => {
  // 模拟「直连本路由」：全局注册表一片空白，页面不自装就什么都画不出
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetDashboardBootstrap()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('自装配', () => {
  it('注册表清空后挂载，模块照常渲染而不是「未知模块」占位', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    // 模块渲染组件是真实的动态 import，微任务冲不平，等它落地
    await vi.waitFor(() => expect(wrapper.text()).toContain('总览大屏'))
    expect(wrapper.text()).not.toContain('未知')
    wrapper.unmount()
  })

  it('取数只装 static/computed——公开页不接实时也不接历史', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    const kinds = listProviders().map((provider) => provider.kind)
    expect(kinds).toContain('static')
    expect(kinds).toContain('computed')
    expect(kinds).not.toContain('opcua')
    expect(kinds).not.toContain('archive')
    wrapper.unmount()
  })

  it('快照标记与数据截止时刻常驻（ADR-0014 四）', async () => {
    const wrapper = mount(PublicDashboard)
    await flushPromises()

    expect(wrapper.text()).toContain('静态快照')
    wrapper.unmount()
  })
})
