/**
 * @fileoverview 契约：助手在孪生编辑器上按**实体名字**绑点，不按行号猜。
 *
 * 守的是这一页最容易静默出错的那件事：数组绑定的行号是文档序，实体本身不在
 * fieldKey 里露面。按行号猜的结果是每一条绑定都有值、却全接错了对象，
 * 而界面上看不出来。另守一条：截图走与大屏同一份口径，交出去的是裸的
 * dataUrl 串，且截的根是视口宿主。
 */
import { describe, expect, it, vi } from 'vitest'
import type { AssistantToolCall, BindingPayload } from '@dt/contracts'
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'

import { createBinding } from '@/features/dashboard/editorDoc'
import { createTwinSurface } from '@/pages/TwinEditor/scripts/aiSurface'

const captureCanvas = vi.hoisted(() => vi.fn())

vi.mock('@/features/ai/captureWithGl', () => ({ captureCanvas }))

function config(): TwinConfig {
  return normalizeTwinConfig({
    anchors: [
      { id: 'a1', name: '1号机组出口' },
      { id: 'a2', name: '2号机组出口' },
    ],
  })
}

function call(name: string, args: Record<string, unknown>): AssistantToolCall {
  return { call_id: 'c1', name, arguments: args }
}

function setup(bindings: BindingPayload[] = []) {
  const write = vi.fn<(binding: BindingPayload) => void>()
  const stageEl = document.createElement('div')
  const surface = createTwinSurface({
    config: () => config(),
    bindings: () => bindings,
    write,
    nodeId: () => 'n1',
    stage: () => stageEl,
  })
  return { surface, write, stageEl }
}

describe('读场景', () => {
  it('给出各类实体的条数与已绑数', async () => {
    const { surface } = setup()
    const shot = (await surface.run(
      call('dashboard.read_canvas', {}),
    )) as Record<string, unknown>
    expect(shot).toMatchObject({ is_ready: true, anchor_count: 2 })
  })

  it('配置还没读出来时如实说', async () => {
    const surface = createTwinSurface({
      config: () => null,
      bindings: () => [],
      write: vi.fn(),
      nodeId: () => 'n1',
      stage: () => null,
    })
    const shot = (await surface.run(
      call('dashboard.read_canvas', {}),
    )) as Record<string, unknown>
    expect(shot.is_ready).toBe(false)
  })
})

describe('读绑定行', () => {
  it('每一行都带着它喂的那个实体的名字', async () => {
    const { surface } = setup()
    const shot = (await surface.run(
      call('dashboard.read_bindings', {}),
    )) as Record<string, unknown>
    const rows = shot.rows as Record<string, unknown>[]
    // 按名字对，不按行号猜——按行号猜时每一行都有值却全接错了对象
    expect(rows[0]).toMatchObject({
      field_key: 'anchorValues[0].value',
      entity: '1号机组出口',
      entity_id: 'a1',
      node_key: null,
    })
  })

  it('已经绑上的那一行带出点位身份', async () => {
    const { surface } = setup([
      {
        ...createBinding('n1', 'anchorValues[1].value'),
        sourceKind: 'opcua',
        nodeKey: 'src:K1_TT02',
      },
    ])
    const shot = (await surface.run(
      call('dashboard.read_bindings', {}),
    )) as Record<string, unknown>
    const rows = shot.rows as Record<string, unknown>[]
    expect(rows[1]?.node_key).toBe('src:K1_TT02')
  })
})

describe('写绑定', () => {
  it('落到动作层上，并回报绑的是哪个实体', async () => {
    const { surface, write } = setup()
    const got = (await surface.run(
      call('dashboard.write_binding', {
        field_key: 'anchorValues[1].value',
        node_key: 'src:K1_TT02',
      }),
    )) as Record<string, unknown>
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
