/**
 * @fileoverview 契约：`waiting`（订上了还没来第一帧）与 `unavailable`（取不到）
 * 必须是两档。
 *
 * 合成一档的话，「刚保存还没到下一拍」会被模型读成「这个点位是坏的」，
 * 然后它去把一条好好的绑定改掉。
 */
import { describe, expect, it } from 'vitest'
import type { BindingView, PointSample } from '@dt/contracts'
import { computeModuleValues } from '@dt/runtime'
import { createBindingReader } from '@/runtime/bindingReader'

import type { BindingRowInput } from '@/features/ai/bindingReport'
import { pairRows, valueReport } from '@/features/ai/valueReport'
import { bindingReportQuery } from '@/features/ai/bindingReportQuery'

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
  it('坏质量保留与画布相同的转换值，同时明确不能作为有效读数', () => {
    const bound = binding('a', { transformJson: { scale: 0.001 } })
    const read = (): PointSample => ({
      ...READING,
      value: 1000,
      quality: 'bad',
    })
    const rendered = computeModuleValues({
      specs: [],
      bindings: [bound],
      read: createBindingReader(read),
    })
    const item = report([bound], read).items[0]
    expect(item).toMatchObject({
      value: 1,
      raw_value: 1000,
      quality: 'bad',
      status: 'unavailable',
    })
    expect(item?.value).toBe(rendered.values.a)
  })
  it.each(['bad', 'uncertain'] as const)(
    '质量为 %s 时不得声称有效验收',
    (quality) => {
      expect(
        report([binding('a')], () => ({ ...READING, quality })).items[0],
      ).toMatchObject({
        quality,
        raw_value: 42,
        status: quality === 'bad' ? 'unavailable' : 'uncertain',
      })
    },
  )
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
  it('枚举值复用模块清单映射并保留原始数值', () => {
    const found = valueReport({
      rows: pairRows(
        [row('a', '状态')],
        [binding('a')],
        [
          {
            key: 'a',
            label: '状态',
            dataType: 'enum',
            enumMap: { '1': 'running' },
          },
        ],
      ),
      read: () => ({ ...READING, value: 1 }),
    })
    expect(found.items[0]).toMatchObject({ raw_value: 1, value: 'running' })
  })
  it.each(['opcua', 'static'] as const)(
    '%s 读值使用画布的缩放、偏移和取整，保留原值',
    (sourceKind) => {
      const found = report(
        [
          binding('a', {
            sourceKind,
            staticValueJson: 1000,
            transformJson: { scale: 0.001, offset: 0.25, round: 1 },
          }),
        ],
        () => ({ ...READING, value: 1000 }),
      )
      expect(found.items[0]).toMatchObject({
        raw_value: 1000,
        value: 1.3,
        status: 'has_value',
      })
    },
  )

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

  it('没有序列快照接口时明确说明无法验收', () => {
    const found = report([binding('a', { sourceKind: 'archive' })])
    expect(found.items[0]).toMatchObject({
      status: 'unavailable',
      note: '当前工作面未提供历史序列快照，无法验收',
    })
  })

  it('派生值由渲染层就地算，同样说得出为什么这里没有', () => {
    const found = report([binding('a', { sourceKind: 'computed' })])
    expect(found.items[0]?.note).toBe('派生值由渲染层就地算')
  })
})

describe('条数上限', () => {
  it('单一场景第201行可按实体筛选并续读，保持原槽键', () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({
      ...row(`values[${String(index)}].value`, `设备${String(index)}`),
      entityId: 'device::temperature',
    }))
    const found = valueReport({
      rows: pairRows(rows, []),
      read: () => undefined,
      query: bindingReportQuery({
        entity_id: 'device',
        offset: 200,
        limit: 20,
      }),
    })
    expect(found).toMatchObject({
      total: 201,
      returned: 1,
      offset: 200,
      has_more: false,
      next_offset: null,
    })
    expect(found.items[0]?.field_key).toBe('values[200].value')
  })

  it('读数分页在过滤之后进行，并返回实际下一位置', () => {
    const found = valueReport({
      rows: pairRows([row('a', '甲'), row('b', '乙'), row('c', '乙')], []),
      read: () => undefined,
      query: bindingReportQuery({ keyword: '乙', limit: 1 }),
    })
    expect(found).toMatchObject({
      total: 2,
      returned: 1,
      next_offset: 1,
      has_more: true,
    })
    expect(found.items[0]?.field_key).toBe('b')
  })
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

describe('历史序列验收', () => {
  it('复用渲染序列并给出实际覆盖范围和截断', () => {
    const bound = binding('a', {
      sourceKind: 'archive',
      detailJson: { nodeKey: 's:p', range: { lastWindow: '7d' } },
    })
    const found = valueReport({
      rows: pairRows([row('a', '温度')], [bound]),
      read: () => undefined,
      readSeries: () => ({
        state: 'ok',
        value: 2,
        points: [
          { t: 1000, v: 1 },
          { t: 2000, v: 2 },
        ],
        isTruncated: true,
        truncatedSide: 'early',
        isStale: true,
      }),
    })
    expect(found.items[0]).toMatchObject({
      status: 'has_value',
      series: {
        point_count: 2,
        from: '1970-01-01T00:00:01.000Z',
        to: '1970-01-01T00:00:02.000Z',
        is_truncated: true,
        truncated_side: 'early',
        is_stale: true,
      },
    })
  })
  it('空窗口与取数失败分开', () => {
    const bound = binding('a', { sourceKind: 'dataset' })
    const found = valueReport({
      rows: pairRows([row('a', '产量')], [bound]),
      read: () => undefined,
      readSeries: () => ({ state: 'ok', value: null, points: [] }),
    })
    expect(found.items[0]?.status).toBe('empty')
    expect(found.items[0]?.note).toContain('窗口')
  })
})

it.each([
  [undefined, 'unavailable'],
  [{ state: 'pending' }, 'waiting'],
  [{ state: 'error', message: '取数失败' }, 'unavailable'],
] as const)('序列读数状态 %s 原样解释', (slot, status) => {
  const bound = binding('a', { sourceKind: 'archive' })
  expect(
    valueReport({
      rows: pairRows([row('a', '温度')], [bound]),
      read: () => undefined,
      readSeries: () => slot,
    }).items[0]?.status,
  ).toBe(status)
})

it('历史末值使用与图表一致的定值变换', () => {
  const bound = binding('a', {
    sourceKind: 'archive',
    transformJson: { scale: 0.001 },
  })
  expect(
    valueReport({
      rows: pairRows([row('a', '压力')], [bound]),
      read: () => undefined,
      readSeries: () => ({
        state: 'ok',
        value: 1000,
        points: [{ t: 1, v: 1000 }],
      }),
    }).items[0]?.value,
  ).toBe(1)
})
