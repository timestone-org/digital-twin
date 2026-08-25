/**
 * @fileoverview 契约：助手在孪生编辑器上按**实体名字**绑点，不按行号猜。
 *
 * 守的是这一页最容易静默出错的那件事：数组绑定的行号是文档序，实体本身不在
 * fieldKey 里露面。按行号猜的结果是每一条绑定都有值、却全接错了对象，
 * 而界面上看不出来。另守一条：这一页**没有截图工具**——视口是 WebGL，
 * 给一个永远出白图的工具比不给更糟。
 */
import { describe, expect, it, vi } from 'vitest'
import type { AssistantToolCall, BindingPayload } from '@dt/contracts'
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'

import { createTwinSurface } from '@/pages/TwinEditor/scripts/aiSurface'

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
  const surface = createTwinSurface({
    config: () => config(),
    bindings: () => bindings,
    write,
    nodeId: () => 'n1',
  })
  return { surface, write }
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
        id: 'b1',
        nodeId: 'n1',
        fieldKey: 'anchorValues[1].value',
        sourceKind: 'opcua',
        nodeKey: 'src:K1_TT02',
        detailJson: null,
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

describe('这一页没有截图', () => {
  it('叫它一律抛', async () => {
    const { surface } = setup()
    // 视口是 WebGL，截图库取到的一定是空的；给一个永远出白图的工具更糟
    await expect(surface.run(call('dashboard.capture', {}))).rejects.toThrow(
      /dashboard\.capture/,
    )
  })
})
