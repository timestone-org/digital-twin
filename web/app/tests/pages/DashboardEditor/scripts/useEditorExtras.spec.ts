/**
 * @fileoverview 契约：Esc 优先链的页面段——帮助 → 预览 → 挑点面板 → 清选中，
 * 每一下只消费链上最前面的那一层；以及导出 JSON 落盘的必须是线形整包。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, ref, shallowRef } from 'vue'
import type {
  DashboardExportPayload,
  DashboardNodePayload,
  DashboardPayload,
  ModuleManifest,
} from '@dt/contracts'

import { exportDashboard } from '@/api/dashboardTransfer'
import { parseExportPackage } from '@/api/dashboardTransferWire'
import { downloadJson } from '@/utils/downloadJson'
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
  readDraft,
  writeDraft,
} from '@/pages/DashboardEditor/scripts/editorDraft'
import { captureThumbnail } from '@/pages/DashboardEditor/scripts/editorThumbnail'
import { activeSurface } from '@/features/ai/surfaces'
import {
  useEditorExtras,
  type EditorExtras,
} from '@/pages/DashboardEditor/scripts/useEditorExtras'

vi.mock('@/api/dashboardTransfer', () => ({ exportDashboard: vi.fn() }))
vi.mock('@/utils/downloadJson', () => ({ downloadJson: vi.fn() }))
vi.mock('@/pages/DashboardEditor/scripts/editorThumbnail', () => ({
  captureThumbnail: vi.fn(() => Promise.resolve(true)),
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
  save: ReturnType<typeof vi.fn>
  wrapper: ReturnType<typeof mount>
}

function setup(
  pickerConsumes: () => boolean,
  dashboard: DashboardPayload | null = null,
  isMetaDirty: () => boolean = () => false,
): Harness {
  let editor!: DashboardEditor
  let extras!: EditorExtras
  const consumePicker = vi.fn(pickerConsumes)
  const save = vi.fn(() => Promise.resolve({ isSaved: true, message: null }))
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
        dashboard: shallowRef<DashboardPayload | null>(dashboard),
        design: () => ({ width: 1920, height: 1080 }),
        snap: () => normalizeSnapConfig(),
        grid: () => normalizeEditorGrid(),
        zoom: ref<CanvasZoom>(1),
        fitScale: () => 1,
        openSubEditor: vi.fn(),
        removeSelected: vi.fn(),
        consumePicker,
        save,
        isMetaDirty,
        confirm: { ask: vi.fn(() => Promise.resolve(false)) },
        chrome: {
          card: computed(() => ({})),
          rules: computed(() => []),
          setCard: vi.fn(),
          setInteractions: vi.fn(),
        },
        stageEl: () => null,
        centerOn: vi.fn(),
        onExportFailed: vi.fn(),
        getManifest: () => MANIFEST,
        dashboardId: () => 'd1',
        readSample: () => undefined,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { editor, extras, consumePicker, save, wrapper }
}

function pressEscape(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

afterEach(() => {
  localStorage.clear()
  vi.mocked(captureThumbnail).mockClear()
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

const DASHBOARD: DashboardPayload = {
  id: 'd1',
  projectId: 'p1',
  name: '演示屏',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  themeJson: {},
  chromeJson: {},
  rowVersion: 1,
  schemaVersion: 2,
  isPublic: false,
  createdAt: '',
  updatedAt: '',
  nodes: [],
}

const EXPORT_PAYLOAD: DashboardExportPayload = {
  schemaVersion: 2,
  name: '演示屏',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  themeJson: {},
  chromeJson: {},
  nodes: [
    {
      clientKey: 'k1',
      parentClientKey: null,
      moduleType: 'demo',
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      zIndex: 0,
      isVisible: true,
      configJson: {},
      bindings: [],
    },
  ],
}

describe('主题草稿保存', () => {
  function storeThemeDraft(): void {
    writeDraft(DASHBOARD.id, DASHBOARD.updatedAt, DASHBOARD.nodes, {
      name: DASHBOARD.name,
      description: DASHBOARD.description,
      designWidth: DASHBOARD.designWidth,
      designHeight: DASHBOARD.designHeight,
      themeJson: { __base: 'emerald' },
      chromeJson: {},
    })
  }

  it('仅修改主题保存失败时保留本地草稿，并不生成未保存主题的缩略图', async () => {
    const ctx = setup(() => false, DASHBOARD)
    storeThemeDraft()
    ctx.save.mockResolvedValue({ isSaved: false, message: null })
    expect(ctx.editor.isDirty.value).toBe(false)

    const outcome = await ctx.extras.saveWithThumbnail()

    expect(outcome.isSaved).toBe(false)
    expect(
      readDraft(DASHBOARD.id, DASHBOARD.updatedAt)?.meta?.themeJson,
    ).toEqual({
      __base: 'emerald',
    })
    expect(captureThumbnail).not.toHaveBeenCalled()
    ctx.wrapper.unmount()
  })

  it('主题保存成功后清除本地草稿并刷新缩略图', async () => {
    const ctx = setup(() => false, DASHBOARD)
    storeThemeDraft()

    const outcome = await ctx.extras.saveWithThumbnail()

    expect(outcome.isSaved).toBe(true)
    expect(readDraft(DASHBOARD.id, DASHBOARD.updatedAt)).toBeNull()
    expect(captureThumbnail).toHaveBeenCalledWith(DASHBOARD.id, null)
    ctx.wrapper.unmount()
  })

  it('保存期间又修改主题时保留新草稿，不生成旧主题的缩略图', async () => {
    const ctx = setup(
      () => false,
      DASHBOARD,
      () => true,
    )
    storeThemeDraft()

    const outcome = await ctx.extras.saveWithThumbnail()

    expect(outcome.isSaved).toBe(true)
    expect(
      readDraft(DASHBOARD.id, DASHBOARD.updatedAt)?.meta?.themeJson,
    ).toEqual({ __base: 'emerald' })
    expect(captureThumbnail).not.toHaveBeenCalled()
    ctx.wrapper.unmount()
  })
})

describe('导出 JSON', () => {
  it('落盘的是线形整包：导入端的 parseExportPackage 能原样读回', async () => {
    const ctx = setup(() => true, DASHBOARD)
    vi.mocked(exportDashboard).mockResolvedValue(EXPORT_PAYLOAD)

    await ctx.extras.exportJson()

    expect(downloadJson).toHaveBeenCalledTimes(1)
    expect(vi.mocked(downloadJson).mock.calls[0]?.[1]).toBe('演示屏')
    const saved = vi.mocked(downloadJson).mock.calls[0]?.[0]
    expect(parseExportPackage(saved)).toEqual(EXPORT_PAYLOAD)
    ctx.wrapper.unmount()
  })
})

describe('助手的保存工具', () => {
  it('接的是页面那条保存路径，不是另写的一套', async () => {
    const ctx = setup(() => true, DASHBOARD)

    await activeSurface()?.run({
      call_id: 'c1',
      name: 'dashboard.save',
      arguments: {},
    })

    // 另起一条的话，助手保存完的那张屏不清草稿也不换缩略图，两处都看不出
    expect(ctx.save).toHaveBeenCalledTimes(1)
    ctx.wrapper.unmount()
  })

  it('这一页确实把保存工具亮出来了——没亮的话模型压根不会去存', () => {
    const ctx = setup(() => true, DASHBOARD)
    expect(activeSurface()?.tools).toContain('dashboard.save')
    ctx.wrapper.unmount()
  })
})
