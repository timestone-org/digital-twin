/**
 * @fileoverview 契约：助手在大屏编辑器上到底能读什么、动什么。
 *
 * **守的是 ADR-0023 的落地**：每一件事都落到已有的 `EditorActions` 上，于是
 * 改动立刻显示在画布上、一次 Ctrl+Z 撤得掉、不保存就能预览。绕过动作层直接
 * 改文档的写法在用例里同样是绿的——只是用户撤不回来了。
 *
 * 另守两条：动手之前先选中那个画布节点（用户得看见助手在动哪一个），
 * 以及认不出的节点/工具一律抛（把「做不到」如实告诉模型）。
 */
import { computed } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type {
  AssistantToolCall,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'

import {
  useDashboardEditor,
  type DashboardEditor,
} from '@/composables/useDashboardEditor'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import { createEditorSurface } from '@/pages/DashboardEditor/scripts/aiSurface'
import type { AiSurface } from '@/features/ai/surfaces'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示模块',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: [
    { key: 'itemValues', label: '读数', dataType: 'number', isArray: true },
  ],
  component: () => Promise.resolve({ default: {} }),
}

function node(id: string): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 10,
    y: 20,
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

function call(name: string, args: Record<string, unknown>): AssistantToolCall {
  return { call_id: 'c1', name, arguments: args }
}

interface Harness {
  editor: DashboardEditor
  surface: AiSurface
}

function setup(): Harness {
  let editor!: DashboardEditor
  let surface!: AiSurface
  const host = defineComponent({
    setup() {
      editor = useDashboardEditor(() => MANIFEST)
      editor.reset([node('a'), node('b')])
      surface = createEditorSurface({
        editor,
        actions: createEditorActions({
          editor,
          dashboardId: () => 'd1',
          getManifest: () => MANIFEST,
          design: () => ({ width: 1920, height: 1080 }),
        }),
        arrange: createArrangeActions({
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
        }),
        stageEl: () => null,
        readSample: () => undefined,
        save: () => Promise.resolve({ isSaved: true, message: null }),
        savedVersion: () => 1,
        getManifest: () => MANIFEST,
      })
      return () => h('div')
    },
  })
  mount(host)
  return { editor, surface }
}

describe('读画布', () => {
  it('给出节点数、选中项与每个节点的摘要', async () => {
    const { surface } = setup()
    const shot = await surface.run(call('dashboard.read_canvas', {}))
    expect(shot).toMatchObject({
      node_count: 2,
      selected_id: null,
      selected_ids: [],
      selected: [],
    })
  })

  it('框选了几个就给几个，不是只给最后点的那一个', async () => {
    const { editor, surface } = setup()
    editor.setSelection(['a', 'b'])
    editor.flush()
    const shot = (await surface.run(
      call('dashboard.read_canvas', {}),
    )) as Record<string, unknown>
    expect(shot.selected_ids).toEqual(['a', 'b'])
    expect(
      (shot.selected as Record<string, unknown>[]).map((one) => one.id),
    ).toEqual(['a', 'b'])
  })

  it('单选那一格留着——老口径不许主动删', async () => {
    const { editor, surface } = setup()
    editor.setSelection(['a', 'b'])
    editor.flush()
    const shot = (await surface.run(
      call('dashboard.read_canvas', {}),
    )) as Record<string, unknown>
    expect(shot.selected_id).toBe('b')
  })

  it('摘要里带着模块类型与人读名字', async () => {
    const { surface } = setup()
    const shot = (await surface.run(
      call('dashboard.read_canvas', {}),
    )) as Record<string, unknown>
    const nodes = shot.nodes
    expect(Array.isArray(nodes)).toBe(true)
    expect((nodes as Record<string, unknown>[])[0]).toMatchObject({
      id: 'a',
      module_type: 'demo',
      label: '演示模块',
    })
  })
})

describe('写绑定', () => {
  it('动手之前先选中那个画布节点', async () => {
    const { editor, surface } = setup()
    await surface.run(
      call('dashboard.write_binding', {
        node_id: 'b',
        field_key: 'itemValues[0].value',
        node_key: 'src:K1_TT02_PI',
      }),
    )
    // 用户得看见助手在动哪一个——改了一个屏幕外的节点而没有任何指示，
    // 是最容易让人失去信任的地方
    expect(editor.selectedId.value).toBe('b')
  })

  it('点位真的写进了那条绑定', async () => {
    const { editor, surface } = setup()
    await surface.run(
      call('dashboard.write_binding', {
        node_id: 'b',
        field_key: 'itemValues[0].value',
        node_key: 'src:K1_TT02_PI',
      }),
    )
    const target = editor.nodes.value.find((one) => one.id === 'b')
    expect(target?.bindings[0]).toMatchObject({
      fieldKey: 'itemValues[0].value',
      nodeKey: 'src:K1_TT02_PI',
    })
  })

  it('改动进了撤销栈，一次就能退回去', async () => {
    const { editor, surface } = setup()
    await surface.run(
      call('dashboard.write_binding', {
        node_id: 'b',
        field_key: 'itemValues[0].value',
        node_key: 'src:K1_TT02_PI',
      }),
    )
    expect(editor.canUndo.value).toBe(true)
    editor.undo()
    const target = editor.nodes.value.find((one) => one.id === 'b')
    expect(target?.bindings).toEqual([])
  })

  it('少了参数就抛，而不是写出一条半截的绑定', async () => {
    const { surface } = setup()
    await expect(
      surface.run(call('dashboard.write_binding', { node_id: 'b' })),
    ).rejects.toThrow(/field_key/)
  })
})

describe('改配置', () => {
  it('按路径写进那个节点的配置', async () => {
    const { editor, surface } = setup()
    await surface.run(
      call('dashboard.set_config', {
        node_id: 'a',
        path: ['__cardStyle', 'borderStyle'],
        value: 'none',
      }),
    )
    const target = editor.nodes.value.find((one) => one.id === 'a')
    const style = target?.configJson.__cardStyle
    expect(style).toEqual({ borderStyle: 'none' })
  })

  it('path 不是数组就抛', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.set_config', {
          node_id: 'a',
          path: 'borderStyle',
          value: 'none',
        }),
      ),
    ).rejects.toThrow(/path/)
  })
})

describe('认不出的工具', () => {
  it('一律抛，不静默成功', async () => {
    const { surface } = setup()
    await expect(surface.run(call('nothing.like_this', {}))).rejects.toThrow(
      /nothing\.like_this/,
    )
  })
})
