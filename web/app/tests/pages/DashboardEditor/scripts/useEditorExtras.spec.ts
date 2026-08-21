/**
 * @fileoverview 契约：Esc 优先链的页面段——帮助 → 预览 → 挑点面板 → 清选中，
 * 每一下只消费链上最前面的那一层。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, ref, shallowRef } from 'vue'
import type {
  DashboardNodePayload,
  DashboardPayload,
  ModuleManifest,
} from '@dt/contracts'

import {
  useDashboardEditor,
  type DashboardEditor,
} from '@/composables/useDashboardEditor'
import {
  normalizeEditorGrid,
  normalizeSnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import {
  useEditorExtras,
  type EditorExtras,
} from '@/pages/DashboardEditor/scripts/useEditorExtras'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(id: string): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
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
  extras: EditorExtras
  consumePicker: ReturnType<typeof vi.fn>
  wrapper: ReturnType<typeof mount>
}

function setup(pickerConsumes: () => boolean): Harness {
  let editor!: DashboardEditor
  let extras!: EditorExtras
  const consumePicker = vi.fn(pickerConsumes)
  const host = defineComponent({
    setup() {
      editor = useDashboardEditor(() => MANIFEST)
      editor.reset([node('a')])
      const arrange = createArrangeActions({
        editor,
        getManifest: () => MANIFEST,
        design: () => ({ width: 1920, height: 1080 }),
        steps: () => ({ x: 8, y: 8 }),
        dashboardId: () => 'd1',
        chrome: {
          rules: computed(() => []),
          setInteractions: vi.fn(),
          setSnap: vi.fn(),
          setGrid: vi.fn(),
        },
        notify: vi.fn(),
      })
      extras = useEditorExtras({
        editor,
        actions: createEditorActions({
          editor,
          dashboardId: () => 'd1',
          getManifest: () => MANIFEST,
          design: () => ({ width: 1920, height: 1080 }),
        }),
        arrange,
        dashboard: shallowRef<DashboardPayload | null>(null),
        design: () => ({ width: 1920, height: 1080 }),
        snap: () => normalizeSnapConfig(),
        grid: () => normalizeEditorGrid(),
        zoom: ref<CanvasZoom>(1),
        fitScale: () => 1,
        removeSelected: vi.fn(),
        consumePicker,
        save: vi.fn(() => Promise.resolve()),
        confirm: { ask: vi.fn(() => Promise.resolve(false)) },
        stageEl: () => null,
        centerOn: vi.fn(),
        onExportFailed: vi.fn(),
      })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { editor, extras, consumePicker, wrapper }
}

function pressEscape(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Esc 优先链的页面段', () => {
  it('预览开着先关预览：挑点与选中都不动', () => {
    const ctx = setup(() => true)
    ctx.editor.select('a')
    ctx.extras.previewOpen.value = true

    pressEscape()

    expect(ctx.extras.previewOpen.value).toBe(false)
    expect(ctx.consumePicker).not.toHaveBeenCalled()
    expect(ctx.editor.selectedId.value).toBe('a')
    ctx.wrapper.unmount()
  })

  it('预览关了才轮到挑点面板，被消费掉就不清选中', () => {
    const ctx = setup(() => true)
    ctx.editor.select('a')

    pressEscape()

    expect(ctx.consumePicker).toHaveBeenCalledTimes(1)
    expect(ctx.editor.selectedId.value).toBe('a')
    ctx.wrapper.unmount()
  })

  it('链上没人消费时才清选中', () => {
    const ctx = setup(() => false)
    ctx.editor.select('a')

    pressEscape()

    expect(ctx.editor.selectedId.value).toBeNull()
    ctx.wrapper.unmount()
  })

  it('帮助弹窗压过预览：帮助开着那一下只关帮助', () => {
    const ctx = setup(() => true)
    ctx.extras.helpOpen.value = true
    ctx.extras.previewOpen.value = true

    pressEscape()

    expect(ctx.extras.helpOpen.value).toBe(false)
    expect(ctx.extras.previewOpen.value).toBe(true)
    ctx.wrapper.unmount()
  })
})
