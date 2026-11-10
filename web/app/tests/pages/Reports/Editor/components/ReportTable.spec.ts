/** @fileoverview 试算表格：内容相同的两行也各有各的行键，不许撞键。 */
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'

import ReportTable from '@/pages/Reports/Editor/components/ReportTable.vue'

afterEach(() => vi.restoreAllMocks())

it('⚠ 两行取值完全相同时照样各画一行，重新试算也不报重复键', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const wrapper = mount(ReportTable, {
    props: {
      node: {
        kind: 'table',
        columns: ['温度', '压力'],
        rows: [
          ['0', '0'],
          ['0', '0'],
          ['1', '1'],
        ],
      },
    },
  })
  await wrapper.setProps({
    node: {
      kind: 'table',
      columns: ['温度', '压力'],
      rows: [
        ['2', '2'],
        ['0', '0'],
        ['0', '0'],
      ],
    },
  })
  expect(wrapper.findAll('tbody tr')).toHaveLength(3)
  const duplicate = warn.mock.calls.some((call) =>
    String(call[0]).includes('Duplicate keys'),
  )
  expect(duplicate).toBe(false)
  wrapper.unmount()
})
