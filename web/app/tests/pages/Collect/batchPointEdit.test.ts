/** @fileoverview 采集点位的交互与数据完整性契约。 */
import { describe, expect, it } from 'vitest'
import type { CollectPoint } from '@dt/contracts'
import { previewPointEdits } from '@/pages/Collect/scripts/batchPointEdit'
const point: CollectPoint = {
  id: 'p1',
  source_id: 's1',
  node_key: 's1:p1',
  code: 'p1',
  name: '温度',
  address: 'ns=2;s=Temp',
  data_type: 'float',
  unit: '℃',
  sampling_interval_ms: 1000,
  deadband: 0,
  archive_enabled: true,
  archive_max_interval_ms: 60000,
  archive_retention_days: null,
  created_at: '',
  updated_at: '',
}
describe('批量编辑预览', () => {
  it('仅提交选择的字段，保留编码与寻址串', () => {
    expect(previewPointEdits([point], 'name_prefix', '一号')[0]?.input).toEqual(
      { name: '一号温度' },
    )
  })
  it('不提交没有变化的点位', () => {
    expect(previewPointEdits([point], 'unit', '℃')).toEqual([])
  })
  it('空单位明确清空', () => {
    expect(previewPointEdits([point], 'unit', '')[0]?.input).toEqual({
      unit: null,
    })
  })
  it.each(['', '-1', 'NaN', '49', '50.5'])('拒绝无效间隔 %s', (value) => {
    expect(() =>
      previewPointEdits([point], 'sampling_interval_ms', value),
    ).toThrow()
  })
  it.each([1, 25, 49])('接受正毫秒整数归档心跳 %s', (value) => {
    expect(
      previewPointEdits([point], 'archive_max_interval_ms', String(value))[0]
        ?.input,
    ).toEqual({ archive_max_interval_ms: value })
  })

  it.each(['0', '1.5'])('拒绝无效归档心跳 %s', (value) => {
    expect(() =>
      previewPointEdits([point], 'archive_max_interval_ms', value),
    ).toThrow()
  })

  it('拒绝改编码', () => {
    expect(() => previewPointEdits([point], 'code', 'new')).toThrow()
  })
})
