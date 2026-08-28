/**
 * @fileoverview 契约：规格书要把「这一行喂的是哪个实体」摊出来，而且**空行也在**。
 *
 * 数组绑定的行号是文档序，实体不在 fieldKey 里露面。缺了实体名，模型只能按行号
 * 猜——结果是每条绑定都有值、却全接错了对象；省掉空行，模型会以为那些实体不存在。
 */
import { describe, expect, it } from 'vitest'
import type { BindingPayload, ModuleManifest } from '@dt/contracts'

import {
  manifestBindingReport,
  manifestBindingRows,
  rowsBindingReport,
  slotsFromRows,
  type BindingRowInput,
} from '@/features/ai/bindingReport'

const MANIFEST: ModuleManifest = {
  type: 'metric-demo',
  displayName: '实时数值卡',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: [
    { key: 'title', label: '标题', dataType: 'string' },
    {
      key: 'itemValues',
      label: '读数',
      dataType: 'number',
      isArray: true,
      isEntityPinned: true,
      isRequired: true,
      arrayFields: [{ key: 'value', label: '读数', dataType: 'number' }],
    },
  ],
  bindingRowLabels: () => ({
    'itemValues[0].value': { title: '1 号机组温度', id: 'm-1' },
    'itemValues[1].value': { title: '2 号机组温度', id: 'm-2' },
  }),
  bindingRowCounts: () => ({ itemValues: 3 }),
  component: () => Promise.resolve({ default: {} }),
}

/** 老口径的清单：不声明行数也不声明行名，行由用户手工增删。 */
const LOOSE: ModuleManifest = {
  type: 'metric-demo',
  displayName: '实时数值卡',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: MANIFEST.bindings,
  component: () => Promise.resolve({ default: {} }),
}

function binding(fieldKey: string, nodeKey: string | null): BindingPayload {
  return {
    id: `b-${fieldKey}`,
    nodeId: 'n1',
    fieldKey,
    sourceKind: nodeKey === null ? 'static' : 'opcua',
    nodeKey,
    staticValueJson: nodeKey === null ? 7 : null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: '',
    updatedAt: '',
  }
}

function report(bindings: readonly BindingPayload[], manifest = MANIFEST) {
  return manifestBindingReport({
    nodeId: 'n1',
    moduleType: manifest.type,
    nodeLabel: '主变监视',
    manifest,
    config: {},
    bindings,
  })
}

