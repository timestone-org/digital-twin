/**
 * @fileoverview 契约：布局或元数据任一轴脏着才落草稿（10 秒定时 / 关页 / 卸载 /
 * 站内跳转前），离开守卫先落盘再问；恢复链一次 apply 回布局（可一步撤销）、
 * 元数据逐段回灌且同构段跳写、editor 段走归一化 setter。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef, type ShallowRef } from 'vue'
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'

import {
  useDashboardEditor,
  type DashboardEditor,
} from '@/composables/useDashboardEditor'
import { writeDraft } from '@/pages/DashboardEditor/scripts/editorDraft'
import { useEditorDraftFlow } from '@/pages/DashboardEditor/scripts/useEditorDraftFlow'
import {
  useEditorMeta,
  type EditorMeta,
} from '@/pages/DashboardEditor/scripts/useEditorMeta'

const guard = vi.hoisted(() => ({
  current: null as (() => Promise<boolean> | boolean) | null,
}))

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (fn: () => Promise<boolean> | boolean) => {
    guard.current = fn
  },
}))

const KEY = 'dt.editor.draft.db1'

function payload(over: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    id: 'db1',
    projectId: 'p1',
    name: '一号大屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: { card: { radius: 8 } },
    rowVersion: 7,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '',
    updatedAt: 'v-2026',
    nodes: [],
    ...over,
  }
}

function node(id: string): DashboardNodePayload {
  return {
    id,
    dashboardId: 'db1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
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

interface Harness {
  editor: DashboardEditor
  meta: EditorMeta
  dashboard: ShallowRef<DashboardPayload | null>
  confirmSpy: ReturnType<typeof vi.fn>
  restoreEditorSection: ReturnType<typeof vi.fn>
  setChromeSection: ReturnType<typeof vi.fn>
  wrapper: ReturnType<typeof mount>
}

function setup(confirmAnswer = false): Harness {
  const dashboard = shallowRef<DashboardPayload | null>(payload())
  const confirmSpy = vi.fn(() => Promise.resolve(confirmAnswer))
  const restoreEditorSection = vi.fn()
  let editor!: DashboardEditor
  let meta!: EditorMeta
  let setChromeSection!: ReturnType<typeof vi.fn>
  const host = defineComponent({
    setup() {
      editor = useDashboardEditor(() => undefined)
      editor.reset([node('a')])
      meta = useEditorMeta(dashboard)
      setChromeSection = vi.fn(meta.setChromeSection)
      useEditorDraftFlow({
        editor,
        dashboard,
        meta: { ...meta, setChromeSection },
        restoreEditorSection,
        confirm: { ask: confirmSpy },
      })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return {
    editor,
    meta,
    dashboard,
    confirmSpy,
    restoreEditorSection,
    setChromeSection,
    wrapper,
  }
}

function storedDraft(): {
  nodes: DashboardNodePayload[]
  meta: { name: string } | null
  basedOnUpdatedAt: string
} | null {
  const raw = localStorage.getItem(KEY)
  if (raw === null) return null
  return JSON.parse(raw) as ReturnType<typeof storedDraft>
}

beforeEach(() => {
  vi.useFakeTimers()
  guard.current = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('定时落盘', () => {
  it('两轴都干净时到点也不写', () => {
    const ctx = setup()

    vi.advanceTimersByTime(10_000)

    expect(storedDraft()).toBeNull()
    ctx.wrapper.unmount()
  })

  it('布局脏着每 10 秒落一次，草稿带上节点、元数据与基版本', () => {
    const ctx = setup()
    ctx.editor.apply((nodes) => [...nodes, node('b')])

    vi.advanceTimersByTime(10_000)

    const draft = storedDraft()
    expect(draft?.nodes.map((item) => item.id)).toEqual(['a', 'b'])
    expect(draft?.basedOnUpdatedAt).toBe('v-2026')
    expect(draft?.meta?.name).toBe('一号大屏')
    ctx.wrapper.unmount()
  })

  it('只有元数据轴脏也落盘——丢 meta 的旧草稿缺陷不再回来', () => {
    const ctx = setup()
    ctx.meta.setField('name', '改过的名字')

    vi.advanceTimersByTime(10_000)

    expect(storedDraft()?.meta?.name).toBe('改过的名字')
    ctx.wrapper.unmount()
  })
})

describe('关页与卸载', () => {
  it('脏着关页：先落草稿，再 preventDefault 让浏览器问一句', () => {
    const ctx = setup()
    ctx.editor.apply((nodes) => [...nodes, node('b')])

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(storedDraft()).not.toBeNull()
    ctx.wrapper.unmount()
  })

  it('干净时关页不拦', () => {
    const ctx = setup()

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(storedDraft()).toBeNull()
    ctx.wrapper.unmount()
  })

  it('卸载时落一次盘（路由切走的兜底）', () => {
    const ctx = setup()
    ctx.editor.apply((nodes) => [...nodes, node('b')])

    ctx.wrapper.unmount()

    expect(storedDraft()?.nodes).toHaveLength(2)
  })
})

describe('离开守卫', () => {
  it('干净时放行，不弹确认', async () => {
    const ctx = setup()

    expect(guard.current).not.toBeNull()
    expect(await guard.current?.()).toBe(true)
    expect(ctx.confirmSpy).not.toHaveBeenCalled()
    ctx.wrapper.unmount()
  })

  it('脏着先落草稿再弹危险确认「离开编辑器 / 仍要离开」，拒绝即拦下', async () => {
    const ctx = setup()
    ctx.editor.apply((nodes) => [...nodes, node('b')])

    expect(await guard.current?.()).toBe(false)

    expect(storedDraft()).not.toBeNull()
    expect(ctx.confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '离开编辑器',
        confirmText: '仍要离开',
        danger: true,
      }),
    )
    ctx.wrapper.unmount()
  })

  it('元数据轴脏同样触发守卫', async () => {
    const ctx = setup()
    ctx.meta.setField('designWidth', 2560)

    expect(await guard.current?.()).toBe(false)
    expect(ctx.confirmSpy).toHaveBeenCalledTimes(1)
    ctx.wrapper.unmount()
  })
})

describe('进屏恢复', () => {
  function seedDraft(
    over: { name?: string; chromeJson?: Record<string, unknown> } = {},
  ): void {
    writeDraft('db1', 'v-2026', [node('x'), node('y')], {
      name: over.name ?? '草稿里的名字',
      description: '草稿描述',
      designWidth: 2560,
      designHeight: 1440,
      chromeJson: over.chromeJson ?? {
        card: { radius: 20 },
        editor: { snap: { mode: 'px', step: 10 } },
      },
    })
  }

  it('接受恢复：布局一次 apply（可一步撤销回加载态），元数据逐段回灌', async () => {
    seedDraft()
    const ctx = setup(true)
    await flushPromises()

    expect(ctx.confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: '恢复本地草稿', danger: false }),
    )
    expect(ctx.editor.nodes.value.map((item) => item.id)).toEqual(['x', 'y'])
    expect(ctx.editor.canUndo.value).toBe(true)

    ctx.editor.undo()
    expect(ctx.editor.nodes.value.map((item) => item.id)).toEqual(['a'])

    expect(ctx.meta.draft.value).toMatchObject({
      name: '草稿里的名字',
      description: '草稿描述',
      designWidth: 2560,
      designHeight: 1440,
    })
    expect(ctx.meta.draft.value?.chromeJson.card).toEqual({ radius: 20 })
    ctx.wrapper.unmount()
  })

  it('editor 段（吸附/栅格）不直写 chromeJson，走归一化回灌口', async () => {
    seedDraft()
    const ctx = setup(true)
    await flushPromises()

    expect(ctx.restoreEditorSection).toHaveBeenCalledWith({
      snap: { mode: 'px', step: 10 },
    })
    expect(ctx.setChromeSection).not.toHaveBeenCalledWith(
      'editor',
      expect.anything(),
    )
    ctx.wrapper.unmount()
  })

  it('段同构时跳写：card 段与当前一致就不动它，不造假脏', async () => {
    seedDraft({ chromeJson: { card: { radius: 8 } } })
    const ctx = setup(true)
    await flushPromises()

    expect(ctx.setChromeSection).not.toHaveBeenCalled()
    ctx.wrapper.unmount()
  })

  it('拒绝恢复即清草稿，文档保持加载态', async () => {
    seedDraft()
    const ctx = setup(false)
    await flushPromises()

    expect(localStorage.getItem(KEY)).toBeNull()
    expect(ctx.editor.nodes.value.map((item) => item.id)).toEqual(['a'])
    ctx.wrapper.unmount()
  })

  it('换一张大屏时对新屏再提议一次', async () => {
    const ctx = setup(true)
    await flushPromises()
    expect(ctx.confirmSpy).not.toHaveBeenCalled()

    writeDraft('db2', 'v-2', [node('z')], null)
    ctx.dashboard.value = payload({ id: 'db2', updatedAt: 'v-2' })
    await flushPromises()

    expect(ctx.confirmSpy).toHaveBeenCalledTimes(1)
    expect(ctx.editor.nodes.value.map((item) => item.id)).toEqual(['z'])
    ctx.wrapper.unmount()
  })
})
