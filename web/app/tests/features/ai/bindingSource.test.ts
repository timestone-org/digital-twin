/** @fileoverview 历史绑定来源、范围校验与切换清理。 */
import { describe, it, expect } from 'vitest'
import { withSource } from '@/features/ai/bindingSource'
import { createBinding } from '@/features/dashboard/editorDoc'

const base = createBinding('n', 'values[0].series')
function write(args: Record<string, unknown>) {
  return withSource(
    base,
    { call_id: 'c', name: 'dashboard.write_binding', arguments: args },
    true,
  )
}

describe('历史绑定', () => {
  it('归档绑定完整落下取数窗口', () => {
    expect(
      write({
        source_kind: 'archive',
        node_key: 's:p',
        range: { last_window: '7d' },
        aggregate: 'max',
      }),
    ).toMatchObject({
      id: base.id,
      sourceKind: 'archive',
      nodeKey: null,
      detailJson: {
        nodeKey: 's:p',
        range: { lastWindow: '7d' },
        aggregate: 'max',
      },
    })
  })
  it('台账身份写在 detail 而不是实时点位键', () => {
    expect(
      write({
        source_kind: 'dataset',
        dataset_key: 'ds:energy:power',
        range: { last_window: '30d' },
      }),
    ).toMatchObject({
      sourceKind: 'dataset',
      nodeKey: null,
      detailJson: {
        datasetKey: 'ds:energy:power',
        range: { lastWindow: '30d' },
      },
    })
  })
  it.each([
    { range: { last_window: '7d', limit: 500 } },
    { range: {} },
    { range: { last_window: '0h' } },
    { range: { last_window: '1w' } },
    { range: { from_ms: 200, to_ms: 100 } },
    { range: { last_window: '7d', from_ms: 1, to_ms: 2 } },
    { range: { last_window: '7d' }, aggregate: 'unknown' },
  ])('拒绝不明确或无效的历史参数 $range', (patch) => {
    expect(() =>
      write({ source_kind: 'archive', node_key: 's:p', ...patch }),
    ).toThrow()
  })
  it('切回实时清除旧历史与派生配置，保留 id 和定值变换', () => {
    const old = {
      ...base,
      detailJson: { nodeKey: 's:old', range: { lastWindow: '1h' } },
      transformJson: { scale: 2 },
    }
    const next = withSource(old, {
      call_id: 'c',
      name: 'dashboard.write_binding',
      arguments: { node_key: 's:new' },
    })
    expect(next.detailJson).toBeNull()
    expect(next.computeJson).toBeNull()
    expect(next.id).toBe(base.id)
    expect(next.transformJson).toEqual({ scale: 2 })
  })
})

it('归档的绝对窗、分桶与时区完整保存', () => {
  expect(
    write({
      source_kind: 'archive',
      node_key: 's:p',
      range: { from_ms: 1000, to_ms: 2000 },
      interval: '1m',
      timezone: 'UTC',
    }).detailJson,
  ).toEqual({
    nodeKey: 's:p',
    range: { fromMs: 1000, toMs: 2000 },
    interval: '1m',
    timezone: 'UTC',
  })
})

it.each([
  { source_kind: 'dataset', dataset_key: 'bad' },
  { source_kind: 'dataset', dataset_key: 'ds:table:column', aggregate: 'max' },
  { node_key: 'bad' },
  { node_key: ' ' },
  { interval: 'bad' },
  { timezone: 'Unknown/Zone' },
  { range: { last_window: '1h', typo: 1 } },
  { range: null },
  { range: { from_ms: 1, to_ms: '2' } },
])('拒绝无效历史来源参数 $source_kind', (patch) => {
  expect(() =>
    write({
      source_kind: 'archive',
      node_key: 's:p',
      range: { last_window: '1h' },
      ...patch,
    }),
  ).toThrow()
})

it('孪生工作面未开放历史写入时仍拒绝', () => {
  expect(() =>
    withSource(base, {
      call_id: 'c',
      name: 'dashboard.write_binding',
      arguments: { source_kind: 'archive' },
    }),
  ).toThrow(/archive/)
})
