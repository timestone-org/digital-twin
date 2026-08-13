/**
 * @fileoverview 折外三张小图的边界：过滤后没有热行时不画空图，而是说一句话；
 * 偏差方向必须说出来（低估与高估的后果不一样）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'

import ErrorHistogram from '@/pages/Hvac/ModelDetail/components/ErrorHistogram.vue'
import FoldStabilityBar from '@/pages/Hvac/ModelDetail/components/FoldStabilityBar.vue'
import TopErrorList from '@/pages/Hvac/ModelDetail/components/TopErrorList.vue'
import { prediction } from '@/testing/modelFixtures'

enableAutoUnmount(afterEach)

describe('误差分布', () => {
  it('⚠ 没有热行时不画空图，直说画不出来', () => {
    const wrapper = mount(ErrorHistogram, { props: { rows: [], hotMae: null } })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.text()).toContain('画不出误差分布')
  })

  it('系统性低估要点破后果，不只报一个数', () => {
    const wrapper = mount(ErrorHistogram, {
      props: {
        rows: [
          prediction({ actual_minutes: 30, p50: 20 }),
          prediction({ started_at: 'b', actual_minutes: 40, p50: 28 }),
        ],
        hotMae: 11,
      },
    })
    expect(wrapper.text()).toContain('预测偏短，提前量会不够')
  })

  it('高估只说偏长；几乎没偏差时说「基本无系统偏差」', () => {
    const high = mount(ErrorHistogram, {
      props: { rows: [prediction({ actual_minutes: 20, p50: 26 })], hotMae: 6 },
    })
    expect(high.text()).toContain('预测偏长')
    const flat = mount(ErrorHistogram, {
      props: { rows: [prediction({ actual_minutes: 24, p50: 24 })], hotMae: 1 },
    })
    expect(flat.text()).toContain('基本无系统偏差')
  })

  it('每根条挂上「误差区间：几条」的悬停说明', () => {
    const wrapper = mount(ErrorHistogram, {
      props: { rows: [prediction({ actual_minutes: 20, p50: 24 })], hotMae: 4 },
    })
    const titles = wrapper.findAll('title').map((node) => node.text())
    expect(titles.some((text) => text.includes('条'))).toBe(true)
    expect(titles.some((text) => text.startsWith('误差 ≤'))).toBe(true)
  })
})

describe('按折稳定性', () => {
  it('一条折外都没有时说清楚，不画空条', () => {
    const wrapper = mount(FoldStabilityBar, { props: { stats: [] } })
    expect(wrapper.text()).toContain('看不出按折的稳定性')
  })

  it('⚠ 某折没有热行时给破折号并淡化，不画成 0', () => {
    const wrapper = mount(FoldStabilityBar, {
      props: {
        stats: [
          { fold: 1, hotMae: null, count: 4 },
          { fold: 2, hotMae: 12.1, count: 9 },
        ],
      },
    })
    expect(wrapper.text()).toContain('没有热行')
    expect(wrapper.text()).toContain('—')
    expect(wrapper.text()).toContain('12.1 分钟')
    expect(wrapper.findAll('li')[0]?.classes()).toContain('opacity-50')
  })
})

describe('误差最大的 5 次', () => {
  it('一条都没有时说清楚', () => {
    const wrapper = mount(TopErrorList, { props: { rows: [] } })
    expect(wrapper.text()).toContain('这个组合没有折外预测')
  })

  it('⚠ 零行照样上榜并标出来：实际 0 却预测 41 是严重错误', () => {
    const wrapper = mount(TopErrorList, {
      props: {
        rows: [
          prediction({ actual_minutes: 0, p50: 41.2 }),
          prediction({ started_at: 'b', actual_minutes: 20, p50: 24 }),
        ],
      },
    })
    expect(wrapper.text()).toContain('零行')
    expect(wrapper.text()).toContain('实际 0 → 预测 41.2')
    expect(wrapper.text()).toContain('误差 +41.2 分钟')
    expect(wrapper.text()).toContain('误差 +4.0 分钟')
  })
})
