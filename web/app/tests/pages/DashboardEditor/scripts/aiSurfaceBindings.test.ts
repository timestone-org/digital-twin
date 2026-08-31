/**
 * @fileoverview 契约：助手在大屏编辑器上读绑定行、照抄绑定、读实时读数、落库。
 *
 * 守四件事：读绑定要摊出「这一行喂的是哪个实体」（缺了它模型只能按行号猜）；
 * 照抄只落到已有动作层上并**整批只压一笔撤销**；读数走画布同一份快照缓存；
 * 保存失败一律抛（静默吞掉会让模型接着绑，而每一条都存不进去）。
 */
import { computed } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type {
  AssistantToolCall,
  DashboardNodePayload,
  ModuleManifest,
  PointSample,
} from '@dt/contracts'

import {
  useDashboardEditor,
  type DashboardEditor,
} from '@/composables/useDashboardEditor'
import type { CopyPlan } from '@/features/ai/copyBindings'
import type { SaveOutcome } from '@/features/ai/saveTool'
import type { AiSurface } from '@/features/ai/surfaces'
import type { ValueReport } from '@/features/ai/valueReport'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import { createEditorSurface } from '@/pages/DashboardEditor/scripts/aiSurface'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '实时数值卡',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: [
    {
      key: 'itemValues',
      label: '读数',
      dataType: 'number',
      isArray: true,
      isEntityPinned: true,
      arrayFields: [{ key: 'value', label: '读数', dataType: 'number' }],
    },
  ],
  bindingRowLabels: () => ({
    'itemValues[0].value': { title: '温度', id: 'm-1' },
    'itemValues[1].value': { title: '压力', id: 'm-2' },
  }),
  bindingRowCounts: () => ({ itemValues: 2 }),
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

interface Options {
  read?: (nodeKey: string) => PointSample | undefined
  save?: () => Promise<SaveOutcome>
  savedVersion?: () => number | null
}

interface Harness {
  editor: DashboardEditor
  surface: AiSurface
}

function setup(options: Options = {}): Harness {
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
        chrome: {
          card: computed(() => ({})),
          rules: computed(() => []),
          setCard: vi.fn(),
          setInteractions: vi.fn(),
        },
        stageEl: () => null,
        getManifest: () => MANIFEST,
        readSample: options.read ?? (() => undefined),
        save:
          options.save ??
          (() => Promise.resolve({ isSaved: true, message: null })),
        savedVersion: options.savedVersion ?? (() => 7),
      })
      return () => h('div')
    },
  })
  mount(host)
  return { editor, surface }
}

/** 给某个节点的某一行接一个点位，走的是助手自己那条写绑定的路。 */
async function bind(
  harness: Harness,
  nodeId: string,
  fieldKey: string,
  nodeKey: string,
): Promise<void> {
  await harness.surface.run(
    call('dashboard.write_binding', {
      node_id: nodeId,
      field_key: fieldKey,
      node_key: nodeKey,
    }),
  )
}

describe('读绑定', () => {
  it('数组槽摊出行，每一行带着它喂的那个实体', async () => {
    const { surface } = setup()
    const shot = (await surface.run(
      call('dashboard.read_bindings', { node_id: 'a' }),
    )) as Record<string, unknown>
    expect(shot).toMatchObject({
      node_id: 'a',
      module_type: 'demo',
      node_label: '实时数值卡',
    })
    const slots = shot.slots as Record<string, unknown>[]
    const rows = slots[0]?.rows as Record<string, unknown>[]
    expect(rows[0]).toMatchObject({
      index: 0,
      field_key: 'itemValues[0].value',
      entity: '温度',
      entity_id: 'm-1',
      node_key: null,
    })
  })

  it('没绑的行也出现，node_key 为 null', async () => {
    const harness = setup()
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    const shot = (await harness.surface.run(
      call('dashboard.read_bindings', { node_id: 'a' }),
    )) as Record<string, unknown>
    const slots = shot.slots as Record<string, unknown>[]
    const rows = slots[0]?.rows as Record<string, unknown>[]
    expect(rows.map((row) => row.node_key)).toEqual(['s:t1', null])
  })

  it('画布上没有的节点一律抛', async () => {
    const { surface } = setup()
    await expect(
      surface.run(call('dashboard.read_bindings', { node_id: 'zzz' })),
    ).rejects.toThrow(/zzz/)
  })
})

describe('读实时读数', () => {
  it('读的是画布那份快照缓存，不另发请求', async () => {
    const read = vi.fn(() => ({
      state: 'ok' as const,
      value: 36.5,
      timestampMs: Date.UTC(2026, 7, 28),
      quality: 'good' as const,
    }))
    const harness = setup({ read })
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    const found = (await harness.surface.run(
      call('dashboard.read_values', { node_id: 'a' }),
    )) as ValueReport
    expect(read).toHaveBeenCalledWith('s:t1')
    expect(found.items[0]).toMatchObject({ status: 'has_value', value: 36.5 })
  })

  it('订上了还没来第一帧是 waiting，不是取不到', async () => {
    const harness = setup()
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    const found = (await harness.surface.run(
      call('dashboard.read_values', { node_id: 'a' }),
    )) as ValueReport
    expect(found.items[0]?.status).toBe('waiting')
    expect(found.unbound_count).toBe(1)
  })

  it('不给 node_id 就整屏，行名前面缀节点名以免分不出是哪一块', async () => {
    const harness = setup()
    const found = (await harness.surface.run(
      call('dashboard.read_values', {}),
    )) as ValueReport
    expect(found.items).toHaveLength(4)
    expect(found.items[0]?.entity).toBe('实时数值卡 · 温度')
  })

  it('整屏时两块卡片上同名的 fieldKey 各读各的绑定，不互相盖', async () => {
    const harness = setup()
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    await bind(harness, 'b', 'itemValues[0].value', 's:t2')
    const found = (await harness.surface.run(
      call('dashboard.read_values', {}),
    )) as ValueReport
    const bound = found.items.filter((one) => one.node_key !== null)
    expect(bound.map((one) => one.node_key)).toEqual(['s:t1', 's:t2'])
  })

  it('只读一个节点时不缀节点名', async () => {
    const harness = setup()
    const found = (await harness.surface.run(
      call('dashboard.read_values', { node_id: 'a' }),
    )) as ValueReport
    expect(found.items[0]?.entity).toBe('温度')
  })
})

