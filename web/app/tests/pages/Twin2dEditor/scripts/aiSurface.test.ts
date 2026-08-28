/**
 * @fileoverview 契约：助手在 2D 孪生编辑器上能做的那七件事。
 *
 * ⚠ 数组绑定的行号是**文档序**，实体本身不在 fieldKey 里露面。所以读绑定要把每一行
 * 喂的那个实体一起给出去、照抄要按**槽位**对而不是按行号——按行号硬抄的结果是每一条
 * 绑定都有值、却全接错了对象，而界面上看不出来。
 * ⚠ 画布选中是**多选**：只给一个的话，用户说「把我选的这几个接上」时模型只动得了
 * 其中一个。并行的样式编辑焦点不是画布选中，不许混进来。
 * ⚠ 这一页**不给截图**：2D 舞台是 SVG/DOM，那条链路只在大屏与 3D 替身上验过。
 * 摆一个没验过的工具出来就是每次调都失败，而模型看得见它、每轮都要先撞一次墙。
 * ⚠ 保存失败（含 409）必须抛：静默吞掉会让模型接着往下绑，而每一条都存不进去。
 */
import type {
  AssistantToolCall,
  BindingPayload,
  PointSample,
} from '@dt/contracts'
import {
  normalizeTwin2dConfig,
  twin2dRowsOfEntity,
  type Twin2dBindingRow,
  type Twin2dConfig,
} from '@dt/twin2d'
import { describe, expect, it, vi } from 'vitest'

