/** @fileoverview 二维助手配置必须可撤销、保留绑定，并拒绝悬空与被丢弃的修改。 */
import type { AssistantToolCall } from '@dt/contracts'
import { normalizeTwin2dConfig } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import { createBinding } from '@/features/dashboard/editorDoc'
import { createTwin2dSurface } from '@/pages/Twin2dEditor/scripts/aiSurface'
import { createTwin2dSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'
import { createTwin2dDoc } from '@/pages/Twin2dEditor/scripts/twin2dDoc'

function setup(input?: unknown) {
  const config = normalizeTwin2dConfig(
    input ?? {
      canvas: { width: 1920, height: 1080 },
      nodes: [
        { id: 'n1', styleId: 'water-tank', label: '1号水箱', x: 10, y: 10 },
        { id: 'n2', styleId: 'water-tank', label: '2号水箱', x: 300, y: 10 },
      ],
      edges: [{ id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } }],
    },
  )
  const binding = {
    ...createBinding('host', 'nodeValues[0].value'),
    sourceKind: 'static' as const,
    staticValueJson: '12',
  }
  const doc = createTwin2dDoc({ config, bindings: [binding] })
  const surface = createTwin2dSurface({
    config: () => doc.config.value,
    bindings: () => doc.bindings.value,
    patchConfig: doc.commit,
    write: () => undefined,
    drop: () => undefined,
    nodeId: () => 'host',
    nodeLabel: () => '测试二维孪生',
    moduleType: () => 'twin-2d-view',
    selection: createTwin2dSelection(),
    read: () => undefined,
    save: () => Promise.resolve({ isSaved: true, message: null }),
    savedVersion: () => 1,
  })
  const run = (name: string, arguments_: Record<string, unknown> = {}) => {
    const call: AssistantToolCall = {
      call_id: 'test',
      name,
      arguments: arguments_,
    }
    return surface.run(call)
  }
  return { doc, surface, run, binding }
}

