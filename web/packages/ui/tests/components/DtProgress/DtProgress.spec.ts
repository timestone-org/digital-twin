/**
 * @fileoverview DtProgress 的 progressbar 语义与两种呈现的渲染契约。
 * ⚠ 未知进度必须不报 aria-valuenow：报一个假的比不报更糟，读屏会照着念。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtProgress from '../../../src/components/DtProgress/DtProgress.vue'

type ProgressProps = InstanceType<typeof DtProgress>['$props']

function mountProgress(props: Partial<ProgressProps> = {}) {
  return mount(DtProgress, { props })
}

describe('DtProgress 语义', () => {
  it('以 role=progressbar 承载语义', () => {
    expect(mountProgress().attributes('role')).toBe('progressbar')
  })

  it('当前值与上下限落到 aria-value* 上', () => {
    const wrapper = mountProgress({ value: 30, max: 60 })
    expect(wrapper.attributes('aria-valuenow')).toBe('30')
    expect(wrapper.attributes('aria-valuemin')).toBe('0')
    expect(wrapper.attributes('aria-valuemax')).toBe('60')
  })

  it('越界的当前值先夹再报，不报越界数字', () => {
    const wrapper = mountProgress({ value: 150, max: 100 })
    expect(wrapper.attributes('aria-valuenow')).toBe('100')
  })

  it('⚠ 非法上限回退 100，不报 aria-valuemax="NaN"', () => {
    const wrapper = mountProgress({ value: 10, max: Number.NaN })
    expect(wrapper.attributes('aria-valuemax')).toBe('100')
  })

  it('未知进度不报当前值，改标 aria-busy', () => {
    const wrapper = mountProgress({ indeterminate: true })
    expect(wrapper.attributes('aria-valuenow')).toBeUndefined()
    expect(wrapper.attributes('aria-busy')).toBe('true')
  })

  it('确定进度不标 aria-busy', () => {
    expect(mountProgress({ value: 10 }).attributes('aria-busy')).toBeUndefined()
  })

  it('可访问名称经 $attrs 落到根节点', () => {
    const wrapper = mount(DtProgress, { attrs: { 'aria-label': '导入进度' } })
    expect(wrapper.attributes('aria-label')).toBe('导入进度')
  })
})

describe('DtProgress 条形', () => {
  it('缺省就是条形', () => {
    expect(mountProgress().classes()).toContain('dt-progress--linear')
  })

  it('填充宽度按百分比', () => {
    const wrapper = mountProgress({ value: 25, max: 100 })
    expect(wrapper.find('.dt-progress__fill').attributes('style')).toContain(
      '25%',
    )
  })

  it('自定义上限下按比例换算', () => {
    const wrapper = mountProgress({ value: 5, max: 20 })
    expect(wrapper.find('.dt-progress__fill').attributes('style')).toContain(
      '25%',
    )
  })

  it('未知进度不写行内宽度，交给动画', () => {
    const wrapper = mountProgress({ indeterminate: true })
    expect(
      wrapper.find('.dt-progress__fill').attributes('style'),
    ).toBeUndefined()
  })

  it('showLabel 时显示百分比', () => {
    const wrapper = mountProgress({ value: 42, max: 100, showLabel: true })
    expect(wrapper.find('.dt-progress__label').text()).toBe('42%')
  })

  it('未知进度的标签是省略号，不是 0%', () => {
    const wrapper = mountProgress({ indeterminate: true, showLabel: true })
    expect(wrapper.find('.dt-progress__label').text()).toBe('…')
  })

  it('缺省不显示标签', () => {
    expect(mountProgress().find('.dt-progress__label').exists()).toBe(false)
  })
})

describe('DtProgress 环形', () => {
  it('variant=circular 时画 svg 而不是轨道', () => {
    const wrapper = mountProgress({ variant: 'circular' })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('.dt-progress__track').exists()).toBe(false)
  })

  it('描边偏移随进度走：满进度时偏移归零', () => {
    const wrapper = mountProgress({ variant: 'circular', value: 100 })
    const fill = wrapper.get('.dt-progress__ring-fill')
    expect(Number(fill.attributes('stroke-dashoffset'))).toBeCloseTo(0, 6)
  })

  it('零进度时偏移等于整条周长', () => {
    const wrapper = mountProgress({ variant: 'circular', value: 0 })
    const fill = wrapper.get('.dt-progress__ring-fill')
    expect(fill.attributes('stroke-dashoffset')).toBe(
      fill.attributes('stroke-dasharray'),
    )
  })

  it('未知进度留固定缺口，不跟着 value 走', () => {
    const wrapper = mountProgress({
      variant: 'circular',
      value: 100,
      indeterminate: true,
    })
    const fill = wrapper.get('.dt-progress__ring-fill')
    expect(Number(fill.attributes('stroke-dashoffset'))).toBeGreaterThan(0)
  })

  it('showLabel 时百分比压在环心', () => {
    const wrapper = mountProgress({
      variant: 'circular',
      value: 42,
      showLabel: true,
    })
    const label = wrapper.get('.dt-progress__label')
    expect(label.text()).toBe('42%')
    expect(label.classes()).toContain('dt-progress__label--center')
  })

  it('环对读屏隐藏，数值由根节点的 aria-value* 报', () => {
    const wrapper = mountProgress({ variant: 'circular' })
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true')
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 时环的边长跟着变', (size) => {
    const wrapper = mountProgress({ variant: 'circular', size })
    expect(Number(wrapper.find('svg').attributes('width'))).toBeGreaterThan(0)
  })
})

describe('DtProgress 语义色', () => {
  it.each([
    ['primary', '--accent-primary'],
    ['success', '--state-success'],
    ['warning', '--state-warning'],
    ['danger', '--state-danger'],
    ['info', '--state-info'],
    ['neutral', '--text-secondary'],
  ] as const)('intent=%s 取 %s', (intent, token) => {
    const wrapper = mountProgress({ intent })
    expect(wrapper.attributes('style')).toContain(token)
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    expect(mountProgress({ size }).classes()).toContain(`dt-progress--${size}`)
  })
})
