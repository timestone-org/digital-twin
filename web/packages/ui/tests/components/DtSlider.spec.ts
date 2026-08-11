/**
 * @fileoverview DtSlider 的取值、轨道着色与受控回弹契约。
 * ⚠ 填充比例算出 NaN% 会让整条 linear-gradient 作废、轨道整段变透明，
 * 而这在快照与类名断言里都看不出来，只能直接量 background。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import DtSlider from '../../src/components/DtSlider/DtSlider.vue'

type SliderProps = InstanceType<typeof DtSlider>['$props']

function mountSlider(props: Partial<SliderProps> = {}) {
  return mount(DtSlider, { props: { modelValue: 50, ...props } })
}

function trackBackground(wrapper: ReturnType<typeof mountSlider>): string {
  return wrapper.find('input').attributes('style') ?? ''
}

describe('DtSlider 取值', () => {
  it('底子是原生 range，白拿键盘与读屏语义', () => {
    const wrapper = mountSlider()
    expect(wrapper.find('input').attributes('type')).toBe('range')
  })

  it('渲染受控值', () => {
    const wrapper = mountSlider({ modelValue: 30 })
    expect(wrapper.find('input').element.value).toBe('30')
  })

  it('缺省区间是 0–100 步长 1', () => {
    const input = mountSlider().find('input')
    expect(input.attributes('min')).toBe('0')
    expect(input.attributes('max')).toBe('100')
    expect(input.attributes('step')).toBe('1')
  })

  it('range 逐项落到原生属性上', () => {
    const wrapper = mountSlider({
      modelValue: 1,
      range: { min: -5, max: 5, step: 0.5 },
    })
    const input = wrapper.find('input')
    expect(input.attributes('min')).toBe('-5')
    expect(input.attributes('max')).toBe('5')
    expect(input.attributes('step')).toBe('0.5')
  })

  it('拖动时 emit 数字而不是字符串', async () => {
    const wrapper = mountSlider()
    await wrapper.find('input').setValue('75')
    expect(wrapper.emitted('update:modelValue')).toEqual([[75]])
  })

  it('disabled 时原生禁用', () => {
    const wrapper = mountSlider({ disabled: true })
    expect(wrapper.find('input').attributes('disabled')).toBe('')
  })

  it('⚠ disabled 时程序派发的 input 也不 emit', async () => {
    const wrapper = mountSlider({ disabled: true })
    wrapper.find('input').element.dispatchEvent(new Event('input'))
    await nextTick()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('⚠ 父组件拒绝回写时把拇指拉回 modelValue，不留在松手处', async () => {
    const wrapper = mountSlider({ modelValue: 50 })
    const input = wrapper.find('input')
    await input.setValue('90')
    await nextTick()
    expect(input.element.value).toBe('50')
  })

  it('父组件接受回写时不去动 DOM', async () => {
    const wrapper = mountSlider({ modelValue: 50 })
    const input = wrapper.find('input')
    await input.setValue('90')
    await wrapper.setProps({ modelValue: 90 })
    await nextTick()
    expect(input.element.value).toBe('90')
  })
})

describe('DtSlider 轨道着色', () => {
  it('填充比例按当前值算', () => {
    expect(trackBackground(mountSlider({ modelValue: 25 }))).toContain('25%')
  })

  it('自定义区间下比例按区间换算', () => {
    const wrapper = mountSlider({ modelValue: 5, range: { min: 0, max: 20 } })
    expect(trackBackground(wrapper)).toContain('25%')
  })

  it('值低于下限时按 0% 画，不出负数', () => {
    const wrapper = mountSlider({ modelValue: -10, range: { min: 0, max: 20 } })
    expect(trackBackground(wrapper)).toContain('0%')
  })

  it('值高于上限时按 100% 画', () => {
    const wrapper = mountSlider({ modelValue: 99, range: { min: 0, max: 20 } })
    expect(trackBackground(wrapper)).toContain('100%')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    '⚠ 值为 %j 时回退 0%%，否则 NaN%% 会让整条渐变作废',
    (modelValue) => {
      const background = trackBackground(mountSlider({ modelValue }))
      expect(background).not.toContain('NaN')
      expect(background).toContain('0%')
    },
  )

  it('⚠ 上下限倒置时回退 0%，不去算负跨度', () => {
    const wrapper = mountSlider({ modelValue: 5, range: { min: 20, max: 20 } })
    expect(trackBackground(wrapper)).toContain('0%')
  })

  it('非有限的上限同样回退 0%', () => {
    const wrapper = mountSlider({
      modelValue: 5,
      range: { min: 0, max: Number.NaN },
    })
    expect(trackBackground(wrapper)).toContain('0%')
  })
})

describe('DtSlider 读出与外壳', () => {
  it('缺省显示数值读出', () => {
    expect(mountSlider({ modelValue: 42 }).find('output').text()).toBe('42')
  })

  it('unit 拼在数值后面', () => {
    const wrapper = mountSlider({ modelValue: 42, unit: '%' })
    expect(wrapper.find('output').text()).toBe('42%')
  })

  it('showValue=false 时不渲染读出', () => {
    const wrapper = mountSlider({ showValue: false })
    expect(wrapper.find('output').exists()).toBe(false)
  })

  it('label 与滑块通过 id 关联', () => {
    const wrapper = mountSlider({ label: '透明度' })
    const id = wrapper.find('input').attributes('id')
    expect(wrapper.find('label').attributes('for')).toBe(id)
  })

  it('hint 经 aria-describedby 关联', () => {
    const wrapper = mountSlider({ hint: '0 到 100' })
    const described = wrapper.find('input').attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).text()).toBe('0 到 100')
  })

  it('error 时标 aria-invalid 并用 role=alert 播报', () => {
    const wrapper = mountSlider({ error: '超出量程' })
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[role="alert"]').text()).toBe('超出量程')
  })

  it('无可见 label 时由 aria-label 经 $attrs 命名', () => {
    const wrapper = mount(DtSlider, {
      props: { modelValue: 1 },
      attrs: { 'aria-label': '透明度' },
    })
    expect(wrapper.find('input').attributes('aria-label')).toBe('透明度')
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mountSlider({ size })
    expect(wrapper.find('.dt-slider').classes()).toContain(`dt-slider--${size}`)
  })

  it('disabled 时加修饰类，供整块压暗', () => {
    const wrapper = mountSlider({ disabled: true })
    expect(wrapper.find('.dt-slider').classes()).toContain(
      'dt-slider--disabled',
    )
  })
})
