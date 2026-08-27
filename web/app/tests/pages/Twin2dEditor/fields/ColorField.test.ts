/**
 * @fileoverview 契约：颜色格写回文档的一律是 `sanitizeCssValue` 消毒过的值，
 * 被拒的取值连同框里的原文一起回落到本格缺省。
 *
 * ⚠ 判据只有 `@dt/twin2d` 一份：控件里另写一条比它松的，文档里就会存下一个渲染层
 * 照样会拒掉的取值——表现是「配了不生效」，零报错。
 * ⚠ 框里留的是用户敲的原文（含空白）：写回 trim 过的值会把 `rgb(0, 255, 0)` 里的
 * 空格一并吃掉，那个空格就永远打不出来。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ColorField from '@/pages/Twin2dEditor/components/fields/ColorField.vue'

function mountField(over: { modelValue?: string; fallback?: string } = {}) {
  return mount(ColorField, {
    props: { modelValue: '', ...over },
  })
}

type Wrapper = ReturnType<typeof mountField>

function textBox(wrapper: Wrapper) {
  return wrapper.find<HTMLInputElement>('input[type="text"]')
}

function lastWrite(wrapper: Wrapper): string {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回颜色')
  return String(events[events.length - 1]?.[0])
}

describe('消毒', () => {
  // ⚠ 外链是这一格唯一能把请求打出去的写法
  it('外链写法被拒并回落缺省，框里也不留那半截', async () => {
    const wrapper = mountField({ modelValue: 'red', fallback: 'currentColor' })

    await textBox(wrapper).setValue('url(http://evil.example/a.png)')
    expect(lastWrite(wrapper)).toBe('currentColor')

    await wrapper.find('.dt-t2-color').trigger('focusout')

    expect(textBox(wrapper).element.value).toBe('red')
  })

  it('外部样式表引入被拒', async () => {
    const wrapper = mountField()

    await textBox(wrapper).setValue('@import "x.css"')

    expect(lastWrite(wrapper)).toBe('')
  })

  it('反斜杠与控制字符被拒', async () => {
    const wrapper = mountField({ fallback: 'currentColor' })

    await textBox(wrapper).setValue('re\\64 ')

    expect(lastWrite(wrapper)).toBe('currentColor')
  })

  it('超长取值被拒', async () => {
    const wrapper = mountField({ fallback: 'currentColor' })

    await textBox(wrapper).setValue(`var(--${'a'.repeat(220)})`)

    expect(lastWrite(wrapper)).toBe('currentColor')
  })
})

describe('合法取值', () => {
  it('函数写法原样写回，框里的空格留得住', async () => {
    const wrapper = mountField()

    await textBox(wrapper).setValue('rgb(0, 255, 0) ')

    expect(lastWrite(wrapper)).toBe('rgb(0, 255, 0)')
    expect(textBox(wrapper).element.value).toBe('rgb(0, 255, 0) ')
  })

  it('语义 token 原样写回', async () => {
    const wrapper = mountField()

    await textBox(wrapper).setValue('var(--accent-primary)')

    expect(lastWrite(wrapper)).toBe('var(--accent-primary)')
  })

  // ⚠ 空是有意义的一档（跟随上层取色），缺省给空串时清得掉
  it('缺省是空串时清得空', async () => {
    const wrapper = mountField({ modelValue: 'red' })

    await textBox(wrapper).setValue('')

    expect(lastWrite(wrapper)).toBe('')
  })

  it('缺省非空时清空落回缺省', async () => {
    const wrapper = mountField({ modelValue: 'red', fallback: 'currentColor' })

    await textBox(wrapper).setValue('')

    expect(lastWrite(wrapper)).toBe('currentColor')
  })
})

describe('取色块与色板', () => {
  it('取色器解析不出取值时喂给它的是黑而不是主题色', () => {
    const wrapper = mountField({ modelValue: 'var(--accent-primary)' })

    expect(wrapper.find('input[type="color"]').exists()).toBe(true)
  })

  it('色板缺省摆出七色加一个跟随换肤的强调色', () => {
    const wrapper = mountField()

    expect(wrapper.findAll('.dt-color__preset')).toHaveLength(8)
  })

  it('自带色板时只摆自带的那几格', () => {
    const wrapper = mount(ColorField, {
      props: { modelValue: '', swatches: ['red', 'blue'] },
    })

    expect(wrapper.findAll('.dt-color__preset')).toHaveLength(2)
  })
})

describe('合并撤销的出口', () => {
  // ⚠ 检查器靠它调 endMerge：没有这个出口，连续输入会一路并进同一帧，
  // 换个目标继续敲还是那一帧，撤销一次能把两处编辑一起撤掉
  it('焦点离开时抛 blur', async () => {
    const wrapper = mountField()

    await wrapper.find('.dt-t2-color').trigger('focusin')
    await wrapper.find('.dt-t2-color').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })

  // ⚠ 敲字期间父组件必然在回写消毒后的值，拿它去盖框里的原文会把刚敲的空格吃掉
  it('焦点还在框里时外部换值不盖掉正敲的那半截', async () => {
    const wrapper = mountField({ modelValue: '' })

    await wrapper.find('.dt-t2-color').trigger('focusin')
    await textBox(wrapper).setValue('rgb(0, 255, 0) ')
    await wrapper.setProps({ modelValue: 'rgb(0, 255, 0)' })

    expect(textBox(wrapper).element.value).toBe('rgb(0, 255, 0) ')
  })

  it('外部换值时框跟着换', async () => {
    const wrapper = mountField({ modelValue: 'red' })

    await wrapper.setProps({ modelValue: 'blue' })

    expect(textBox(wrapper).element.value).toBe('blue')
  })
})