describe('靠模块清单摊', () => {
  it('行数跟着清单声明走，没绑的行也在，node_key 为 null', () => {
    const found = report([binding('itemValues[0].value', 's1:p1')])
    const slot = found.slots[0]
    expect(slot?.row_count).toBe(3)
    expect(slot?.rows.map((row) => row.node_key)).toEqual(['s1:p1', null, null])
  })

  it('每一行带着它喂的那个实体的名字与 id', () => {
    const slot = report([]).slots[0]
    expect(slot?.rows[0]).toMatchObject({
      index: 0,
      field_key: 'itemValues[0].value',
      entity: '1 号机组温度',
      entity_id: 'm-1',
    })
    expect(slot?.rows[1]?.entity).toBe('2 号机组温度')
  })

  it('清单没给行名的那一行退回「第 N 行」而不是空着', () => {
    expect(report([]).slots[0]?.rows[2]?.entity).toBe('第 3 行')
  })

  it('标量槽单列在 scalars 里，带着它接的常量', () => {
    const found = report([binding('title', null)])
    expect(found.scalars).toEqual([
      {
        key: 'title',
        label: '标题',
        source_kind: 'static',
        node_key: null,
        static_value: 7,
      },
    ])
  })

  it('槽声明照抄清单：数组、钉实体、必绑三格都在', () => {
    expect(report([]).slots[0]).toMatchObject({
      key: 'itemValues',
      label: '读数',
      data_type: 'number',
      is_array: true,
      is_entity_pinned: true,
      is_required: true,
    })
  })

  it('画布上那个名字进 node_label', () => {
    expect(report([]).node_label).toBe('主变监视')
  })

  it('清单没声明行数时按已有绑定推，不会凭空长出行', () => {
    const found = report([binding('itemValues[1].value', 's1:p2')], LOOSE)
    expect(found.slots[0]?.row_count).toBe(2)
    expect(found.slots[0]?.rows).toHaveLength(2)
  })

  it('声明了 0 行的槽就是 0 行——不许按真假判而退回按绑定推', () => {
    const empty: ModuleManifest = {
      ...MANIFEST,
      bindingRowCounts: () => ({ itemValues: 0 }),
    }
    const found = report([binding('itemValues[0].value', 's1:p1')], empty)
    expect(found.slots[0]?.row_count).toBe(0)
    expect(found.slots[0]?.rows).toEqual([])
  })

  it('超过上限时截断并说出来', () => {
    const found = manifestBindingReport({
      nodeId: 'n1',
      moduleType: MANIFEST.type,
      nodeLabel: '主变监视',
      manifest: MANIFEST,
      config: {},
      bindings: [],
      maxRows: 2,
    })
    expect(found.slots[0]?.rows).toHaveLength(2)
    expect(found.is_truncated).toBe(true)
  })

  it('认不出模块时给一份空规格书而不是抛', () => {
    const found = manifestBindingReport({
      nodeId: 'n1',
      moduleType: 'unknown',
      nodeLabel: '不认识',
      manifest: undefined,
      config: {},
      bindings: [],
    })
    expect(found).toMatchObject({ slots: [], scalars: [], is_truncated: false })
  })

  it('行表里标量槽也占一条，fieldKey 就是槽键', () => {
    const rows = manifestBindingRows({
      manifest: MANIFEST,
      config: {},
      bindings: [],
    })
    expect(rows[0]).toMatchObject({
      slotKey: 'title',
      index: 0,
      fieldKey: 'title',
    })
  })
})

const TWIN_ROWS: BindingRowInput[] = [
  {
    slotKey: 'anchorValues',
    index: 0,
    fieldKey: 'anchorValues[0].value',
    label: '1 号机组',
    entityId: 'a-1',
  },
  {
    slotKey: 'anchorValues',
    index: 1,
    fieldKey: 'anchorValues[1].value',
    label: '2 号机组',
    entityId: 'a-2',
  },
  {
    slotKey: 'panelValues',
    index: 0,
    fieldKey: 'panelValues[0].value',
    label: 'A 板 · 温度',
    entityId: 'p-1',
  },
]

describe('靠现成行表摊', () => {
  it('孪生的行表直接喂得进来，槽按行的出现次序反推', () => {
    const found = rowsBindingReport({
      nodeId: 'n9',
      moduleType: 'twin-view',
      nodeLabel: '三维孪生',
      rows: TWIN_ROWS,
      bindings: [binding('anchorValues[1].value', 's1:p9')],
      slotLabels: { anchorValues: '锚点读数' },
    })
    expect(found.slots.map((slot) => slot.key)).toEqual([
      'anchorValues',
      'panelValues',
    ])
    expect(found.slots[0]?.label).toBe('锚点读数')
    expect(found.slots[0]?.rows[1]?.node_key).toBe('s1:p9')
    expect(found.slots[0]?.rows[0]?.node_key).toBeNull()
  })

  it('没给槽名就用槽键，不编一个出来', () => {
    expect(slotsFromRows(TWIN_ROWS)[1]?.label).toBe('panelValues')
  })

  it('行表反推的槽不知道数据类型，如实给 null', () => {
    expect(slotsFromRows(TWIN_ROWS)[0]?.dataType).toBeNull()
  })

  it('行表反推的槽一律算钉在实体上：行表存在就是因为行钉着实体', () => {
    expect(slotsFromRows(TWIN_ROWS)[0]).toMatchObject({
      isArray: true,
      isEntityPinned: true,
      rowCount: 2,
    })
  })
})
