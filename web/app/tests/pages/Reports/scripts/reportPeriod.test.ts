/** @fileoverview 报告期按业务时区格式化的日历边界。 */
import { describe, expect, it } from 'vitest'

import { currentReportPeriod } from '@/pages/Reports/scripts/reportPeriod'

describe('currentReportPeriod', () => {
  it.each([
    ['day', '2025-12-31'],
    ['month', '2025-12'],
    ['quarter', '2025Q4'],
    ['year', '2025'],
  ] as const)('按 %s 粒度格式化业务时区日历', (granularity, expected) => {
    expect(
      currentReportPeriod(
        granularity,
        'America/Los_Angeles',
        new Date('2026-01-01T00:30:00Z'),
      ),
    ).toBe(expected)
  })
})
