/**
 * @fileoverview DtTextarea 的受控、计数与 autosize 契约。
 * ⚠ autosize 必须先把高度置回 auto 再读 scrollHeight，否则内容变短时收不回去——
 * 这条只有在「删掉几行字」时才看得出来，正向输入一路正常。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtTextarea from '../../src/components/DtTextarea/DtTextarea.vue'

/** happy-dom 不做排版，scrollHeight 恒为 0，autosize 只能靠桩喂高度。 */
function stubScrollHeight(node: HTMLTextAreaElement, height: number): void {
  Object.defineProperty(node, 'scrollHeight', {
    configurable: true,
    get: () => height,
  })
}

/** 挂载期的 resize 赶在拿到元素之前，只能从原型上喂；返回还原函数。 */
function stubPrototypeScrollHeight(height: number): () => void {
  const owner = HTMLElement.prototype
  const original = Object.getOwnPropertyDescriptor(owner, 'scrollHeight')
  Object.defineProperty(owner, 'scrollHeight', {
    configurable: true,
    get: () => height,
  })
  return () => {
    if (original === undefined) Reflect.deleteProperty(owner, 'scrollHeight')
    else Object.defineProperty(owner, 'scrollHeight', original)
  }
}

describe('DtTextarea 取值', () => {
  it('渲染受控值', () => {
    const wrapper = mount(DtTextarea, { props: { modelValue: 'abc' } })
    expect(wrapper.find('textarea').element.value).toBe('abc')
  })

  it('输入时 emit update:modelValue', async () => {
    const wrapper = mount(DtTextarea)
    await wrapper.find('textarea').setValue('x')
    expect(wrapper.emitted('update:modelValue')).toEqual([['x']])
  })

  it('IME 组合期间不 emit，组合结束才 emit 最终值', async () => {
    const wrapper = mount(DtTextarea)
    const textarea = wrapper.find('textarea')
    await textarea.trigger('compositionstart')
    await textarea.setValue('ni')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await textarea.trigger('compositionend')
    expect(wrapper.emitted('update:modelValue')).toEqual([['ni']])
  })

  it('缺省值是空串，不是 undefined', () => {
    const wrapper = mount(DtTextarea)
    expect(wrapper.find('textarea').element.value).toBe('')
  })
})

describe('DtTextarea 字数', () => {
  it('给了 maxlength 才显示剩余字数', () => {
    const wrapper = mount(DtTextarea, {
      props: { modelValue: 'abc', maxlength: 10 },
    })
    expect(wrapper.find('.dt-textarea__count').text()).toBe('7')
  })

  it('没给 maxlength 时不显示计数', () => {
    const wrapper = mount(DtTextarea, { props: { modelValue: 'abc' } })
    expect(wrapper.find('.dt-textarea__count').exists()).toBe(false)
  })

  it('内容超过上限时截到 0，不露负数', () => {
    const wrapper = mount(DtTextarea, {
      props: { modelValue: 'abcdef', maxlength: 3 },
    })
    expect(wrapper.find('.dt-textarea__count').text()).toBe('0')
  })

  it('非有限的 maxlength 不显示计数', () => {
    const wrapper = mount(DtTextarea, {
      props: { modelValue: 'abc', maxlength: Number.NaN },
    })
    expect(wrapper.find('.dt-textarea__count').exists()).toBe(false)
  })

  it('计数对读屏隐藏，避免与 live 区读两遍', () => {
    const wrapper = mount(DtTextarea, { props: { maxlength: 10 } })
    expect(wrapper.find('.dt-textarea__count').attributes('aria-hidden')).toBe(
      'true',
    )
  })

  it('逼近上限时才播报剩余字数', () => {
    const wrapper = mount(DtTextarea, {
      props: { modelValue: 'abc', maxlength: 10 },
    })
    expect(wrapper.find('.dt-textarea__live').text()).toBe('还剩 7 个字符')
  })

  it('离上限还远时 live 区留空，不每敲一下就朗读', () => {
    const wrapper = mount(DtTextarea, {
      props: { modelValue: '', maxlength: 500 },
    })
    expect(wrapper.find('.dt-textarea__live').text()).toBe('')
  })

  it('maxlength 透到原生属性，由浏览器兜住硬上限', () => {
    const wrapper = mount(DtTextarea, { props: { maxlength: 10 } })
    expect(wrapper.find('textarea').attributes('maxlength')).toBe('10')
  })
})

