/** @fileoverview 新模块在助手中的配置、绑定与撤销回归。 */
import { computed } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { getModule, registerBuiltinModules } from '@dt/modules'
import { createNode } from '@/features/dashboard/editorDoc'
import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import { createEditorSurface } from '@/pages/DashboardEditor/scripts/aiSurface'

function setup(type: string) {
  registerBuiltinModules()
  const manifest = getModule(type)
  if (manifest === undefined) throw new Error(type)
  const editor = useDashboardEditor(getModule)
  const node = createNode({
    dashboardId: 'd',
    manifest,
    parentId: null,
    siblingCount: 0,
    zIndex: 0,
  })
  editor.reset([node])
  const chrome = {
    card: computed(() => ({})),
    rules: computed(() => []),
    setCard: vi.fn(),
    setInteractions: vi.fn(),
    setSnap: vi.fn(),
    setGrid: vi.fn(),
  }
  const deps = {
    editor,
    getManifest: getModule,
    dashboardId: () => 'd',
    design: () => ({ width: 1920, height: 1080 }),
  }
  const surface = createEditorSurface({
    ...deps,
    chrome,
    actions: createEditorActions(deps),
    arrange: createArrangeActions({
      ...deps,
      chrome,
      steps: () => ({ x: 8, y: 8 }),
      notify: vi.fn(),
    }),
    stageEl: () => null,
    readSample: () => undefined,
    save: () => Promise.resolve({ isSaved: true, message: null }),
    savedVersion: () => 1,
  })
  return {
    editor,
    node,
    run: (name: string, args: Record<string, unknown> = {}) =>
      surface.run({
        call_id: 'c',
        name: `dashboard.${name}`,
        arguments: { node_id: node.id, ...args },
      }),
  }
}

describe('新模块实际清单', () => {
  it('雷达默认三轴可读，追加后四轴，修改第一轴保留其余默认项', async () => {
    const { editor, run } = setup('radar-chart')
    expect(await run('read_bindings')).toMatchObject({
      slots: [{ row_count: 3 }],
    })
    await run('set_config', { path: ['indicators', 0, 'name'], value: '能效' })
    expect(editor.nodes.value[0]?.configJson.indicators).toHaveLength(3)
    await run('add_config_item', {
      field: 'indicators',
      values: { name: '健康度' },
    })
    expect(editor.nodes.value[0]?.configJson.indicators).toHaveLength(4)
    editor.undo()
    expect(editor.nodes.value[0]?.configJson.indicators).toHaveLength(3)
  })

  it.each(['remove_config_item', 'set_config'])(
    '已有中间轴绑定时 %s 不允许静默移位',
    async (tool) => {
      const { editor, run } = setup('radar-chart')
      await run('add_config_item', {
        field: 'indicators',
        values: { name: '第四轴', min: 0, max: 100 },
      })
      await run('write_binding', {
        field_key: 'axisValues[1].value',
        source_kind: 'static',
        value: 82,
      })
      const before = JSON.stringify(editor.nodes.value)
      const args =
        tool === 'remove_config_item'
          ? { field: 'indicators', index: 0 }
          : {
              path: ['indicators'],
              value: [
                { name: '新的 1', min: 0, max: 100 },
                { name: '新的 2', min: 0, max: 100 },
                { name: '新的 3', min: 0, max: 100 },
              ],
            }
      await expect(run(tool, args)).rejects.toThrow(/绑定/)
      expect(JSON.stringify(editor.nodes.value)).toBe(before)
    },
  )

  it.each([
    ['trend-chart', 'seriesValues[0].series'],
    ['calendar-heat', 'dayValues[0].series'],
  ])('%s 可绑定归档并读回完整范围，实时来源会被拒绝', async (type, field) => {
    const { editor, run } = setup(type)
    await expect(
      run('write_binding', { field_key: field, node_key: 's:p' }),
    ).rejects.toThrow(/历史/)
    await run('write_binding', {
      field_key: field,
      source_kind: 'archive',
      node_key: 's:p',
      range: { last_window: '7d' },
      timezone: 'Asia/Shanghai',
    })
    expect(await run('read_bindings')).toMatchObject({
      slots: [
        {
          rows: expect.arrayContaining([
            expect.objectContaining({
              field_key: field,
              detail: {
                nodeKey: 's:p',
                range: { lastWindow: '7d' },
                timezone: 'Asia/Shanghai',
              },
            }),
          ]),
        },
      ],
    })
    const id = editor.nodes.value[0]?.bindings[0]?.id
    await run('write_binding', {
      field_key: field,
      source_kind: 'dataset',
      dataset_key: 'ds:energy:daily',
      range: { last_window: '30d' },
    })
    expect(editor.nodes.value[0]?.bindings[0]).toMatchObject({
      id,
      nodeKey: null,
      sourceKind: 'dataset',
      detailJson: { datasetKey: 'ds:energy:daily' },
    })
    editor.undo()
    expect(editor.nodes.value[0]?.bindings[0]?.sourceKind).toBe('archive')
  })

  it('数据表格实际返回 c1 槽，普通数值槽拒绝历史来源', async () => {
    const { run } = setup('data-table')
    const report = await run('read_bindings')
    expect(JSON.stringify(report)).toContain('.c1')
    expect(JSON.stringify(report)).not.toContain('.value')
    await expect(
      run('write_binding', {
        field_key: 'cellValues[0].c1',
        source_kind: 'archive',
        node_key: 's:p',
        range: { last_window: '7d' },
      }),
    ).rejects.toThrow(/不接收历史/)
  })

  it('错误枚举和数组子字段在修改前被拒绝，null 真正删除覆盖', async () => {
    const { editor, run } = setup('radar-chart')
    await expect(
      run('set_config', { path: ['chartStyle'], value: 'misspelled' }),
    ).rejects.toThrow(/options/)
    await expect(
      run('set_config', { path: ['indicators', 0, 'precision'], value: 10 }),
    ).rejects.toThrow(/范围/)
    await expect(
      run('add_config_item', { field: 'indicators', values: { maxx: 100 } }),
    ).rejects.toThrow(/maxx/)
    await run('set_config', { path: ['chartStyle'], value: 'area' })
    await run('set_config', { path: ['chartStyle'], value: null })
    expect(editor.nodes.value[0]?.configJson).not.toHaveProperty('chartStyle')
    await expect(run('set_config', { path: [], value: {} })).rejects.toThrow()
  })
})

