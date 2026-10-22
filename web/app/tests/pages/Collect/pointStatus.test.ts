/** @fileoverview 点位查询选项覆盖后端状态集合且不限定当前分页。 */
import { describe, expect, it } from 'vitest'
import { COLLECT_POINT_STATUSES } from '@dt/contracts'
import { POINT_STATUS_OPTIONS } from '@/pages/Collect/scripts/pointStatus'

describe('点位状态查询选项', () => {
  it('覆盖全部后端查询状态且每项只出现一次', () => {
    expect(POINT_STATUS_OPTIONS.map((option) => option.value).sort()).toEqual(
      [...COLLECT_POINT_STATUSES].sort(),
    )
  })
  it('选项明确涵盖整个数据源的异常', () => {
    expect(
      POINT_STATUS_OPTIONS.find((one) => one.value === 'abnormal')?.label,
    ).toBe('全部异常')
    expect(
      POINT_STATUS_OPTIONS.every((one) => !one.label.includes('本页')),
    ).toBe(true)
  })
})
