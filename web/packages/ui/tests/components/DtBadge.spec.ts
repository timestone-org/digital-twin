/**
 * @fileoverview DtBadge 的显隐、截断与可读名称契约。
 * ⚠ 「0 要不要显示」是它唯一容易错的地方：默认不显示（没有未读就别挂红点），
 * 而 NaN / Infinity 这类非有限值必须一并当成没有，否则会把 NaN 画进徽标。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtBadge from '../../src/components/DtBadge/DtBadge.vue'

type BadgeProps = InstanceType<typeof DtBadge>['$props']

function mountBadge(props: Partial<BadgeProps> = {}) {
  return mount(DtBadge, { props, slots: { default: '<i class="host" />' } })
}

function mark(wrapper: ReturnType<typeof mountBadge>) {
  return wrapper.find('.dt-badge__mark')
}

describe('DtBadge 显隐', () => {
  it('有计数时显示', () => {
    expect(mark(mountBadge({ value: 3 })).text()).toBe('3')
  })

  it('没给取值时不显示', () => {
    expect(mark(mountBadge()).exists()).toBe(false)
  })

  it('空串不显示', () => {
    expect(mark(mountBadge({ value: '' })).exists()).toBe(false)
  })

  it('计数为 0 时缺省不显示', () => {
    expect(mark(mountBadge({ value: 0 })).exists()).toBe(false)
  })

  it('showZero 时 0 也显示', () => {
    expect(mark(mountBadge({ value: 0, showZero: true })).text()).toBe('0')
  })

  it.each([Number.NaN, Number.NEGATIVE_INFINITY])(
    '⚠ %j 不显示，不把它画进徽标',
    (value) => {
      expect(mark(mountBadge({ value })).exists()).toBe(false)
    },
  )

  it('dot 模式恒显，与取值无关', () => {
    expect(mark(mountBadge({ dot: true })).exists()).toBe(true)
  })

  it('dot 模式不渲染数字', () => {
    expect(mark(mountBadge({ dot: true, value: 9 })).text()).toBe('')
  })

  it('被标注的元素照常渲染', () => {
    expect(mountBadge({ value: 1 }).find('.host').exists()).toBe(true)
  })
})

describe('DtBadge 计数', () => {
  it('未超限时原样显示', () => {
    expect(mark(mountBadge({ value: 99 })).text()).toBe('99')
  })

  it('超限显示 n+', () => {
    expect(mark(mountBadge({ value: 100 })).text()).toBe('99+')
  })

  it('自定义上限', () => {
    expect(mark(mountBadge({ value: 20, max: 9 })).text()).toBe('9+')
  })

  it('⚠ Infinity 落进超限分支而不是被当成空', () => {
    expect(mark(mountBadge({ value: Number.POSITIVE_INFINITY })).text()).toBe(
      '99+',
    )
  })

  it.each([Number.NaN, -1])('非法上限 %j 回退 99', (max) => {
    expect(mark(mountBadge({ value: 500, max })).text()).toBe('99+')
  })

  it('max=0 合法：任何正数都算超限', () => {
    expect(mark(mountBadge({ value: 1, max: 0 })).text()).toBe('0+')
  })

  it('文本取值原样显示，不走计数那套', () => {
    expect(mark(mountBadge({ value: 'NEW' })).text()).toBe('NEW')
  })
})

describe('DtBadge 无障碍与语义色', () => {
  it('计数模式的可读名称就是显示文本', () => {
    expect(mark(mountBadge({ value: 5 })).attributes('aria-label')).toBe('5')
  })

  it('⚠ dot 模式没有可读内容，给一句缺省名称', () => {
    expect(mark(mountBadge({ dot: true })).attributes('aria-label')).toBe(
      '有新内容',
    )
  })

  it('ariaLabel 覆写缺省名称', () => {
    const wrapper = mountBadge({ value: 5, ariaLabel: '5 条未读' })
    expect(mark(wrapper).attributes('aria-label')).toBe('5 条未读')
  })

  it('用 role=status 播报，不打断当前朗读', () => {
    expect(mark(mountBadge({ value: 1 })).attributes('role')).toBe('status')
  })

  it('缺省是 danger 色', () => {
    expect(mark(mountBadge({ value: 1 })).attributes('style')).toContain(
      '--state-danger',
    )
  })

  it.each([
    ['primary', '--accent-primary'],
    ['success', '--state-success'],
    ['warning', '--state-warning'],
    ['info', '--state-info'],
    ['neutral', '--text-secondary'],
  ] as const)('intent=%s 取 %s', (intent, token) => {
    const wrapper = mountBadge({ value: 1, intent })
    expect(mark(wrapper).attributes('style')).toContain(token)
  })
})
