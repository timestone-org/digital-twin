/**
 * @fileoverview 契约：助手在孪生编辑器上按**实体名字**绑点，不按行号猜；照抄绑定
 * 对不上名字时列进 `skipped` 而不是按行号硬抄；读数与视口同源；保存失败一律抛。
 *
 * 守的是这一页最容易静默出错的那件事：数组绑定的行号是文档序，实体本身不在
 * fieldKey 里露面。按行号猜的结果是每一条绑定都有值、却全接错了对象，
 * 而界面上看不出来。另守三条：截图走与大屏同一份口径、快照要说得出用户此刻
 * 选中了谁、保存失败（含 409）必须抛出去而不是静默吞掉。
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  AssistantToolCall,
  BindingPayload,
  PointSample,
} from '@dt/contracts'
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'

import { createBinding } from '@/features/dashboard/editorDoc'
import { createTwinSurface } from '@/pages/TwinEditor/scripts/aiSurface'
import type { TwinSurfaceDeps } from '@/pages/TwinEditor/scripts/aiSurface'
import { TWIN_SELECT_MODEL } from '@/pages/TwinEditor/scripts/types'
import type { TwinSelection } from '@/pages/TwinEditor/scripts/types'

const captureCanvas = vi.hoisted(() => vi.fn())

vi.mock('@/features/ai/captureWithGl', () => ({ captureCanvas }))

/** 两块牌各两个字段：照抄那一组用它——牌名不同、字段名相同。 */
function config(): TwinConfig {
  return normalizeTwinConfig({
    anchors: [
      { id: 'a1', name: '1号机组出口' },
      { id: 'a2', name: '2号机组出口' },
    ],
    panels: [
      {
        id: 'p1',
        name: '1号机组',
        fields: [
          { key: 'temp', label: '温度' },
          { key: 'flow', label: '流量' },
        ],
      },
      {
        id: 'p2',
        name: '2号机组',
        fields: [
          { key: 'temp', label: '温度' },
          { key: 'press', label: '压力' },
        ],
      },
    ],
  })
}

function call(name: string, args: Record<string, unknown>): AssistantToolCall {
  return { call_id: 'c1', name, arguments: args }
}

function point(fieldKey: string, nodeKey: string): BindingPayload {
  return {
    ...createBinding('n1', fieldKey),
    sourceKind: 'opcua',
    nodeKey,
  }
}

interface SetupOptions {
  bindings?: BindingPayload[]
  selection?: TwinSelection
  isSaved?: boolean
  message?: string | null
  samples?: Readonly<Record<string, PointSample>>
  /** 还没读出来的那一档：给 null。 */
  config?: TwinConfig | null
}

function setup(options: SetupOptions = {}) {
  const bindings = [...(options.bindings ?? [])]
  const write = vi.fn<(binding: BindingPayload) => void>((one) => {
    const at = bindings.findIndex((item) => item.fieldKey === one.fieldKey)
    if (at < 0) bindings.push(one)
    else bindings.splice(at, 1, one)
  })
  const drop = vi.fn<(fieldKey: string) => void>()
  const save = vi.fn(() =>
    Promise.resolve({
      isSaved: options.isSaved ?? true,
      message: options.message ?? null,
    }),
  )
  const stageEl = document.createElement('div')
  const deps: TwinSurfaceDeps = {
    config: () => ('config' in options ? options.config : config()) ?? null,
    bindings: () => bindings,
    write,
    drop,
    nodeId: () => 'n1',
    nodeLabel: () => '厂区三维',
    moduleType: () => 'twin-view',
    selection: () => options.selection ?? TWIN_SELECT_MODEL,
    stage: () => stageEl,
    read: (nodeKey) => options.samples?.[nodeKey],
    save,
    savedVersion: () => 7,
  }
  return { surface: createTwinSurface(deps), write, drop, save, stageEl }
}

async function run(
  surface: ReturnType<typeof setup>['surface'],
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return (await surface.run(call(name, args))) as Record<string, unknown>
}

describe('读场景', () => {
  it('给出各类实体的条数与已绑数', async () => {
    const { surface } = setup()

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot).toMatchObject({ is_ready: true, anchor_count: 2 })
  })

  it('配置还没读出来时如实说', async () => {
    const { surface } = setup({ config: null })

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot.is_ready).toBe(false)
  })

  // ⚠ 用户在大纲里点了一个说「把这个接上」，快照里没有选中的话，模型只能挑一个
  //   它自己觉得像的去改
  it('带上用户此刻选中的那一个，名字就是大纲上那一行', async () => {
    const { surface } = setup({ selection: { kind: 'panels', id: 'p2' } })

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot.selected_id).toBe('p2')
    expect(shot.selected_ids).toEqual(['p2'])
    expect(shot.selected).toEqual([
      { kind: 'panel', id: 'p2', name: '2号机组' },
    ])
  })

  // ⚠ 硬造一个 id 的话，模型会拿它当实体去绑，而那个 id 谁都不喂
  it('选中的是单例段时如实说是哪一档，不硬造一个 id', async () => {
    const { surface } = setup({ selection: { kind: 'roam' } })

    const shot = await run(surface, 'dashboard.read_canvas')

    expect(shot.selected_section).toBe('roam')
    expect(shot.selected_id).toBeNull()
    expect(shot.selected).toEqual([])
  })
})

