/**
 * @fileoverview 一道契约闸：关掉 `inheritAttrs` 的控件，调用方写的 class / style
 * 必须落在**外壳**上，而不是跟着 `$attrs` 一起漏进里面的原生元素。
 * ⚠ 漏进去不报错也不红——`class="w-72"` 只把里面的输入框改窄、外壳照旧，
 * 表现是「样式写了不生效」，只能靠这条测试兜。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Component } from 'vue'

import DtDateTimeInput from '../../src/components/DtDateTimeInput/DtDateTimeInput.vue'
import DtInput from '../../src/components/DtInput/DtInput.vue'
import DtNumberInput from '../../src/components/DtNumberInput/DtNumberInput.vue'
import DtSlider from '../../src/components/DtSlider/DtSlider.vue'
import DtTextarea from '../../src/components/DtTextarea/DtTextarea.vue'

/** 每一档：组件 + 一份能挂载起来的 props + 里面那个原生元素的选择器。 */
const CASES: readonly {
  name: string
  component: Component
  props: Record<string, unknown>
  nativeSelector: string
}[] = [
  {
    name: 'DtInput',
    component: DtInput,
    props: { modelValue: '' },
    nativeSelector: 'input',
  },
  {
    name: 'DtNumberInput',
    component: DtNumberInput,
    props: { modelValue: 1 },
    nativeSelector: 'input',
  },
  {
    name: 'DtTextarea',
    component: DtTextarea,
    props: { modelValue: '' },
    nativeSelector: 'textarea',
  },
  {
    name: 'DtDateTimeInput',
    component: DtDateTimeInput,
    props: { modelValue: null },
    nativeSelector: 'input',
  },
  {
    name: 'DtSlider',
    component: DtSlider,
    props: { modelValue: 1 },
    nativeSelector: 'input',
  },
]

describe.each(CASES)('$name 的透传属性分派', (item) => {
  it('class 落在外壳上，不落到原生元素上', () => {
    const wrapper = mount(item.component, {
      props: item.props,
      attrs: { class: 'probe-cls' },
    })

    expect(wrapper.classes()).toContain('probe-cls')
    expect(wrapper.get(item.nativeSelector).classes()).not.toContain(
      'probe-cls',
    )
  })

  it('style 落在外壳上', () => {
    const wrapper = mount(item.component, {
      props: item.props,
      attrs: { style: 'width: 72px' },
    })

    expect(wrapper.attributes('style')).toContain('72px')
  })

  it('其余原生属性照旧落到原生元素上', () => {
    const wrapper = mount(item.component, {
      props: item.props,
      attrs: { class: 'probe-cls', 'data-test': 'probe' },
    })

    expect(wrapper.get(item.nativeSelector).attributes('data-test')).toBe(
      'probe',
    )
  })
})
