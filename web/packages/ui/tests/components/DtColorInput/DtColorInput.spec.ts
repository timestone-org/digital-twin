/**
 * @fileoverview DtColorInput 的受控、取色器初值与色板契约。
 * ⚠ 取色器初值解析不出 hex 时会静默落到回落色，用户一点就把 token 改写掉——
 * 所以「当前值能不能解析成 hex」这条要连着色块一起断言。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import DtColorInput from '../../../src/components/DtColorInput/DtColorInput.vue'

type ColorProps = InstanceType<typeof DtColorInput>['$props']

function mountColor(props: Partial<ColorProps> = {}) {
  return mount(DtColorInput, {
    props: { modelValue: '#00cefc', ...props },
    attachTo: document.body,
  })
}

function nativePicker<T extends Element = Element>(
  wrapper: ReturnType<typeof mountColor>,
) {
  return wrapper.get<T>('input[type="color"]')
}

describe('DtColorInput 取值', () => {
  it('色块按当前值预览', () => {
    const wrapper = mountColor({ modelValue: '#00cefc' })
    expect(wrapper.find('.dt-color__chip').attributes('style')).toContain(
      '#00cefc',
    )
    wrapper.unmount()
  })

  it('裸 token 预览时补成 var()', () => {
    const wrapper = mountColor({ modelValue: '--accent-primary' })
    expect(wrapper.find('.dt-color__chip').attributes('style')).toContain(
      'var(--accent-primary)',
    )
    wrapper.unmount()
  })

  it('空值预览成透明，而不是黑块', () => {
    const wrapper = mountColor({ modelValue: '' })
    expect(wrapper.find('.dt-color__chip').attributes('style')).toContain(
      'transparent',
    )
    wrapper.unmount()
  })

  it('取色器初值取当前值解析出的 hex', () => {
    const wrapper = mountColor({ modelValue: '#abc' })
    expect(nativePicker(wrapper).element).toHaveProperty('value', '#aabbcc')
    wrapper.unmount()
  })

  it('⚠ 解析不出时用中性黑开场，不用主题色冒充当前值', () => {
    const wrapper = mountColor({ modelValue: 'not-a-color' })
    expect(nativePicker(wrapper).element).toHaveProperty('value', '#000000')
    wrapper.unmount()
  })

  it('取色器选色后 emit 选中的 hex', async () => {
    const wrapper = mountColor()
    const picker = nativePicker<HTMLInputElement>(wrapper)
    picker.element.value = '#ff0000'
    await picker.trigger('input')
    expect(wrapper.emitted('update:modelValue')).toEqual([['#ff0000']])
    wrapper.unmount()
  })

  it('文本框改值直接 emit 原文，不替用户规范化', async () => {
    const wrapper = mountColor({ modelValue: '#00cefc' })
    await wrapper.find('input[type="text"]').setValue('--accent-primary')
    expect(wrapper.emitted('update:modelValue')).toEqual([['--accent-primary']])
    wrapper.unmount()
  })

  it('allowText=false 时只剩色块', () => {
    const wrapper = mountColor({ allowText: false })
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    expect(wrapper.find('input[type="color"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('DtColorInput 色板', () => {
  const SWATCHES = ['#00cefc', '--state-danger']

  it('不给色板时不渲染那一行', () => {
    const wrapper = mountColor()
    expect(wrapper.find('.dt-color__presets').exists()).toBe(false)
    wrapper.unmount()
  })

  it('空数组同样不渲染', () => {
    const wrapper = mountColor({ swatches: [] })
    expect(wrapper.find('.dt-color__presets').exists()).toBe(false)
    wrapper.unmount()
  })

  it('每个预设渲染一个按钮', () => {
    const wrapper = mountColor({ swatches: SWATCHES })
    expect(wrapper.findAll('.dt-color__preset')).toHaveLength(2)
    wrapper.unmount()
  })

  it('点预设 emit 它的原始规格，token 不被解析成 hex', async () => {
    const wrapper = mountColor({ swatches: SWATCHES })
    await wrapper.findAll('.dt-color__preset')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['--state-danger']])
    wrapper.unmount()
  })

  it('当前值命中的预设标 aria-pressed', () => {
    const wrapper = mountColor({ modelValue: '#00cefc', swatches: SWATCHES })
    const pressed = wrapper
      .findAll('.dt-color__preset')
      .map((preset) => preset.attributes('aria-pressed'))
    expect(pressed).toEqual(['true', 'false'])
    wrapper.unmount()
  })

  it('比对忽略首尾空白，免得看着一样却不高亮', () => {
    const wrapper = mountColor({ modelValue: ' #00cefc ', swatches: SWATCHES })
    expect(
      wrapper.findAll('.dt-color__preset')[0]?.attributes('aria-pressed'),
    ).toBe('true')
    wrapper.unmount()
  })

  it('每个预设都有可读名称，否则读屏只听得到一串按钮', () => {
    const wrapper = mountColor({ swatches: SWATCHES })
    const labels = wrapper
      .findAll('.dt-color__preset')
      .map((preset) => preset.attributes('aria-label'))
    expect(labels).toEqual(SWATCHES)
    wrapper.unmount()
  })
})

describe('DtColorInput 禁用与外壳', () => {
  it('disabled 时取色器与预设都禁用', () => {
    const wrapper = mountColor({ disabled: true, swatches: ['#00cefc'] })
    expect(nativePicker(wrapper).attributes('disabled')).toBe('')
    expect(wrapper.find('.dt-color__preset').attributes('disabled')).toBe('')
    wrapper.unmount()
  })

  it('⚠ disabled 时程序派发的选色也不 emit', async () => {
    // ⚠ 不能用 trigger：它在 disabled 元素上直接跳过，用例会空跑成绿灯
    const wrapper = mountColor({ disabled: true })
    nativePicker(wrapper).element.dispatchEvent(new Event('input'))
    await nextTick()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('⚠ disabled 时程序派发的预设点击也不 emit', async () => {
    const wrapper = mountColor({ disabled: true, swatches: ['#00cefc'] })
    wrapper.find('.dt-color__preset').element.dispatchEvent(new Event('click'))
    await nextTick()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('label 与取色器通过 id 关联', () => {
    const wrapper = mountColor({ label: '主色' })
    const id = nativePicker(wrapper).attributes('id')
    expect(wrapper.find('label[for]').attributes('for')).toBe(id)
    wrapper.unmount()
  })

  it('无 label 时取色器仍有可读名称', () => {
    const wrapper = mountColor()
    expect(nativePicker(wrapper).attributes('aria-label')).toBe('颜色')
    wrapper.unmount()
  })

  it('hint 经 aria-describedby 关联', () => {
    const wrapper = mountColor({ hint: '支持 token' })
    const described = nativePicker(wrapper).attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).text()).toBe('支持 token')
    wrapper.unmount()
  })

  it('error 时色块标红并用 role=alert 播报', () => {
    const wrapper = mountColor({ error: '颜色不合法' })
    expect(wrapper.find('.dt-color__swatch').classes()).toContain(
      'dt-color__swatch--invalid',
    )
    expect(wrapper.find('[role="alert"]').text()).toBe('颜色不合法')
    wrapper.unmount()
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mountColor({ size })
    expect(wrapper.find('.dt-color').classes()).toContain(`dt-color--${size}`)
    wrapper.unmount()
  })
})