import { createBinding } from '@/features/dashboard/editorDoc'
import { createTwin2dSurface } from '@/pages/Twin2dEditor/scripts/aiSurface'
import type { Twin2dSurfaceDeps } from '@/pages/Twin2dEditor/scripts/aiSurface'
import { createTwin2dSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'
import type { Twin2dEditorSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'

/** 两个同款水箱加一条连线：同款才对得上槽位，连线用来验「对不上就跳过」。 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20 },
  nodes: [
    { id: 'n1', styleId: 'water-tank', x: 10, y: 10, label: '1号水箱' },
    { id: 'n2', styleId: 'water-tank', x: 300, y: 10, label: '2号水箱' },
  ],
  edges: [{ id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } }],
})

/**
 * 某个实体在某个槽上的第一行。
 * ⚠ 从行表里查而不是把 fieldKey 写死：行号由文档序算出来，写死的话样式换一个槽
 * 这一份用例就只是在验一个不存在的行。
 */
function rowOf(entityId: string, slotKey: string): Twin2dBindingRow {
  const found = twin2dRowsOfEntity(CONFIG, entityId).find(
    (row) => row.slotKey === slotKey,
  )
  if (found === undefined) {
    throw new Error(`${entityId} 在 ${slotKey} 上没有行，这份夹具立不住`)
  }
  return found
}

/** 1 号水箱的第一条读数行，与 2 号水箱上喂同一个槽位的那一行。 */
const SOURCE = rowOf('n1', 'nodeValues')
const TARGET = twin2dRowsOfEntity(CONFIG, 'n2').find(
  (row) => row.entitySlot === SOURCE.entitySlot,
)

function call(name: string, args: Record<string, unknown>): AssistantToolCall {
  return { call_id: 'c1', name, arguments: args }
}

function point(fieldKey: string, nodeKey: string): BindingPayload {
  return { ...createBinding('n1', fieldKey), sourceKind: 'opcua', nodeKey }
}

interface SetupOptions {
  bindings?: BindingPayload[]
  /** 画布上选中的那一批；不给就是一个都没选。 */
  picked?: readonly string[]
  isSaved?: boolean
  message?: string | null
  samples?: Readonly<Record<string, PointSample>>
  /** 还没读出来的那一档：给 null。 */
  config?: Twin2dConfig | null
}

function setup(options: SetupOptions = {}) {
  const bindings = [...(options.bindings ?? [])]
  const write = vi.fn<(binding: BindingPayload) => void>()
  const drop = vi.fn<(fieldKey: string) => void>()
  const save = vi.fn(() =>
    Promise.resolve({
      isSaved: options.isSaved ?? true,
      message: options.message ?? null,
    }),
  )
  const selection: Twin2dEditorSelection = createTwin2dSelection()
  if (options.picked !== undefined) {
    selection.selectMany('nodes', options.picked, false)
  }
  const deps: Twin2dSurfaceDeps = {
    config: () => ('config' in options ? options.config : CONFIG) ?? null,
    bindings: () => bindings,
    write,
    drop,
    nodeId: () => 'host',
    nodeLabel: () => '余热系统',
    moduleType: () => 'twin-2d-view',
    selection,
    read: (nodeKey) => options.samples?.[nodeKey],
    save,
    savedVersion: () => 12,
  }
  return { surface: createTwin2dSurface(deps), write, drop, save, selection }
}

async function run(
  surface: ReturnType<typeof setup>['surface'],
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return (await surface.run(call(name, args))) as Record<string, unknown>
}

describe('这一页摆出来的工具', () => {
  // ⚠ 摆一个没验过的工具出来就是每次调都失败，而模型每轮都要先撞一次墙
  it('不给截图', () => {
    const { surface } = setup()

    expect(surface.tools).not.toContain('dashboard.capture')
  })

  it('工作面认的是 twin2d-editor 这一档', () => {
    const { surface } = setup()

    expect(surface.kind).toBe('twin2d-editor')
  })

  it('调截图一律抛，不静默成功', async () => {
    const { surface } = setup()

    await expect(surface.run(call('dashboard.capture', {}))).rejects.toThrow(
      /没有实现/,
    )
  })
})

describe('读画布', () => {
  it('给出画布尺寸与各类实体的条数', async () => {
    const { surface } = setup()

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot).toMatchObject({
      is_ready: true,
      node_id: 'host',
      node_label: '余热系统',
      node_count: 2,
      edge_count: 1,
      canvas: { width: 800, height: 600, grid: 20 },
    })
  })

  it('配置还没读出来时如实说', async () => {
    const { surface } = setup({ config: null })

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot.is_ready).toBe(false)
  })

  // ⚠ 只给一个的话，用户说「把我选的这几个接上」时模型只动得了其中一个
  it('选了几个就给几个，名字是大纲上那一行的主名', async () => {
    const { surface } = setup({ picked: ['n1', 'n2'] })

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot.selected_ids).toEqual(['n1', 'n2'])
    expect(shot.selected).toEqual([
      { kind: 'node', id: 'n1', name: '1号水箱' },
      { kind: 'node', id: 'n2', name: '2号水箱' },
    ])
    // 单选那一格留着：会话是跨版本的，删掉它老前端的快照连选中都读不出来
    expect(shot.selected_id).toBe('n2')
  })

  it('一个都没选时是空表，不是编一个出来', async () => {
    const { surface } = setup()

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot.selected_ids).toEqual([])
    expect(shot.selected).toEqual([])
    expect(shot.selected_id).toBeNull()
  })

  // ⚠ 样式编辑焦点与画布选中是两条并行的轴，混进来的话用户说「就动我选的这几个」
  //   时会连一份样式一起改
  it('正在编样式不算画布选中', async () => {
    const { surface, selection } = setup()
    selection.focusStyle('styles', 'water-tank')

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot.selected).toEqual([])
  })
})