describe('照抄绑定', () => {
  it('按名字对上就把取数来源抄过去', async () => {
    const harness = setup()
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    const found = (await harness.surface.run(
      call('dashboard.copy_bindings', {
        from_node_id: 'a',
        to_node_id: 'b',
      }),
    )) as CopyPlan
    expect(found.copied[0]).toMatchObject({
      from_field_key: 'itemValues[0].value',
      to_field_key: 'itemValues[0].value',
      node_key: 's:t1',
      matched_by: 'by_label',
      is_overwrite: false,
    })
    const target = harness.editor.nodes.value.find((one) => one.id === 'b')
    expect(target?.bindings[0]?.nodeKey).toBe('s:t1')
  })

  it('只看不动手时一条都不写进目标', async () => {
    const harness = setup()
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    const found = (await harness.surface.run(
      call('dashboard.copy_bindings', {
        from_node_id: 'a',
        to_node_id: 'b',
        dry_run: true,
      }),
    )) as CopyPlan
    expect(found.is_dry_run).toBe(true)
    expect(found.copied).toHaveLength(1)
    const target = harness.editor.nodes.value.find((one) => one.id === 'b')
    expect(target?.bindings).toEqual([])
  })

  it('整批只压一笔撤销：一次 Ctrl+Z 整个退回', async () => {
    const harness = setup()
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    await bind(harness, 'a', 'itemValues[1].value', 's:p1')
    await harness.surface.run(
      call('dashboard.copy_bindings', { from_node_id: 'a', to_node_id: 'b' }),
    )
    harness.editor.undo()
    const target = harness.editor.nodes.value.find((one) => one.id === 'b')
    expect(target?.bindings).toEqual([])
  })

  it('动手之前先选中目标节点：用户要看见助手在动哪一个', async () => {
    const harness = setup()
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    await harness.surface.run(
      call('dashboard.copy_bindings', { from_node_id: 'a', to_node_id: 'b' }),
    )
    expect(harness.editor.selectedId.value).toBe('b')
  })

  it('盖掉目标原有绑定时标出来，并沿用那条绑定的 id', async () => {
    const harness = setup()
    await bind(harness, 'a', 'itemValues[0].value', 's:t1')
    await bind(harness, 'b', 'itemValues[0].value', 's:old')
    const before = harness.editor.nodes.value.find((one) => one.id === 'b')
    const keptId = before?.bindings[0]?.id
    const found = (await harness.surface.run(
      call('dashboard.copy_bindings', { from_node_id: 'a', to_node_id: 'b' }),
    )) as CopyPlan
    expect(found.copied[0]?.is_overwrite).toBe(true)
    const target = harness.editor.nodes.value.find((one) => one.id === 'b')
    expect(target?.bindings[0]?.id).toBe(keptId)
    expect(target?.bindings[0]?.nodeKey).toBe('s:t1')
  })

  it('源与目标是同一个节点时直说，不空跑一趟', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.copy_bindings', {
          from_node_id: 'a',
          to_node_id: 'a',
        }),
      ),
    ).rejects.toThrow(/同一个节点/)
  })

  it('认不出的对齐方式一律抛，不默默当成按名字', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.copy_bindings', {
          from_node_id: 'a',
          to_node_id: 'b',
          match: 'by_name',
        }),
      ),
    ).rejects.toThrow(/by_name/)
  })
})

describe('落库', () => {
  it('走页面现有的保存路径，并回执落库后的行版本', async () => {
    const save = vi.fn(() => Promise.resolve({ isSaved: true, message: null }))
    const { surface } = setup({ save, savedVersion: () => 9 })
    const found = await surface.run(call('dashboard.save', {}))
    expect(save).toHaveBeenCalledTimes(1)
    expect(found).toMatchObject({ ok: true, saved_version: 9 })
  })

  it('冲突时抛出那句原因，不静默成功', async () => {
    const { surface } = setup({
      save: () => Promise.resolve({ isSaved: false, message: '版本旧了' }),
    })
    await expect(surface.run(call('dashboard.save', {}))).rejects.toThrow(
      '版本旧了',
    )
  })
})

describe('工具清单', () => {
  it('四个新工具都在这一页的清单里，名字与规格书逐字相同', () => {
    const { surface } = setup()
    expect(surface.tools).toContain('dashboard.save')
    expect(surface.tools).toContain('dashboard.read_values')
    expect(surface.tools).toContain('dashboard.copy_bindings')
    expect(surface.tools).toContain('dashboard.read_bindings')
  })
})
