/** @fileoverview 逐台季节和实际达标范围的可见契约。 */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ComplianceSummary from '@/features/hvac/ComplianceSummary.vue'

it('同一房间可以同时显示冬季和非冬季，单边不限不会变成零', () => {
  const wrapper = mount(ComplianceSummary, {
    props: {
      items: [
        {
          serial: 'K01',
          season: 'winter',
          limits: [
            {
              metric: 'workshop_temp_avg',
              lower_limit: '20.00',
              upper_limit: '24.00',
            },
            {
              metric: 'workshop_humidity_avg',
              lower_limit: '45',
              upper_limit: '55',
            },
          ],
        },
        {
          serial: 'K02',
          season: 'non_winter',
          limits: [
            {
              metric: 'workshop_temp_avg',
              lower_limit: null,
              upper_limit: '28',
            },
          ],
        },
      ],
    },
  })
  expect(wrapper.text()).toContain(
    'K01 · 冬季 · 温度 20.00～24.00 ℃，湿度 45～55 %RH',
  )
  expect(wrapper.text()).toContain('K02 · 非冬季 · 温度 不限～28 ℃')
})

it('未配置范围与没有快照是两种不同的展示', () => {
  const empty = mount(ComplianceSummary, { props: { items: [] } })
  expect(empty.text()).toBe('')
  const unrestricted = mount(ComplianceSummary, {
    props: { items: [{ serial: 'K01', season: 'non_winter', limits: [] }] },
  })
  expect(unrestricted.text()).toContain('未限制范围')
})
