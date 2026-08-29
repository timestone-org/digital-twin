/**
 * @fileoverview 契约：部件装配点的三条失败边界。
 *
 * **守的是「加了部件但没反应」这一类静默故障**：档没登记、chunk 没加载出来、
 * 部件自己渲染抛错——三条都必须画出占位并说清是哪一种，且**只影响这一个部件**，
 * 不牵连同格的其它部件。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import CardPartRenderer from '../../src/cardParts/CardPartRenderer.vue'
import { defineCardPart } from '../../src/cardParts/define'
import {
  __resetCardParts,
  registerCardPart,
} from '../../src/cardParts/registry'
import type { CardCellView, CardPartMeta } from '../../src/cardParts/types'

const CELL: CardCellView = {
  label: '出口温度',
  values: { value: 42 },
  format: {
    unit: '℃',
    precision: 1,
    emptyText: '—',
    thousands: false,
    fixedDecimals: false,
  },
}

const META: CardPartMeta = {
  slots: { value: { state: 'ok' } },
  hasSlots: true,
}

/** 一个把收到的 props 原样吐出来的部件，用来验三件套确实喂对了。 */
const Probe = defineComponent({
  props: {
    part: { type: Object, required: true },
    cell: { type: Object, required: true },
    meta: { type: Object, required: true },
  },
  setup: (props) => () =>
    h('i', { 'data-test': 'probe' }, JSON.stringify(props.part)),
})

function register(
  kind: string,
  component: () => Promise<{ default: unknown }>,
) {
  registerCardPart(
    defineCardPart({
      kind,
      label: kind,
      icon: 'gauge',
      hint: '演示。',
      slots: ['value'],
      fields: [{ key: 'color', label: '颜色', type: 'color', default: '' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 用例要塞各种坏加载器
      component: component as any,
    }),
  )
}

function mountPart(kind: string, row: Record<string, unknown> = {}) {
  return mount(CardPartRenderer, {
    props: { kind, row: { kind, ...row }, cell: CELL, meta: META },
  })
}

afterEach(__resetCardParts)

describe('画得出来的时候', () => {
  it('三件套喂给部件，且配置已去前缀', async () => {
    register('meter', () => Promise.resolve({ default: Probe }))
    const wrapper = mountPart('meter', { 'meter-color': '#f00', 'x-y': 1 })
    await flushPromises()

    expect(wrapper.find('[data-test="probe"]').text()).toBe('{"color":"#f00"}')
  })
})

describe('三条失败边界', () => {
  // ⚠ 静默留白就是「我加了部件但没反应」
  it('档没登记时画占位并说是哪一档', async () => {
    const wrapper = mountPart('meter')
    await flushPromises()

    expect(wrapper.text()).toContain('meter')
    expect(wrapper.find('[data-test="probe"]').exists()).toBe(false)
  })

  it('chunk 加载失败时画占位，且与「没这档」分得开', async () => {
    register('meter', () => Promise.reject(new Error('boom')))
    const wrapper = mountPart('meter')
    await flushPromises()
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('没加载出来')
  })

  it('部件自己渲染抛错时就地拦下，画占位', async () => {
    const Boom = defineComponent({
      setup: () => () => {
        throw new Error('炸了')
      },
    })
    register('meter', () => Promise.resolve({ default: Boom }))
    const wrapper = mountPart('meter')
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('渲染失败')
  })

  /**
   * ⚠ 契约允许 `Promise.resolve({ default: C })`（第三方部件不走 `import()` 时就是它）。
   * 装配点不自己剥 `default` 的话，Vue 会把整个 `{ default: C }` 当组件，
   * 表现是这一格**既不渲染也不占位**——一块什么都不说的空白。
   */
  it('加载器回的是 { default } 时也剥得开', async () => {
    register('meter', () => Promise.resolve({ default: Probe }))
    const wrapper = mountPart('meter')
    await flushPromises()

    expect(wrapper.find('[data-test="probe"]').exists()).toBe(true)
  })
})

describe('换档', () => {
  it('上一档的失败痕迹不留给下一档', async () => {
    register('good', () => Promise.resolve({ default: Probe }))
    const wrapper = mountPart('bad')
    await flushPromises()
    expect(wrapper.text()).toContain('bad')

    await wrapper.setProps({ kind: 'good', row: { kind: 'good' } })
    await flushPromises()

    expect(wrapper.find('[data-test="probe"]').exists()).toBe(true)
  })
})
