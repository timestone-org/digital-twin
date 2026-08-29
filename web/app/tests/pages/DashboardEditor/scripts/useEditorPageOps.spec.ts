/**
 * @fileoverview 契约：批量显隐从页面口一路写**全部选中集**（不再只写主选中），
 * 面板改几何按「恰好一维在变」推断维度键（改 X 再改 W 各成一笔），
 * 且工厂装配时挂上离开守卫与挑点 Esc 出口。
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, shallowRef } from 'vue'
import type {
  DashboardNodePayload,
  DashboardPayload,
  ModuleManifest,
} from '@dt/contracts'
import { computed } from 'vue'

import type { DashboardDoc } from '@/composables/useDashboardDoc'
import {
  useDashboardEditor,
  type DashboardEditor,
} from '@/composables/useDashboardEditor'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import {
  createEditorPageOps,
  type EditorPageOps,
} from '@/pages/DashboardEditor/scripts/useEditorPageOps'
import { useEditorMeta } from '@/pages/DashboardEditor/scripts/useEditorMeta'

const guard = vi.hoisted(() => ({ current: null as (() => unknown) | null }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  onBeforeRouteLeave: (fn: () => unknown) => {
    guard.current = fn
  },
}))

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function payload(): DashboardPayload {
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
    updatedAt: 'v-1',
    nodes: [],
  }
}

function node(
  id: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
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
    ...over,
  }
}

function fakeDoc(): DashboardDoc {
  return {
    dashboard: shallowRef<DashboardPayload | null>(payload()),
    loading: ref(false),
    saving: ref(false),
    error: ref<string | null>(null),
    conflict: ref<string | null>(null),
    load: vi.fn(() => Promise.resolve(null)),
    save: vi.fn(() => Promise.resolve(null)),
    saveMeta: vi.fn(() => Promise.resolve(null)),
    dispose: vi.fn(),
  }
}

interface Harness {
  editor: DashboardEditor
  ops: EditorPageOps
  picking: ReturnType<typeof ref<string | null>>
  wrapper: ReturnType<typeof mount>
}

function setup(
  nodes: DashboardNodePayload[],
  manifest?: ModuleManifest,
): Harness {
  const picking = ref<string | null>(null)
  let editor!: DashboardEditor
  let ops!: EditorPageOps
  const host = defineComponent({
    setup() {
      editor = useDashboardEditor(() => MANIFEST)
      editor.reset(nodes)
      const file = fakeDoc()
      const actions = createEditorActions({
        editor,
        dashboardId: () => 'db1',
        getManifest: () => MANIFEST,
        design: () => ({ width: 1920, height: 1080 }),
      })
      const arrange = createArrangeActions({
        editor,
        getManifest: () => MANIFEST,
        design: () => ({ width: 1920, height: 1080 }),
        steps: () => ({ x: 10, y: 10 }),
        dashboardId: () => 'db1',
        chrome: {
          rules: computed(() => []),
          setInteractions: vi.fn(),
          setSnap: vi.fn(),
          setGrid: vi.fn(),
        },
        notify: vi.fn(),
      })
      ops = createEditorPageOps({
        editor,
        actions,
        arrange,
        file,
        meta: useEditorMeta(file.dashboard),
        confirm: { ask: vi.fn(() => Promise.resolve(false)) },
        toast: { error: vi.fn(), success: vi.fn() },
        dashboardId: () => 'db1',
        pickingFieldKey: picking,
        getManifest: () => manifest,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { editor, ops, picking, wrapper }
}

beforeEach(() => {
  guard.current = null
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('批量显隐', () => {
  it('写的是整个选中集，一步撤销全体退回', () => {
    const ctx = setup([node('a'), node('b'), node('c')])
    ctx.editor.setSelection(['a', 'b'])

    ctx.ops.toggleSelectedVisible(false)

    const visibles = ctx.editor.nodes.value.map((item) => item.isVisible)
    expect(visibles).toEqual([false, false, true])

    ctx.editor.undo()
    expect(ctx.editor.nodes.value.every((item) => item.isVisible)).toBe(true)
    ctx.wrapper.unmount()
  })

  it('单选时就是主选中一个', () => {
    const ctx = setup([node('a'), node('b')])
    ctx.editor.select('a')

    ctx.ops.toggleSelectedVisible(false)

    expect(ctx.editor.nodes.value.map((item) => item.isVisible)).toEqual([
      false,
      true,
    ])
    ctx.wrapper.unmount()
  })

  it('全体已是目标值时不置脏不记撤销', () => {
    const ctx = setup([node('a'), node('b')])
    ctx.editor.setSelection(['a', 'b'])

    ctx.ops.toggleSelectedVisible(true)

    expect(ctx.editor.isDirty.value).toBe(false)
    expect(ctx.editor.canUndo.value).toBe(false)
    ctx.wrapper.unmount()
  })
})

describe('面板改几何的维度推断', () => {
  it('恰好一维在变时按维度并笔：改 X 再改 W 各成一笔', () => {
    const ctx = setup([node('a')])
    ctx.editor.select('a')

    ctx.ops.changeSelectedGeometry({ x: 30, y: 0, w: 100, h: 50 }, true)
    ctx.ops.changeSelectedGeometry({ x: 30, y: 0, w: 200, h: 50 }, true)

    ctx.editor.undo()
    expect(ctx.editor.nodes.value[0]).toMatchObject({ x: 30, w: 100 })
    ctx.editor.undo()
    expect(ctx.editor.nodes.value[0]).toMatchObject({ x: 0, w: 100 })
    ctx.wrapper.unmount()
  })

  it('多维同时变（拖拽路径）不细分维度，连续帧并成一笔', () => {
    const ctx = setup([node('a')])
    ctx.editor.select('a')

    ctx.ops.changeSelectedGeometry({ x: 10, y: 10, w: 100, h: 50 }, true)
    ctx.ops.changeSelectedGeometry({ x: 20, y: 20, w: 100, h: 50 }, true)

    ctx.editor.undo()
    expect(ctx.editor.nodes.value[0]).toMatchObject({ x: 0, y: 0 })
    ctx.wrapper.unmount()
  })

  it('没选中时什么也不做', () => {
    const ctx = setup([node('a')])

    ctx.ops.changeSelectedGeometry({ x: 9, y: 9, w: 9, h: 9 }, false)

    expect(ctx.editor.isDirty.value).toBe(false)
    ctx.wrapper.unmount()
  })
})

describe('装配', () => {
  it('工厂挂上离开守卫（草稿流装在页面操作组里）', () => {
    const ctx = setup([node('a')])

    expect(guard.current).not.toBeNull()
    ctx.wrapper.unmount()
  })

  it('挑点面板开着时 Esc 先关它并报告已消费，关完再按不消费', () => {
    const ctx = setup([node('a')])
    ctx.picking.value = 'field-1'

    expect(ctx.ops.consumePicker()).toBe(true)
    expect(ctx.picking.value).toBeNull()
    expect(ctx.ops.consumePicker()).toBe(false)
    ctx.wrapper.unmount()
  })
})

describe('子编辑器入口', () => {
  // ⚠ 与属性面板落到同一个出口：各写一份的话「先保存再跳」这条前置只会在其中一条上
  it('按节点开时先把它选中，动作层与用户都看得见是哪一个', () => {
    const ctx = setup([node('a'), node('b')], {
      ...MANIFEST,
      subEditor: {
        configKey: 'parts',
        routeName: 'card-editor',
        label: '自定义卡片',
      },
    })

    ctx.ops.openSubEditor('b')

    expect(ctx.editor.selectedId.value).toBe('b')
  })

  // ⚠ 读声明不读模块类型：没有声明的节点这条入口本就不该出现，点了也不该有反应
  it('没有声明子编辑器的节点点了什么都不做', () => {
    const ctx = setup([node('a')])

    ctx.ops.openSubEditor('a')

    expect(ctx.editor.selectedId.value).toBeNull()
  })
})