describe('二维配置工具', () => {
  it('拒绝新增悬空图元槽引用且不新增撤销帧', async () => {
    const { doc, run } = setup(slotConfig('value'))
    const before = doc.config.value
    const layer = before.nodes[0]?.layers[0]
    expect(layer?.kind).toBe('txt')
    await expect(
      run('twin2d.patch_config', {
        section: 'nodes',
        id: 'n1',
        patch: {
          layers: [{ ...layer, src: { kind: 'slot', slot: 'DOES_NOT_EXIST' } }],
        },
      }),
    ).rejects.toThrow(/修改未应用/)
    expect(doc.config.value).toBe(before)
    expect(doc.canUndo.value).toBe(false)
  })

  it('悬空槽警告允许分步修改与撤销', async () => {
    const { doc, run } = setup(slotConfig('MISSING'))
    const before = doc.config.value
    await expect(
      run('twin2d.patch_config', {
        section: 'nodes',
        id: 'n1',
        patch: { label: '先改标题' },
      }),
    ).resolves.toMatchObject({ changed: true, is_saved: false })
    expect(doc.config.value.nodes[0]?.label).toBe('先改标题')
    doc.undo()
    expect(doc.config.value).toEqual(before)
    const layer = before.nodes[0]?.layers[0]
    await expect(
      run('twin2d.patch_config', {
        section: 'nodes',
        id: 'n1',
        patch: { layers: [{ ...layer, src: { kind: 'slot', slot: 'value' } }] },
      }),
    ).resolves.toMatchObject({
      changed: true,
      issues: expect.not.arrayContaining([
        expect.objectContaining({ code: 'dangling-slot' }),
      ]),
    })
  })
  it('声明读配置、修改与诊断三个真实执行工具', () => {
    expect(setup().surface.tools).toEqual(
      expect.arrayContaining([
        'twin2d.read_config',
        'twin2d.patch_config',
        'twin2d.diagnose',
      ]),
    )
  })

  it('按关键词分页读取名片并按稳定 id 读取完整配置', async () => {
    const { run } = setup()
    await expect(
      run('twin2d.read_config', {
        section: 'nodes',
        keyword: '水箱',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      section: 'nodes',
      items: [{ id: 'n1', name: '1号水箱' }],
      total: 2,
      next_page: 2,
    })
    await expect(
      run('twin2d.read_config', { section: 'nodes', id: 'n2' }),
    ).resolves.toMatchObject({ config: { id: 'n2', label: '2号水箱' } })
  })

  it('修改进入真实撤销栈，回执报告实际归一化结果且绑定保留', async () => {
    const { doc, run } = setup()
    const originalBindings = doc.bindings.value
    await expect(
      run('twin2d.patch_config', {
        section: 'nodes',
        id: 'n1',
        patch: { x: 45, label: '修改后的水箱' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      changed: true,
      is_saved: false,
      config: { x: 45, label: '修改后的水箱' },
    })
    expect(doc.config.value.nodes[0]?.label).toBe('修改后的水箱')
    expect(doc.bindings.value).toEqual(originalBindings)
    doc.undo()
    expect(doc.config.value.nodes[0]?.label).toBe('1号水箱')
    expect(doc.bindings.value).toEqual(originalBindings)
  })

  it.each([
    ['未知字段', { section: 'nodes', id: 'n1', patch: { imaginary: true } }],
    ['稳定身份', { section: 'nodes', id: 'n1', patch: { id: 'n3' } }],
    [
      '悬空样式',
      { section: 'nodes', id: 'n1', patch: { styleId: 'missing-style' } },
    ],
    [
      '悬空连线',
      { section: 'edges', id: 'e1', patch: { from: { nodeId: 'missing' } } },
    ],
    ['空修改', { section: 'canvas', patch: {} }],
    ['越界数字', { section: 'canvas', patch: { width: 1 } }],
    ['非法枚举', { section: 'nodes', id: 'n1', patch: { rotate: 31 } }],
    ['错误值类型', { section: 'nodes', id: 'n1', patch: { label: 42 } }],
  ])('拒绝%s，草稿没有变化', async (_label, args) => {
    const { doc, run } = setup()
    const original = doc.config.value
    await expect(run('twin2d.patch_config', args)).rejects.toThrow()
    expect(doc.config.value).toBe(original)
    expect(doc.canUndo.value).toBe(false)
  })

  it('画布读写保持已有字段，诊断识别预置样式', async () => {
    const { doc, run } = setup()
    await expect(
      run('twin2d.read_config', { section: 'canvas' }),
    ).resolves.toMatchObject({ config: { width: 1920 } })
    await expect(
      run('twin2d.patch_config', { section: 'canvas', patch: { width: 1600 } }),
    ).resolves.toMatchObject({ config: { width: 1600 } })
    expect(doc.config.value.canvas.height).toBe(1080)
    await expect(run('twin2d.diagnose')).resolves.toMatchObject({
      issues: expect.not.arrayContaining([
        expect.objectContaining({ code: 'dangling-style' }),
      ]),
    })
  })

  it('深合并连线端点，保留端点其它字段，重复操作不增加撤销帧', async () => {
    const { doc, run } = setup()
    await run('twin2d.patch_config', {
      section: 'edges',
      id: 'e1',
      patch: { from: { nodeId: 'n2' } },
    })
    expect(doc.config.value.edges[0]?.from).toEqual({
      nodeId: 'n2',
      portId: '',
      t: null,
    })
    await expect(
      run('twin2d.patch_config', {
        section: 'edges',
        id: 'e1',
        patch: { from: { nodeId: 'n2' } },
      }),
    ).resolves.toMatchObject({ changed: false })
    doc.undo()
    expect(doc.canUndo.value).toBe(false)
    expect(doc.config.value.edges[0]?.from.nodeId).toBe('n1')
  })

  it('列表末页与空列表给出真实续查状态', async () => {
    const { run } = setup()
    await expect(
      run('twin2d.read_config', { section: 'nodes', page: 2, limit: 1 }),
    ).resolves.toMatchObject({
      items: [{ id: 'n2', name: '2号水箱' }],
      has_more: false,
      next_page: null,
    })
    await expect(
      run('twin2d.read_config', { section: 'styles' }),
    ).resolves.toMatchObject({ items: [], total: 0, has_more: false })
  })

  it.each([
    ['非法 section', 'twin2d.read_config', { section: 'production' }],
    ['非法 id', 'twin2d.read_config', { section: 'nodes', id: 42 }],
    ['不存在 id', 'twin2d.read_config', { section: 'nodes', id: 'missing' }],
    ['单例给 id', 'twin2d.read_config', { section: 'canvas', id: 'n1' }],
    ['缺少 id', 'twin2d.patch_config', { section: 'nodes', patch: { x: 50 } }],
    ['超大分页', 'twin2d.read_config', { section: 'nodes', limit: 21 }],
    ['非法分页', 'twin2d.read_config', { section: 'nodes', page: 0 }],
    ['非法关键词', 'twin2d.read_config', { section: 'nodes', keyword: 42 }],
    ['空 patch', 'twin2d.patch_config', { section: 'canvas', patch: null }],
    [
      '无穷数字',
      'twin2d.patch_config',
      { section: 'canvas', patch: { width: Infinity } },
    ],
    [
      '数组类型',
      'twin2d.patch_config',
      { section: 'nodes', id: 'n1', patch: { ports: {} } },
    ],
    [
      '未知嵌套键',
      'twin2d.patch_config',
      { section: 'edges', id: 'e1', patch: { from: { imaginary: 'n2' } } },
    ],
    [
      '丢弃端口',
      'twin2d.patch_config',
      { section: 'nodes', id: 'n1', patch: { ports: [{ id: '' }] } },
    ],
  ])('拒绝%s', async (_label, name, args) => {
    await expect(setup().run(name, args)).rejects.toThrow()
  })
})

function slotConfig(slot: string) {
  return {
    nodes: [
      {
        id: 'n1',
        styleId: 'water-tank',
        slots: [{ key: 'value', name: '值', kind: 'number' }],
        layers: [{ id: 'txt1', kind: 'txt', src: { kind: 'slot', slot } }],
      },
    ],
  }
}
