/** @fileoverview 批量复制只修改指定配置，替换只作用于选中对象绑定。 */
import { createTwinDoc } from '@/pages/TwinEditor/scripts/twinDoc'
import { normalizeTwinConfig } from '@dt/twin-config'
import { expect, it } from 'vitest'
import {
  copyPartSettings,
  replacementPlan,
  replacedBindings,
} from '@/pages/TwinEditor/scripts/batchConfig'
import { createBinding } from '@/features/dashboard/editorDoc'
it('复制外观时保留目标身份、节点、层级和取景', () => {
  const config = normalizeTwinConfig({
    parts: [
      { id: 'a', look: { color: '#ff0000' } },
      {
        id: 'b',
        name: '目标',
        nodes: ['B'],
        parentId: 'parent',
        click: { cameraId: 'view' },
      },
      { id: 'c' },
    ],
  })
  const next = copyPartSettings(config, 'a', ['b'], ['look'])
  expect(next.parts[1]).toMatchObject({
    id: 'b',
    name: '目标',
    nodes: ['B'],
    parentId: 'parent',
    click: { cameraId: 'view' },
    look: { color: '#ff0000' },
  })
  expect(next.parts[2]).toEqual(config.parts[2])
  expect(config.parts[1]?.look.color).toBe('')
})
it('替换按字面量且只匹配选中的信息牌', () => {
  const config = normalizeTwinConfig({
    panels: [
      { id: 'a', fields: [{ key: 't' }] },
      { id: 'b', fields: [{ key: 't' }] },
    ],
  })
  const bindings = [
    {
      ...createBinding('n', 'panelValues[0].value'),
      sourceKind: 'opcua' as const,
      nodeKey: 'source:pump.1.temp',
    },
    {
      ...createBinding('n', 'panelValues[1].value'),
      sourceKind: 'opcua' as const,
      nodeKey: 'source:pump.1.temp',
    },
  ]
  const plan = replacementPlan(config, bindings, 'panels', ['b'], {
    find: 'pump.1',
    replace: 'pump.2',
  })
  expect(plan.map((row) => [row.fieldKey, row.before, row.after])).toEqual([
    ['panelValues[1].value', 'source:pump.1.temp', 'source:pump.2.temp'],
  ])
})
it('整批字段变更连同绑定可以一次撤销，不清洗未选中对象', () => {
  const config = normalizeTwinConfig({
    parts: [
      { id: 'a', detail: { fields: [{ key: 'new' }] } },
      { id: 'b', detail: { fields: [{ key: 'old' }] } },
      { id: 'c' },
    ],
  })
  const binding = {
    ...createBinding('n', 'partFieldValues[1].value'),
    sourceKind: 'opcua' as const,
    nodeKey: 'source:old',
  }
  const doc = createTwinDoc({ config, bindings: [binding] })
  doc.commit(copyPartSettings(config, 'a', ['b'], ['detailFields']))
  expect(
    doc.config.value.parts[1]?.detail.fields.map((field) => field.key),
  ).toEqual(['new'])
  expect(doc.bindings.value).toEqual([])
  doc.undo()
  expect(doc.config.value).toEqual(config)
  expect(doc.bindings.value).toEqual([binding])
  expect(doc.canUndo.value).toBe(false)
})
it('点击复制保留目标取景，样式复制保留目标标题，空选择不记变更', () => {
  const config = normalizeTwinConfig({
    parts: [
      {
        id: 'a',
        detail: { title: '来源', width: 1400 },
        click: { near: 'detail', cameraId: 'source' },
      },
      { id: 'b', detail: { title: '目标' }, click: { cameraId: 'target' } },
    ],
  })
  const next = copyPartSettings(
    config,
    'a',
    ['b'],
    ['click', 'detailStyle', 'tint'],
  )
  expect(next.parts[1]).toMatchObject({
    click: { near: 'detail', cameraId: 'target' },
    detail: { title: '目标', width: 1400 },
  })
  expect(copyPartSettings(config, 'a', [], ['look'])).toBe(config)
  expect(copyPartSettings(config, 'missing', ['b'], ['look'])).toBe(config)
})
it('替换保持绑定标识，拒绝覆盖校验之后改变的绑定', () => {
  const binding = {
    ...createBinding('n', 'panelValues[0].value'),
    sourceKind: 'opcua' as const,
    nodeKey: 's:A',
  }
  const plan = [
    {
      bindingId: binding.id,
      fieldKey: binding.fieldKey,
      label: '温度',
      before: 's:A',
      after: 's:B',
    },
  ]
  expect(replacedBindings([binding], plan)[0]).toMatchObject({
    id: binding.id,
    nodeKey: 's:B',
  })
  expect(
    replacedBindings([{ ...binding, nodeKey: 's:C' }], plan)[0]?.nodeKey,
  ).toBe('s:C')
})