describe('读绑定', () => {
  it('每一行都带着它喂的那个实体的名字', async () => {
    const { surface } = setup()

    const shot = await run(surface, 'dashboard.read_bindings')

    const slots = shot.slots as Record<string, unknown>[]
    const rows = slots.find((one) => one.key === 'nodeValues')?.rows as Record<
      string,
      unknown
    >[]
    expect(rows[0]).toMatchObject({
      field_key: SOURCE.fieldKey,
      entity: SOURCE.label,
      entity_id: 'n1',
      node_key: null,
    })
    expect(String(SOURCE.label)).toContain('1号水箱')
  })

  it('槽名是清单上那一个，不是槽键', async () => {
    const { surface } = setup()

    const shot = await run(surface, 'dashboard.read_bindings')

    const slots = shot.slots as Record<string, unknown>[]
    expect(slots.find((one) => one.key === 'nodeStatus')?.label).toBe(
      '节点状态',
    )
  })
})

describe('写绑定', () => {
  it('落到页面那一支上，并回报绑的是哪一行', async () => {
    const { surface, write } = setup()

    const got = await run(surface, 'dashboard.write_binding', {
      field_key: SOURCE.fieldKey,
      node_key: 'src-1:PT101',
    })

    expect(got).toMatchObject({ ok: true, entity: SOURCE.label })
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      fieldKey: SOURCE.fieldKey,
      sourceKind: 'opcua',
      nodeKey: 'src-1:PT101',
    })
  })

  // ⚠ 契约里 node_id 是必填的；收下一个别的节点却照样按本页动手，模型会拿这一次
  //   的结果当另一块屏的证据
  it('给的是别的节点时一律拒，不静默动本页', async () => {
    const { surface, write } = setup()

    await expect(
      surface.run(
        call('dashboard.write_binding', {
          node_id: 'other',
          field_key: SOURCE.fieldKey,
          node_key: 'src-1:PT101',
        }),
      ),
    ).rejects.toThrow(/other/)
    expect(write).not.toHaveBeenCalled()
  })

  // 写进去会多出一条谁都不喂的绑定，而它在界面上不显示
  it('认不出的槽键一律拒', async () => {
    const { surface, write } = setup()

    await expect(
      surface.run(
        call('dashboard.write_binding', {
          field_key: 'nodeValues[99].value',
          node_key: 'src-1:x',
        }),
      ),
    ).rejects.toThrow(/nodeValues\[99\]/)
    expect(write).not.toHaveBeenCalled()
  })
})

describe('解绑定', () => {
  it('解掉一条已经有的', async () => {
    const { surface, drop } = setup({
      bindings: [point(SOURCE.fieldKey, 'src-1:PT101')],
    })

    const got = await run(surface, 'dashboard.remove_binding', {
      field_key: SOURCE.fieldKey,
    })

    expect(got.ok).toBe(true)
    expect(drop).toHaveBeenCalledWith(SOURCE.fieldKey)
  })

  it('本来就没绑的那一条不许静默成功', async () => {
    const { surface, drop } = setup()

    await expect(
      surface.run(
        call('dashboard.remove_binding', { field_key: SOURCE.fieldKey }),
      ),
    ).rejects.toThrow(/没有/)
    expect(drop).not.toHaveBeenCalled()
  })
})

