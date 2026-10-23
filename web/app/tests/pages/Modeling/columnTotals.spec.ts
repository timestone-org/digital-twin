/** @fileoverview 列明细截断时使用原始总数，并兼容未保存总数的历史报告。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ColumnsBlock from '@/pages/Modeling/Canvas/components/ColumnsBlock.vue'
import CellsBlock from '@/pages/Modeling/Canvas/components/CellsBlock.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'
import { columnsOf } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

function block(payload: Record<string, unknown>): ReportBlock {
  return {
    kind: 'columns',
    port: 'frame',
    zone: 'step',
    title: '列的变化',
    tier: 0,
    isPrimary: null,
    payload,
  }
}

const NAMES = Array.from({ length: 60 }, (_, index) => `列${index}`)
const DTYPES = Array.from({ length: 12 }, (_, index) => ({
  key: `列${index}`,
  before: 'string',
  after: 'number',
}))

describe('列变化总数读取', () => {
  it('原始总数分别读取，明确的零不退化为缺失', () => {
    expect(
      columnsOf({ added_total: 65, removed_total: 0, dtype_before_total: 13 }),
    ).toMatchObject({ addedTotal: 65, removedTotal: 0, dtypeBeforeTotal: 13 })
  })

  it('历史缺省总数及不合法总数均保持未知，不补零或截断小数', () => {
    expect(columnsOf({})).toMatchObject({
      addedTotal: null,
      removedTotal: null,
      dtypeBeforeTotal: null,
    })
    expect(
      columnsOf({
        added_total: -1,
        removed_total: 1.5,
        dtype_before_total: '12',
      }),
    ).toMatchObject({
      addedTotal: null,
      removedTotal: null,
      dtypeBeforeTotal: null,
    })
  })
})

describe.each([
  ['added', 'added_total', '新增'],
  ['removed', 'removed_total', '移除'],
])('%s 名单的总数与已展示数量', (key, totalKey, label) => {
  it('65列名单展示60列时显示实际65列及剩余5列', () => {
    const wrapper = mount(ColumnsBlock, {
      props: { block: block({ [key]: NAMES, [totalKey]: 65, kept: 130 }) },
    })

    expect(wrapper.find('.dt-ml-cols__read').text()).toContain(`${label} 65 列`)
    expect(wrapper.find('summary').text()).toBe(`${label} 65 列`)
    expect(wrapper.text()).toContain('共 65 列，已展示前 60 列，另 5 列未展示')
  })

  it('明确总数恰好60列时不误报截断', () => {
    const wrapper = mount(ColumnsBlock, {
      props: { block: block({ [key]: NAMES, [totalKey]: 60, kept: 130 }) },
    })

    expect(wrapper.find('.dt-ml-cols__read').text()).toContain(`${label} 60 列`)
    expect(wrapper.text()).not.toContain('至少')
    expect(wrapper.find('.dt-ml-cols__more').exists()).toBe(false)
  })

  it('历史报告达到上限时只说至少60列，不能声称共60列', () => {
    const wrapper = mount(ColumnsBlock, {
      props: { block: block({ [key]: NAMES, kept: 130 }) },
    })

    expect(wrapper.find('.dt-ml-cols__read').text()).toContain(
      `${label} 至少 60 列`,
    )
    expect(wrapper.find('summary').text()).toBe(`${label} 至少 60 列`)
    expect(wrapper.text()).toContain('原始总数未记录，可能还有未展示的列')
  })
})

describe('类型对照名单的总数', () => {
  it('13列只展示12列时结论使用实际13列', () => {
    const wrapper = mount(ColumnsBlock, {
      props: {
        block: block({
          dtype_before: DTYPES,
          dtype_before_total: 13,
          kept: 13,
        }),
      },
    })
    expect(wrapper.find('.dt-ml-cols__read').text()).toContain('13 列换了类型')
    expect(wrapper.text()).toContain('共 13 列，已展示前 12 列，另 1 列未展示')
  })

  it('明确总数恰好12列时不误报截断', () => {
    const wrapper = mount(ColumnsBlock, {
      props: {
        block: block({
          dtype_before: DTYPES,
          dtype_before_total: 12,
          kept: 12,
        }),
      },
    })
    expect(wrapper.find('.dt-ml-cols__read').text()).toContain('12 列换了类型')
    expect(wrapper.find('.dt-ml-cols__more').exists()).toBe(false)
  })

  it('历史类型名单达到上限时不猜原始总数', () => {
    const wrapper = mount(ColumnsBlock, {
      props: { block: block({ dtype_before: DTYPES, kept: 15 }) },
    })
    expect(wrapper.find('.dt-ml-cols__read').text()).toContain(
      '至少 12 列换了类型',
    )
    expect(wrapper.text()).toContain('原始总数未记录，可能还有未展示的列')
  })
})

describe('格子明细的展示小计', () => {
  it('达到12列上限时只汇总已展示明细，不声称是全量格数', () => {
    const wrapper = mount(CellsBlock, {
      props: {
        block: {
          ...block({
            by_column: Array.from({ length: 12 }, (_, index) => ({
              key: `列${index}`,
              changed: 1,
              low: 0,
              high: 0,
              samples: [],
            })),
          }),
          kind: 'cells',
        },
      },
    })
    expect(wrapper.find('.dt-ml-cells__read').text()).toContain(
      '已展示的 12 列合计改了 12 个格子',
    )
    expect(wrapper.find('.dt-ml-cells__read').text()).not.toContain('一共改了')
    expect(wrapper.text()).toContain('可能还有未展示的列')
  })
})