describe('DtTextarea autosize', () => {
  it('挂载即按内容高度撑开', () => {
    const restore = stubPrototypeScrollHeight(88)
    try {
      const wrapper = mount(DtTextarea, {
        props: { autosize: true, modelValue: 'a' },
      })
      expect(wrapper.find('textarea').element.style.height).toBe('88px')
      wrapper.unmount()
    } finally {
      restore()
    }
  })

  it('内容变短时先置 auto 再量，能收回去', async () => {
    const wrapper = mount(DtTextarea, {
      props: { autosize: true, modelValue: 'aaa' },
      attachTo: document.body,
    })
    const node = wrapper.find('textarea').element
    stubScrollHeight(node, 120)
    await wrapper.setProps({ modelValue: 'aaaa' })
    expect(node.style.height).toBe('120px')
    stubScrollHeight(node, 40)
    await wrapper.setProps({ modelValue: 'a' })
    expect(node.style.height).toBe('40px')
    wrapper.unmount()
  })

  it('关掉 autosize 会清掉行内高度，让 rows 重新说了算', async () => {
    const wrapper = mount(DtTextarea, {
      props: { autosize: true, modelValue: 'a' },
      attachTo: document.body,
    })
    const node = wrapper.find('textarea').element
    stubScrollHeight(node, 120)
    await wrapper.setProps({ modelValue: 'ab' })
    expect(node.style.height).toBe('120px')
    await wrapper.setProps({ autosize: false })
    expect(node.style.height).toBe('')
    wrapper.unmount()
  })

  it('键入时立刻重量高度，不等父组件回写', async () => {
    const wrapper = mount(DtTextarea, {
      props: { autosize: true },
      attachTo: document.body,
    })
    const textarea = wrapper.find('textarea')
    stubScrollHeight(textarea.element, 72)
    await textarea.setValue('多行\n文本')
    expect(textarea.element.style.height).toBe('72px')
    wrapper.unmount()
  })

  it('中途打开 autosize 会立刻按内容量一次高度', async () => {
    const wrapper = mount(DtTextarea, {
      props: { modelValue: 'a' },
      attachTo: document.body,
    })
    const node = wrapper.find('textarea').element
    stubScrollHeight(node, 64)
    await wrapper.setProps({ autosize: true })
    expect(node.style.height).toBe('64px')
    wrapper.unmount()
  })

  it('不开 autosize 时不碰高度', async () => {
    const wrapper = mount(DtTextarea, { attachTo: document.body })
    const node = wrapper.find('textarea').element
    stubScrollHeight(node, 120)
    await wrapper.setProps({ modelValue: 'a' })
    expect(node.style.height).toBe('')
    wrapper.unmount()
  })

  it('开着 autosize 时加修饰类，去掉手动拖拽把手', () => {
    const wrapper = mount(DtTextarea, { props: { autosize: true } })
    expect(wrapper.find('.dt-textarea').classes()).toContain(
      'dt-textarea--autosize',
    )
  })
})

describe('DtTextarea 外壳', () => {
  it('label 与文本域通过 id 关联', () => {
    const wrapper = mount(DtTextarea, { props: { label: '备注' } })
    const id = wrapper.find('textarea').attributes('id')
    expect(wrapper.find('label').attributes('for')).toBe(id)
  })

  it('hint 经 aria-describedby 关联', () => {
    const wrapper = mount(DtTextarea, { props: { hint: '选填' } })
    const described = wrapper.find('textarea').attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).text()).toBe('选填')
  })

  it('error 时标 aria-invalid 并用 role=alert 播报', () => {
    const wrapper = mount(DtTextarea, { props: { error: '不能为空' } })
    expect(wrapper.find('textarea').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[role="alert"]').text()).toBe('不能为空')
  })

  it('disabled 时禁用且加修饰类', () => {
    const wrapper = mount(DtTextarea, { props: { disabled: true } })
    expect(wrapper.find('textarea').attributes('disabled')).toBe('')
    expect(wrapper.find('.dt-textarea').classes()).toContain(
      'dt-textarea--disabled',
    )
  })

  it('required 透到原生属性并标星', () => {
    const wrapper = mount(DtTextarea, {
      props: { label: '备注', required: true },
    })
    expect(wrapper.find('textarea').attributes('required')).toBeDefined()
    expect(wrapper.find('.dt-field__required').exists()).toBe(true)
  })

  it('rows / placeholder / readonly 经 $attrs 透传', () => {
    const wrapper = mount(DtTextarea, {
      attrs: { rows: 6, placeholder: '请输入', readonly: true },
    })
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('rows')).toBe('6')
    expect(textarea.attributes('placeholder')).toBe('请输入')
    expect(textarea.attributes('readonly')).toBeDefined()
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mount(DtTextarea, { props: { size } })
    expect(wrapper.find('.dt-textarea').classes()).toContain(
      `dt-textarea--${size}`,
    )
  })

  it('mono 时加修饰类，供等宽字体对齐缩进', () => {
    const wrapper = mount(DtTextarea, { props: { mono: true } })
    expect(wrapper.find('.dt-textarea').classes()).toContain(
      'dt-textarea--mono',
    )
  })
})