describe('读绑定', () => {
  it('每一行都带着它喂的那个实体的名字', async () => {
    const { surface } = setup()

    const shot = await run(surface, 'dashboard.read_bindings')

    const slots = shot.slots as Record<string, unknown>[]
    const anchors = slots.find((one) => one.key === 'anchorValues')
    const rows = anchors?.rows as Record<string, unknown>[]
    // 按名字对，不按行号猜——按行号猜时每一行都有值却全接错了对象
    expect(rows[0]).toMatchObject({
      field_key: 'anchorValues[0].value',
      entity: '1号机组出口',
      entity_id: 'a1',
      node_key: null,
    })
  })

  it('已经绑上的那一行带出点位身份', async () => {
    const { surface } = setup({
      bindings: [point('anchorValues[1].value', 'src:K1_TT02')],
    })

    const shot = await run(surface, 'dashboard.read_bindings')

    const slots = shot.slots as Record<string, unknown>[]
    const rows = slots.find((one) => one.key === 'anchorValues')
      ?.rows as Record<string, unknown>[]
    expect(rows[1]?.node_key).toBe('src:K1_TT02')
  })

  it('槽名是清单上那一个，不是槽键', async () => {
    const { surface } = setup()

    const shot = await run(surface, 'dashboard.read_bindings')

    const slots = shot.slots as Record<string, unknown>[]
    expect(slots.find((one) => one.key === 'panelValues')?.label).toBe(
      '信息牌字段',
    )
  })
})

describe('写绑定', () => {
  it('落到动作层上，并回报绑的是哪个实体', async () => {
    const { surface, write } = setup()

    const got = await run(surface, 'dashboard.write_binding', {
      field_key: 'anchorValues[1].value',
      node_key: 'src:K1_TT02',
    })

    expect(got.entity).toBe('2号机组出口')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      fieldKey: 'anchorValues[1].value',
      sourceKind: 'opcua',
      nodeKey: 'src:K1_TT02',
    })
  })

  it('认不出的槽键一律拒，不留下一条谁都不喂的绑定', async () => {
    const { surface, write } = setup()

    await expect(
      surface.run(
        call('dashboard.write_binding', {
          field_key: 'anchorValues[9].value',
          node_key: 'src:x',
        }),
      ),
    ).rejects.toThrow(/anchorValues\[9\]/)
    expect(write).not.toHaveBeenCalled()
  })

  // ⚠ 契约里 node_id 是必填的；收下一个别的节点却照样按本段动手，模型会拿这一次
  //   的结果当另一块屏的证据
  it('给的是别的节点时一律拒，不静默动本段', async () => {
    const { surface, write } = setup()

    await expect(
      surface.run(
        call('dashboard.write_binding', {
          node_id: 'n2',
          field_key: 'anchorValues[0].value',
          node_key: 'src:x',
        }),
      ),
    ).rejects.toThrow(/n2/)
    expect(write).not.toHaveBeenCalled()
  })

  it('少了点位身份就抛', async () => {
    const { surface } = setup()

    await expect(
      surface.run(
        call('dashboard.write_binding', {
          field_key: 'anchorValues[0].value',
        }),
      ),
    ).rejects.toThrow(/node_key/)
  })
})

describe('解绑定', () => {
  it('解掉一条已经有的', async () => {
    const { surface, drop } = setup({
      bindings: [point('anchorValues[0].value', 'src:A')],
    })

    const got = await run(surface, 'dashboard.remove_binding', {
      field_key: 'anchorValues[0].value',
    })

    expect(got.ok).toBe(true)
    expect(drop).toHaveBeenCalledWith('anchorValues[0].value')
  })

  // 静默成功会让模型以为解掉了，接着往下走，而那一条还在
  it('本来就没绑的那一条不许静默成功', async () => {
    const { surface, drop } = setup()

    await expect(
      surface.run(
        call('dashboard.remove_binding', {
          field_key: 'anchorValues[0].value',
        }),
      ),
    ).rejects.toThrow(/没有/)
    expect(drop).not.toHaveBeenCalled()
  })
})

