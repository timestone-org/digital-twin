/** @fileoverview 整页接线：键盘快捷键落到撤销、保存与删除上，版本冲突给出重新加载。 */
import type { BindingPayload, DashboardPayload } from '@dt/contracts'
import type * as ThreeCore from '@dt/three-core'
import type { EditorSceneOptions } from '@dt/three-core'
import { TWIN_CONFIG_KEY, type TwinConfig } from '@dt/twin-config'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as dashboardApi from '@/api/dashboard'
import { BizError } from '@/api/client'
import { DASHBOARD_VERSION_CONFLICT_CODE } from '@/api/dashboard'
import { useConfirm } from '@dt/ui'
import type * as RealtimeChannel from '@/composables/useRealtimeChannel'
import TwinEditor from '@/pages/TwinEditor/index.vue'
import TwinLeftPane from '@/pages/TwinEditor/components/TwinLeftPane.vue'

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
  const left = wrapper.getComponent(TwinLeftPane)
  const currentConfig = (): TwinConfig => left.props('config')
  return { wrapper, left, currentConfig }
}

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { cancelable: true, ...init }),
  )
}

enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
  seam.scene = null
  localStorage.clear()
  vi.spyOn(Math, 'random').mockReturnValue(0.25)
})
afterEach(() => vi.restoreAllMocks())

describe('键盘快捷键', () => {
  it('Delete 删掉当前选中，Ctrl+Z 撤回来', async () => {
    const { left, currentConfig } = await setup({
      anchors: [{ id: 'a1', name: '温度' }],
    })
    left.vm.$emit('select', { kind: 'anchors', id: 'a1' })
    await flushPromises()

    press({ key: 'Delete' })
    await flushPromises()
    expect(currentConfig().anchors).toEqual([])

    press({ key: 'z', ctrlKey: true })
    await flushPromises()
    expect(currentConfig().anchors.map((item) => item.id)).toEqual(['a1'])
  })

  it('删除会让别的东西悬空时先确认，取消就不删', async () => {
    const { left, currentConfig } = await setup({
      anchors: [{ id: 'a1' }],
      panels: [{ id: 'p1', anchorId: 'a1' }],
    })
    left.vm.$emit('select', { kind: 'anchors', id: 'a1' })
    await flushPromises()

    press({ key: 'Delete' })
    await flushPromises()
    expect(useConfirm().pending.value?.message).toContain('信息牌')
    useConfirm().resolve(false)
    await flushPromises()

    expect(currentConfig().anchors).toHaveLength(1)
  })
})

describe('版本冲突', () => {
  // ⚠ 冲突时只弹一句「请重新加载」却不给按钮，用户只能自己刷新整页
  it('保存撞上版本冲突时问要不要重新加载，确认就按最新那一版重读', async () => {
    const { left, wrapper } = await setup({ anchors: [{ id: 'a1' }] })
    left.vm.$emit('add', 'cameras')
    await flushPromises()
    vi.spyOn(dashboardApi, 'replaceLayout').mockRejectedValue(
      new BizError(DASHBOARD_VERSION_CONFLICT_CODE, '版本旧了', 409, 't'),
    )
    const reloads = vi.mocked(dashboardApi.getDashboard)
    const before = reloads.mock.calls.length

    await wrapper.get('[data-test="save"]').trigger('click')
    await flushPromises()
    expect(useConfirm().pending.value?.confirmText).toBe('重新加载')
    useConfirm().resolve(true)
    await flushPromises()

    expect(reloads.mock.calls.length).toBe(before + 1)
  })
})