describe('照抄绑定', () => {
  it('两个同款节点之间按槽位对，行号差多少都不影响', async () => {
    const { surface, write } = setup({
      bindings: [point(SOURCE.fieldKey, 'src-1:PT101')],
    })

    const plan = await run(surface, 'dashboard.copy_bindings', {
      from_entity_id: 'n1',
      to_entity_id: 'n2',
    })

    expect(plan.copied).toEqual([
      {
        from_field_key: SOURCE.fieldKey,
        to_field_key: TARGET?.fieldKey,
        source_kind: 'opcua',
        node_key: 'src-1:PT101',
        matched_by: 'by_label',
        is_overwrite: false,
      },
    ])
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      fieldKey: TARGET?.fieldKey,
      nodeKey: 'src-1:PT101',
    })
  })

  // ⚠ 这是这套数组绑定最容易「每条都有值、全接错对象」的地方
  it('对不上的行进 skipped，绝不退回按行号硬抄', async () => {
    const { surface, write } = setup({
      bindings: [point(SOURCE.fieldKey, 'src-1:PT101')],
    })

    const plan = await run(surface, 'dashboard.copy_bindings', {
      from_entity_id: 'n1',
      to_entity_id: 'e1',
    })

    expect(plan.copied).toEqual([])
    expect(plan.skipped).toEqual([
      { from_field_key: SOURCE.fieldKey, reason: '目标处没有同名的行' },
    ])
    expect(write).not.toHaveBeenCalled()
  })

  it('只看不动手时一条都不写', async () => {
    const { surface, write } = setup({
      bindings: [point(SOURCE.fieldKey, 'src-1:PT101')],
    })

    const plan = await run(surface, 'dashboard.copy_bindings', {
      from_entity_id: 'n1',
      to_entity_id: 'n2',
      dry_run: true,
    })

    expect(plan.is_dry_run).toBe(true)
    expect((plan.copied as unknown[]).length).toBe(1)
    expect(write).not.toHaveBeenCalled()
  })

  it('认不出的实体一律抛，不交一份空计划', async () => {
    const { surface } = setup()

    await expect(
      surface.run(
        call('dashboard.copy_bindings', {
          from_entity_id: 'n1',
          to_entity_id: '不存在的',
        }),
      ),
    ).rejects.toThrow(/没有可绑的行/)
  })

  it('对齐方式认不出时直说，不默默当成按名字', async () => {
    const { surface } = setup()

    await expect(
      surface.run(
        call('dashboard.copy_bindings', {
          from_entity_id: 'n1',
          to_entity_id: 'n2',
          match: 'by_position',
        }),
      ),
    ).rejects.toThrow(/by_position/)
  })
})

describe('读实时读数', () => {
  it('走的是画中画那一份快照缓存，取到什么报什么', async () => {
    const { surface } = setup({
      bindings: [point(SOURCE.fieldKey, 'src-1:PT101')],
      samples: {
        'src-1:PT101': {
          state: 'ok',
          value: 3.5,
          timestampMs: 7,
          quality: 'good',
        },
      },
    })

    const report = await run(surface, 'dashboard.read_values')

    const items = report.items as Record<string, unknown>[]
    expect(items[0]).toMatchObject({
      field_key: SOURCE.fieldKey,
      entity: SOURCE.label,
      value: 3.5,
      status: 'has_value',
    })
  })

  // ⚠ 与 `Twin2dLiveState` 同一套说法：订上了没来第一帧几乎总是绑定还没保存，
  //   合成「取不到」那一档的话，模型会去把一条好好的绑定改掉
  it('订上了还没来第一帧是 waiting，不是取不到', async () => {
    const { surface } = setup({
      bindings: [point(SOURCE.fieldKey, 'src-1:PT101')],
    })

    const report = await run(surface, 'dashboard.read_values')

    const items = report.items as Record<string, unknown>[]
    expect(items[0]?.status).toBe('waiting')
  })

  it('一条来源都没配时数得出来', async () => {
    const { surface } = setup()

    const report = await run(surface, 'dashboard.read_values')

    expect(report.unbound_count).toBe((report.items as unknown[]).length)
  })

  it('别的节点一律拒，不拿本段的读数冒充', async () => {
    const { surface } = setup()

    await expect(
      surface.run(call('dashboard.read_values', { node_id: 'other' })),
    ).rejects.toThrow(/other/)
  })
})

describe('落库', () => {
  it('保存成功回落库后的行版本', async () => {
    const { surface, save } = setup()

    const got = await run(surface, 'dashboard.save')

    expect(save).toHaveBeenCalledTimes(1)
    expect(got).toMatchObject({ ok: true, saved_version: 12 })
  })

  it('保存失败一律抛，冲突那句话原样带出去', async () => {
    const { surface } = setup({
      isSaved: false,
      message: '这张屏已被别人改过，请重新加载',
    })

    await expect(surface.run(call('dashboard.save', {}))).rejects.toThrow(
      /重新加载/,
    )
  })
})