it('删除末尾未绑定轴不影响前面已绑定轴，撤销恢复全部配置', async () => {
  const { editor, run } = setup('radar-chart')
  await run('add_config_item', {
    field: 'indicators',
    values: { name: '第四轴', min: 0, max: 100 },
  })
  await run('write_binding', {
    field_key: 'axisValues[0].value',
    source_kind: 'static',
    value: 70,
  })
  const id = editor.nodes.value[0]?.bindings[0]?.id
  await run('remove_config_item', { field: 'indicators', index: 3 })
  expect(editor.nodes.value[0]?.bindings[0]?.id).toBe(id)
  expect(editor.nodes.value[0]?.configJson.indicators).toHaveLength(3)
  editor.undo()
  expect(await run('read_bindings')).toMatchObject({
    slots: [{ row_count: 4 }],
  })
})

it('历史槽不能绑定到尚不存在的系列行', async () => {
  const { run } = setup('calendar-heat')
  await expect(
    run('write_binding', {
      field_key: 'dayValues[9].series',
      source_kind: 'archive',
      node_key: 's:p',
      range: { last_window: '1h' },
    }),
  ).rejects.toThrow(/配置实体/)
})

it('雷达量程上下界冲突时拒绝写入，可整项提交一致量程', async () => {
  const { editor, run } = setup('radar-chart')
  await expect(
    run('set_config', { path: ['indicators', 0, 'min'], value: 200 }),
  ).rejects.toThrow(/量程/)
  expect(editor.nodes.value[0]?.configJson).not.toHaveProperty('indicators')
  await run('set_config', {
    path: ['indicators', 0],
    value: { name: '功率', min: 200, max: 400 },
  })
  expect(editor.nodes.value[0]?.configJson.indicators).toHaveLength(3)
})
