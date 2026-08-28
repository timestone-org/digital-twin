/**
 * @fileoverview 契约：`waiting`（订上了还没来第一帧）与 `unavailable`（取不到）
 * 必须是两档。
 *
 * 合成一档的话，「刚保存还没到下一拍」会被模型读成「这个点位是坏的」，
 * 然后它去把一条好好的绑定改掉。
 */
import { describe, expect, it } from 'vitest'
import type { BindingView, PointSample } from '@dt/contracts'

import type { BindingRowInput } from '@/features/ai/bindingReport'
import { pairRows, valueReport } from '@/features/ai/valueReport'

function row(fieldKey: string, label: string): BindingRowInput {
  return { slotKey: 'itemValues', index: 0, fieldKey, label, entityId: 'e1' }
}

function binding(
  fieldKey: string,
  patch: Partial<BindingView> = {},
): BindingView {
  return {
    id: `b-${fieldKey}`,
    fieldKey,
    sourceKind: 'opcua',
    nodeKey: 's:p1',
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    ...patch,
  }
}

const READING: PointSample = {
  state: 'ok',
  value: 42,
  timestampMs: Date.UTC(2026, 7, 28, 1, 2, 3),
  quality: 'good',
}

function report(
  bindings: readonly BindingView[],
  read: (nodeKey: string) => PointSample | undefined = () => undefined,
) {
  return valueReport({
    rows: pairRows([row('a', '1 号机组温度')], bindings),
    read,
  })
}

describe('四档取数结论', () => {
  it('有值时带上值与采样时刻，时刻是 UTC RFC3339', () => {
    const found = report([binding('a')], () => READING)
    expect(found.items[0]).toMatchObject({
      status: 'has_value',
      value: 42,
      at: '2026-08-28T01:02:03.000Z',
      entity: '1 号机组温度',
      node_key: 's:p1',
      source_kind: 'opcua',
    })
  })

  it('订上了还没来第一帧是 waiting，不是取不到', () => {
    expect(report([binding('a')]).items[0]).toMatchObject({
      status: 'waiting',
      at: null,
    })
  })

  it('取不到是 unavailable，并把现场报的原因带上', () => {
    const found = report([binding('a')], () => ({
      state: 'error',
      errorMessage: '采集器断了',
    }))
    expect(found.items[0]).toMatchObject({
      status: 'unavailable',
      note: '采集器断了',
    })
  })

  it('一条来源都没配是 unbound，并计进 unbound_count', () => {
    const found = report([])
    expect(found.items[0]?.status).toBe('unbound')
    expect(found.unbound_count).toBe(1)
  })

  it('实时绑定还没挑点位也算没配来源，说得出是哪一种', () => {
    const found = report([binding('a', { nodeKey: null })])
    expect(found.items[0]).toMatchObject({
      status: 'unbound',
      note: '实时绑定还没挑点位',
    })
  })
})

describe('非实时的那几种来源', () => {
  it('常量就地给值，没有采样时刻', () => {
    const found = report([
      binding('a', { sourceKind: 'static', nodeKey: null, staticValueJson: 5 }),
    ])
    expect(found.items[0]).toMatchObject({
      status: 'has_value',
      value: 5,
      at: null,
    })
  })

  it('常量 0 是合法读数，不许当成没配过', () => {
    const found = report([
      binding('a', { sourceKind: 'static', nodeKey: null, staticValueJson: 0 }),
    ])
    expect(found.items[0]).toMatchObject({ status: 'has_value', value: 0 })
  })

  it('常量写着 null 是没配过，不是「值是空」', () => {
    const found = report([
      binding('a', {
        sourceKind: 'static',
        nodeKey: null,
        staticValueJson: null,
      }),
    ])
    expect(found.items[0]?.status).toBe('unbound')
  })

  it('序列类在画布上本来就不展开，说清楚不是点位坏了', () => {
    const found = report([binding('a', { sourceKind: 'archive' })])
    expect(found.items[0]).toMatchObject({
      status: 'unavailable',
      note: '序列要异步取数，画布上不展开',
    })
  })

  it('派生值由渲染层就地算，同样说得出为什么这里没有', () => {
    const found = report([binding('a', { sourceKind: 'computed' })])
    expect(found.items[0]?.note).toBe('派生值由渲染层就地算')
  })
})

describe('条数上限', () => {
  it('超过上限时截断并说出来', () => {
    const rows = [row('a', '甲'), row('b', '乙'), row('c', '丙')]
    const found = valueReport({
      rows: pairRows(rows, []),
      read: () => undefined,
      maxItems: 2,
    })
    expect(found.items).toHaveLength(2)
    expect(found.is_truncated).toBe(true)
  })

  it('没超时不谎报截断', () => {
    expect(report([]).is_truncated).toBe(false)
  })
})

describe('行与绑定成对进来', () => {
  // ⚠ 整屏读数时十块卡片上的 `itemValues[0].value` 是同一个 fieldKey；
  // 先并成一张表再按 fieldKey 查，会让后一块的绑定盖掉前一块的
  it('两处同名的 fieldKey 各读各的绑定，不互相盖', () => {
    const found = valueReport({
      rows: [
        ...pairRows([row('a', '甲卡 · 温度')], [binding('a')]),
        ...pairRows(
          [row('a', '乙卡 · 温度')],
          [binding('a', { nodeKey: 's:other' })],
        ),
      ],
      read: () => undefined,
    })
    expect(found.items.map((one) => one.node_key)).toEqual(['s:p1', 's:other'])
  })
})
