/**
 * @fileoverview 契约：外观预设是**浅合并**落库（预设没提到的键原样保留），
 * 多选同类型时对全体各自浅合并、一次 apply 一步撤销；混合类型退回只写主选中。
 */
import { describe, expect, it, vi } from 'vitest'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { computed, shallowRef } from 'vue'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createEditorInspector } from '@/pages/DashboardEditor/scripts/useEditorInspector'
import type {
  EditorMeta,
  EditorMetaDraft,
} from '@/pages/DashboardEditor/scripts/useEditorMeta'
import type { EditorSurface } from '@/pages/DashboardEditor/scripts/useEditorSurface'

const CARD: ModuleManifest = {
  type: 'demo-card',
  displayName: '演示卡片',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}
const CHART: ModuleManifest = { ...CARD, type: 'demo-chart' }

function getManifest(moduleType: string): ModuleManifest | undefined {
  if (moduleType === CARD.type) return CARD
  return moduleType === CHART.type ? CHART : undefined
}

function node(
  id: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: CARD.type,
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

function surfaceSpy(): EditorSurface {
  return {
    onSelect: vi.fn(),
    onMarquee: vi.fn(),
    onChangeBatch: vi.fn(),
    onDropNode: vi.fn(),
    onAddAt: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onFront: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onBackward: vi.fn(),
  }
}

function metaStub(): EditorMeta {
  return {
    draft: shallowRef<EditorMetaDraft | null>(null),
    isDirty: computed(() => false),
    setField: vi.fn(),
    setChromeSection: vi.fn(),
    toPatch: () => null,
    reset: vi.fn(),
  }
}

function setup(nodes: DashboardNodePayload[]) {
  const editor = useDashboardEditor(getManifest)
  editor.reset(nodes)
  const actions = createEditorActions({
    editor,
    dashboardId: () => 'd1',
    getManifest,
    design: () => ({ width: 1920, height: 1080 }),
  })
  const surface = surfaceSpy()
  const centerOn = vi.fn()
  const inspector = createEditorInspector({
    editor,
    actions,
    surface,
    meta: metaStub(),
    centerOn,
  })
  return { editor, inspector, surface, centerOn }
}

const PRESET = { id: 'dark', label: '深色', config: { accent: '#000' } }

describe('外观预设', () => {
  it('单选浅合并：预设没提到的键原样保留', () => {
    const { editor, inspector } = setup([
      node('a', { configJson: { title: '标', accent: '#fff' } }),
    ])
    editor.select('a')

    inspector.applyPreset(PRESET)

    expect(editor.nodes.value[0]?.configJson).toEqual({
      title: '标',
      accent: '#000',
    })
  })

  it('多选同类型：全体各自浅合并，每个节点合的是自己的 configJson', () => {
    const { editor, inspector } = setup([
      node('a', { configJson: { title: '甲' } }),
      node('b', { configJson: { title: '乙', pad: 4 } }),
    ])
    editor.setSelection(['a', 'b'])

    inspector.applyPreset(PRESET)

    expect(editor.nodes.value[0]?.configJson).toEqual({
      title: '甲',
      accent: '#000',
    })
    expect(editor.nodes.value[1]?.configJson).toEqual({
      title: '乙',
      pad: 4,
      accent: '#000',
    })
  })

  it('多选批量是一次 apply 一步撤销', () => {
    const { editor, inspector } = setup([node('a'), node('b')])
    editor.setSelection(['a', 'b'])

    inspector.applyPreset(PRESET)
    editor.undo()

    expect(editor.nodes.value[0]?.configJson).toEqual({})
    expect(editor.nodes.value[1]?.configJson).toEqual({})
  })

  it('混合类型多选退回只写主选中（选中集末位）', () => {
    const { editor, inspector } = setup([
      node('a'),
      node('b', { moduleType: CHART.type }),
    ])
    editor.setSelection(['a', 'b'])

    inspector.applyPreset(PRESET)

    expect(editor.nodes.value.find((n) => n.id === 'a')?.configJson).toEqual({})
    expect(editor.nodes.value.find((n) => n.id === 'b')?.configJson).toEqual({
      accent: '#000',
    })
  })

  it('没选中时什么也不做', () => {
    const { editor, inspector } = setup([node('a')])

    inspector.applyPreset(PRESET)

    expect(editor.isDirty.value).toBe(false)
  })
})

describe('改名与层序接线', () => {
  it('改名与层序落到画布动作出口，居中交给视口', () => {
    const { editor, inspector, surface, centerOn } = setup([node('a')])
    editor.select('a')

    inspector.rename('新名')
    inspector.order('front')
    inspector.order('center')

    expect(surface.onRename).toHaveBeenCalledWith('a', '新名')
    expect(surface.onFront).toHaveBeenCalledWith('a')
    expect(centerOn).toHaveBeenCalledWith('a')
  })

  it('四个层序档各走各的出口', () => {
    const { editor, inspector, surface } = setup([node('a')])
    editor.select('a')

    inspector.order('back')
    inspector.order('forward')
    inspector.order('backward')

    expect(surface.onBack).toHaveBeenCalledWith('a')
    expect(surface.onForward).toHaveBeenCalledWith('a')
    expect(surface.onBackward).toHaveBeenCalledWith('a')
  })
})
