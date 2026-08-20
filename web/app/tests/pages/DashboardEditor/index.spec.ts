/**
 * @fileoverview 编辑器主体的行为契约。最要紧的三条不是渲染对不对，而是：
 * 保存必带 `expected_version` 且 **409 走「重新加载」而不是静默覆盖**；
 * 换大屏时按序号防竞态、慢的那次回来不许覆盖新屏；
 * 删节点前二次确认，且文案说清连子树一起删（ADR-0012）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { DashboardPayload } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import { BizError } from '@/api/client'
import { VERSION_CONFLICT_MESSAGE } from '@/composables/useDashboardDoc'
import DashboardEditor from '@/pages/DashboardEditor/index.vue'
import { useAuthStore } from '@/stores/auth'
import type * as RealtimeChannel from '@/composables/useRealtimeChannel'

// ⚠ 通道必须打桩：不桩的话挂载就真的开一条 WebSocket，它排下的重连定时器
// 会在测试环境拆掉之后到点，整轮 vitest 因此报一条未处理异常（见 testing/realtimeChannel）
vi.mock('@/composables/useRealtimeChannel', async () => {
  const actual = await vi.importActual<typeof RealtimeChannel>(
    '@/composables/useRealtimeChannel',
  )
  const { fakeRealtimeChannel } = await import('@/testing/realtimeChannel')
  const channel = fakeRealtimeChannel()
  return { ...actual, useRealtimeChannel: () => channel }
})

const route = {
  path: '/dashboards/db1/edit',
  params: { dashboardId: 'db1' },
  query: {},
}

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => route,
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

interface ConfirmAsk {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}
const confirmSpy = vi.fn<(request: ConfirmAsk) => Promise<boolean>>()
const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
    }),
  }
})

function payload(over: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    id: 'db1',
    projectId: 'p1',
    name: '一号大屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {},
    rowVersion: 7,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '',
    updatedAt: '',
    nodes: [],
    ...over,
  }
}

function node(id: string) {
  return {
    id,
    dashboardId: 'db1',
    parentId: null,
    clientKey: null,
    moduleType: 'header',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

async function mountEditor() {
  const wrapper = mount(DashboardEditor, {
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}

function buttonWith(
  wrapper: Awaited<ReturnType<typeof mountEditor>>,
  text: string,
) {
  // 图标键没有文字，按 aria-label 兜底认
  return wrapper
    .findAll('button')
    .find(
      (item) =>
        item.text().includes(text) || item.attributes('aria-label') === text,
    )
}

beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.accessToken = null
  confirmSpy.mockReset()
  confirmSpy.mockResolvedValue(false)
  toastError.mockReset()
  toastSuccess.mockReset()
  vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(payload())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('加载', () => {
  it('把大屏名放进标题，模块库列出已注册的模块', async () => {
    const wrapper = await mountEditor()

    expect(wrapper.text()).toContain('一号大屏')
    expect(wrapper.findAll('.dt-lib__item').length).toBeGreaterThan(0)
  })

  it('加载失败时把原因显示出来', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockRejectedValue(
      new BizError(40400, '大屏不存在', 404, 't'),
    )
    const wrapper = await mountEditor()

    expect(wrapper.text()).toContain('大屏不存在')
  })

  it('父节点不存在的节点不画出来，但要提示有几个', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(
      payload({ nodes: [{ ...node('orphan'), parentId: 'gone' }] }),
    )
    const wrapper = await mountEditor()

    expect(wrapper.text()).toContain('父节点不存在')
  })
})

describe('加模块与保存', () => {
  it('刚加载完不脏，保存键是禁用的', async () => {
    const wrapper = await mountEditor()

    expect(buttonWith(wrapper, '保存')?.attributes('disabled')).toBeDefined()
  })

  it('从模块库加一个模块之后置脏，保存带上当前行版本', async () => {
    const replace = vi
      .spyOn(dashboardApi, 'replaceLayout')
      .mockResolvedValue(payload({ rowVersion: 8 }))
    const wrapper = await mountEditor()

    await wrapper.findAll('.dt-lib__item')[0]?.trigger('click')
    expect(wrapper.text()).toContain('未保存')

    await buttonWith(wrapper, '保存')?.trigger('click')
    await flushPromises()

    expect(replace.mock.calls[0]?.[1]).toMatchObject({ expectedVersion: 7 })
    expect(replace.mock.calls[0]?.[1].nodes).toHaveLength(1)
    expect(toastSuccess).toHaveBeenCalledWith('大屏已保存')
  })

  it('保存成功之后回到不脏，保存键重新禁用', async () => {
    vi.spyOn(dashboardApi, 'replaceLayout').mockResolvedValue(
      payload({ rowVersion: 8, nodes: [node('n1')] }),
    )
    const wrapper = await mountEditor()
    await wrapper.findAll('.dt-lib__item')[0]?.trigger('click')
    await buttonWith(wrapper, '保存')?.trigger('click')
    await flushPromises()

    expect(buttonWith(wrapper, '保存')?.attributes('disabled')).toBeDefined()
  })
})

describe('版本冲突', () => {
  it('409 时提示「重新加载」并把保存挡住，绝不静默覆盖', async () => {
    vi.spyOn(dashboardApi, 'replaceLayout').mockRejectedValue(
      new BizError(41007, '版本冲突', 409, 't'),
    )
    const wrapper = await mountEditor()
    await wrapper.findAll('.dt-lib__item')[0]?.trigger('click')

    await buttonWith(wrapper, '保存')?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(VERSION_CONFLICT_MESSAGE)
    expect(wrapper.text()).toContain('版本已过期')
    expect(buttonWith(wrapper, '保存')?.attributes('disabled')).toBeDefined()
    expect(toastError).toHaveBeenCalledWith(VERSION_CONFLICT_MESSAGE)
  })

  it('重新加载之后冲突提示消失，草稿换成库里的那份', async () => {
    vi.spyOn(dashboardApi, 'replaceLayout').mockRejectedValue(
      new BizError(41007, '版本冲突', 409, 't'),
    )
    const load = vi
      .spyOn(dashboardApi, 'getDashboard')
      .mockResolvedValue(payload({ rowVersion: 9, nodes: [node('fresh')] }))
    const wrapper = await mountEditor()
    await wrapper.findAll('.dt-lib__item')[0]?.trigger('click')
    await buttonWith(wrapper, '保存')?.trigger('click')
    await flushPromises()

    await buttonWith(wrapper, '重新加载')?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain(VERSION_CONFLICT_MESSAGE)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('撤销与删除', () => {
  it('加了一个模块之后能撤销回去', async () => {
    const wrapper = await mountEditor()
    await wrapper.findAll('.dt-lib__item')[0]?.trigger('click')

    await buttonWith(wrapper, '撤销')?.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.dt-node')).toHaveLength(0)
    expect(buttonWith(wrapper, '重做')?.attributes('disabled')).toBeUndefined()
  })

  it('删节点前二次确认，文案说清连子树与绑定一起删', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(
      payload({ nodes: [node('n1')] }),
    )
    const wrapper = await mountEditor()
    await buttonWith(wrapper, '图层')?.trigger('click')
    const trash = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '删除这个节点')
    expect(trash).toBeDefined()

    await trash?.trigger('click')
    await flushPromises()

    expect(confirmSpy.mock.calls[0]?.[0].message).toContain('全部子节点与绑定')
    expect(wrapper.findAll('.dt-node')).toHaveLength(1)
  })

  it('确认之后节点真的没了', async () => {
    confirmSpy.mockResolvedValue(true)
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(
      payload({ nodes: [node('n1')] }),
    )
    const wrapper = await mountEditor()
    await buttonWith(wrapper, '图层')?.trigger('click')
    const trash = wrapper
      .findAll('button')
      .find((item) => item.attributes('aria-label') === '删除这个节点')
    expect(trash).toBeDefined()

    await trash?.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.dt-node')).toHaveLength(0)
  })
})

describe('属性与绑点', () => {
  it('选中一个节点后属性面板按它的清单泛型渲染', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(
      payload({ nodes: [node('n1')] }),
    )
    const wrapper = await mountEditor()

    await wrapper.find('.dt-node__surface').trigger('pointerdown')
    await flushPromises()

    expect(wrapper.text()).toContain('初始可见')
  })

  // 不取数的模块不给「绑定」页：点进去只能看到一句「不取数」的空页签，
  // 比少一个页签更像是坏了
  it('不取数的模块不出绑定页签', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(
      payload({ nodes: [node('n1')] }),
    )
    const wrapper = await mountEditor()

    await wrapper.find('.dt-node__surface').trigger('pointerdown')
    await flushPromises()

    const labels = wrapper.findAll('button').map((item) => item.text().trim())
    expect(labels).toContain('通用')
    expect(labels).toContain('联动')
    expect(labels).not.toContain('绑定')
  })

  it('切到联动页：整屏没有能点的模块时给一句空态', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(
      payload({ nodes: [node('n1')] }),
    )
    const wrapper = await mountEditor()
    await wrapper.find('.dt-node__surface').trigger('pointerdown')

    const tab = wrapper
      .findAll('button')
      .find((item) => item.text().trim() === '联动')
    await tab?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('没有可交互的模块')
  })
})

// 守画布上抛的 `canvas-menu` 真有人接：没人接时右键静默不出菜单，也不报错
describe('画布右键菜单', () => {
  function menuLabels(wrapper: Awaited<ReturnType<typeof mountEditor>>) {
    return wrapper
      .findAll('[role="menuitem"]')
      .map((item) => item.attributes('aria-label'))
  }

  it('右键空白处开出画布那套', async () => {
    const wrapper = await mountEditor()

    await wrapper.find('.dt-canvas__grid').trigger('contextmenu')

    expect(menuLabels(wrapper)).toEqual(['粘贴', '全选', '适应窗口'])
  })

  it('右键节点开出节点那套，「删除」仍走二次确认', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(
      payload({ nodes: [node('n1')] }),
    )
    const wrapper = await mountEditor()

    await wrapper.find('.dt-node__surface').trigger('contextmenu')
    expect(menuLabels(wrapper)).toContain('置顶')

    const remove = wrapper
      .findAll('[role="menuitem"]')
      .find((item) => item.attributes('aria-label') === '删除')
    await remove?.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(0)
  })
})