describe('照抄绑定', () => {
  it('两块牌之间按字段名对，行号差多少都不影响', async () => {
    const { surface, write } = setup({
      // 1 号机组的「温度」是第 0 行，2 号机组的「温度」是第 2 行
      bindings: [point('panelValues[0].value', 'src:K1_TT01')],
    })

    const plan = await run(surface, 'dashboard.copy_bindings', {
      from_entity_id: 'p1',
      to_entity_id: 'p2',
    })

    expect(plan.copied).toEqual([
      {
        from_field_key: 'panelValues[0].value',
        to_field_key: 'panelValues[2].value',
        source_kind: 'opcua',
        node_key: 'src:K1_TT01',
        matched_by: 'by_label',
        is_overwrite: false,
      },
    ])
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      fieldKey: 'panelValues[2].value',
      nodeKey: 'src:K1_TT01',
    })
  })

  // ⚠ 这是这套数组绑定最容易「每条都有值、全接错对象」的地方
  it('对不上名字的行进 skipped，绝不退回按行号硬抄', async () => {
    const { surface, write } = setup({
      // 「流量」在 2 号机组上没有对应字段
      bindings: [point('panelValues[1].value', 'src:K1_FT01')],
    })

    const plan = await run(surface, 'dashboard.copy_bindings', {
      from_entity_id: 'p1',
      to_entity_id: 'p2',
    })

    expect(plan.copied).toEqual([])
    expect(plan.skipped).toEqual([
      { from_field_key: 'panelValues[1].value', reason: '目标处没有同名的行' },
    ])
    expect(write).not.toHaveBeenCalled()
  })

  it('只看不动手时一条都不写', async () => {
    const { surface, write } = setup({
      bindings: [point('panelValues[0].value', 'src:K1_TT01')],
    })

    const plan = await run(surface, 'dashboard.copy_bindings', {
      from_entity_id: 'p1',
      to_entity_id: 'p2',
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
          from_entity_id: 'p1',
          to_entity_id: '不存在的',
        }),
      ),
    ).rejects.toThrow(/没有可绑的行/)
  })
})

describe('读实时读数', () => {
  it('走的是视口那一份快照缓存，取到什么报什么', async () => {
    const { surface } = setup({
      bindings: [point('anchorValues[0].value', 'src:A')],
      samples: {
        'src:A': { state: 'ok', value: 42, timestampMs: 7, quality: 'good' },
      },
    })

    const report = await run(surface, 'dashboard.read_values')

    const items = report.items as Record<string, unknown>[]
    expect(items[0]).toMatchObject({
      field_key: 'anchorValues[0].value',
      entity: '1号机组出口',
      value: 42,
      status: 'has_value',
    })
  })

  // ⚠ 合成一档的话，「刚保存还没到下一拍」会被模型读成「这个点位是坏的」
  it('订上了还没来第一帧是 waiting，不是取不到', async () => {
    const { surface } = setup({
      bindings: [point('anchorValues[0].value', 'src:A')],
    })

    const report = await run(surface, 'dashboard.read_values')

    const items = report.items as Record<string, unknown>[]
    expect(items[0]?.status).toBe('waiting')
  })

  it('别的节点一律拒，不拿本段的读数冒充', async () => {
    const { surface } = setup()

    await expect(
      surface.run(call('dashboard.read_values', { node_id: 'n2' })),
    ).rejects.toThrow(/n2/)
  })
})

describe('落库', () => {
  it('保存成功回落库后的行版本', async () => {
    const { surface, save } = setup()

    const got = await run(surface, 'dashboard.save')

    expect(save).toHaveBeenCalledTimes(1)
    expect(got).toMatchObject({ ok: true, saved_version: 7 })
  })

  // ⚠ 静默吞掉会让模型接着往下绑，而每一条都存不进去
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

describe('截视口', () => {
  it('以视口宿主为根截图，交出去的是裸的 dataUrl 串', async () => {
    captureCanvas.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')
    const { surface, stageEl } = setup()

    const got = await surface.run(call('dashboard.capture', {}))

    expect(got).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(captureCanvas).toHaveBeenCalledWith(stageEl)
  })

  it('截不到时如实抛，不给一张空图', async () => {
    captureCanvas.mockRejectedValue(new Error('画布还没准备好，截不到图'))
    const { surface } = setup()

    await expect(surface.run(call('dashboard.capture', {}))).rejects.toThrow(
      /截不到/,
    )
  })
})

describe('认不出的工具', () => {
  // 静默成功会让模型以为改好了，最后给用户一个「已完成」而画面纹丝不动
  it('一律抛，不静默成功', async () => {
    const { surface } = setup()

    await expect(surface.run(call('dashboard.set_config', {}))).rejects.toThrow(
      /没有实现/,
    )
  })
})
