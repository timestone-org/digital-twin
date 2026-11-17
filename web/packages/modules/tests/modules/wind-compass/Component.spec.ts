/** @fileoverview 风向罗盘的角度、缺失态和逐槽状态契约。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/wind-compass/Component.vue'
import manifest from '../../../src/modules/wind-compass/manifest'
import {
  directionLabel,
  normalizeDirection,
} from '../../../src/modules/wind-compass/readings'

describe('风向罗盘', () => {
  it('清单按需加载真实渲染组件', async () => {
    expect((await manifest.component()).default).toBe(Component)
  })
  it.each([
    [0, 0, '北'],
    [360, 0, '北'],
    [-90, 270, '西'],
    [450, 90, '东'],
    [45, 45, '东北'],
  ])('归一角度 %s', (raw, normalized, label) => {
    expect(normalizeDirection(raw)).toBe(normalized)
    expect(directionLabel(normalizeDirection(raw))).toBe(label)
  })
  it.each([null, undefined, NaN, Infinity, '0'])('拒绝无效角度 %s', (raw) => {
    expect(normalizeDirection(raw)).toBeNull()
    expect(directionLabel(normalizeDirection(raw))).toBe('—')
  })
  it('指针由风向驱动，风速和气温独立显示并响应更新', async () => {
    const wrapper = mount(Component, {
      props: {
        config: { accent: 'var(--accent-primary)', valueSize: 24 },
        values: { direction: 90, speed: 3.6, temperature: 18.1 },
      },
    })
    expect(
      wrapper.get('[data-testid="wind-pointer"]').attributes('transform'),
    ).toBe('rotate(90 100 100)')
    expect(wrapper.text()).toContain('3.6')
    expect(wrapper.text()).toContain('18.1')
    await wrapper.setProps({
      values: { direction: -90, speed: 0, temperature: 0 },
    })
    expect(wrapper.text()).toContain('风向 · 西')
    expect(
      wrapper.get('[data-testid="wind-pointer"]').attributes('transform'),
    ).toBe('rotate(270 100 100)')
    wrapper.unmount()
  })
  it('无绑定时不显示北风指针', () => {
    const wrapper = mount(Component, { props: { config: {}, values: {} } })
    expect(wrapper.find('[data-testid="wind-pointer"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('—')
    wrapper.unmount()
  })
  it('失败和等待不显示指针，陈旧读数有标注', () => {
    const wrapper = mount(Component, {
      props: {
        config: {},
        values: { direction: 0, temperature: 12 },
        meta: {
          slots: {
            direction: { state: 'error', message: '连接断开' },
            speed: { state: 'pending' },
            temperature: { state: 'ok', isStale: true },
          },
        },
      },
    })
    expect(wrapper.find('[data-testid="wind-pointer"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('取不到')
    expect(wrapper.text()).toContain('等待数据')
    expect(wrapper.text()).toContain('数据已陈旧')
    expect(wrapper.html()).toContain('连接断开')
    wrapper.unmount()
  })
})
