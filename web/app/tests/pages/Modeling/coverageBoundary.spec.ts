/** @fileoverview 请求边界外的空白与实际样本内部断档分别展示。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AxisBlock from '@/pages/Modeling/Canvas/components/AxisBlock.vue'
import TimelineBand from '@/pages/Modeling/Canvas/components/TimelineBand.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

const HALF_HOUR = 1_800_000
const SINCE = Date.parse('2026-08-16T07:30:00Z')
const UNTIL = Date.parse('2026-10-15T07:00:00Z')

function block(
  requestedSince: number,
  requestedUntil: number,
  gaps: readonly Record<string, number>[] = [],
): ReportBlock {
  return {
    kind: 'axis',
    port: 'frame',
    zone: 'charts',
    title: '时间覆盖',
    tier: 2,
    isPrimary: true,
    payload: {
      actual_since: new Date(SINCE).toISOString(),
      actual_until: new Date(UNTIL).toISOString(),
      occupancy: [1, 1],
      gaps,
      segments: [
        {
          since: requestedSince,
          until: requestedUntil,
          label: '请求区间',
          tone: 'requested',
        },
      ],
    },
  }
}

describe('取数覆盖边界', () => {
  it.each([
    [SINCE, UNTIL + HALF_HOUR],
    [SINCE - HALF_HOUR, UNTIL],
    [SINCE - HALF_HOUR, UNTIL + HALF_HOUR],
  ])('请求 %s ~ %s 的外侧空白不会被编成内部断档', (since, until) => {
    const wrapper = mount(AxisBlock, { props: { block: block(since, until) } })

    expect(wrapper.findAll('.dt-ml-band__bar--gap')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('段断档')
    expect(wrapper.text()).toContain('超出实际样本时段的部分未覆盖')
    expect(wrapper.findComponent(TimelineBand).props('rows')).toContainEqual(
      expect.objectContaining({
        segments: [expect.objectContaining({ since: SINCE, until: UNTIL })],
      }),
    )
  })

  it('内部真实断档仍展示，外侧两段空白不增加断档数', () => {
    const wrapper = mount(AxisBlock, {
      props: {
        block: block(SINCE - HALF_HOUR, UNTIL + HALF_HOUR, [
          {
            since: SINCE + HALF_HOUR,
            until: SINCE + 4 * HALF_HOUR,
            missing: 2,
          },
        ]),
      },
    })

    expect(wrapper.findAll('.dt-ml-band__bar--gap')).toHaveLength(1)
    expect(wrapper.text()).toContain('1 段断档，合计缺 2 行')
    expect(wrapper.text()).not.toContain('3 段断档')
  })
})
