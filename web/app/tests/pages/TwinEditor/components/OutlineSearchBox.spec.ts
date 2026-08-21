/**
 * @fileoverview 搜索框组件的契约：输入即回写 v-model、「×」只在有词时出现、
 * 框内 Esc 清词并拦下冒泡（页面还挂着自己的 Esc，清词不该连带触发它）。
 */
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import OutlineSearchBox from '@/pages/TwinEditor/components/OutlineSearchBox.vue'

function render(modelValue = '') {
  return mount(OutlineSearchBox, { props: { modelValue } })
}

describe('输入', () => {
  it('敲字回写 v-model', async () => {
    const wrapper = render()

    await wrapper.get('input').setValue('温度')

    expect(wrapper.emitted('update:modelValue')).toEqual([['温度']])
  })

  it('有词时给「×」，点了清空', async () => {
    const wrapper = render('温度')

    await wrapper.get('[data-test="outline-search-clear"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  it('空词时不画「×」', () => {
    expect(render().find('[data-test="outline-search-clear"]').exists()).toBe(
      false,
    )
  })
})

describe('框内 Esc', () => {
  /** 外层挂一只 keydown 探针，量 Esc 有没有冒出搜索框。 */
  function renderWithProbe(modelValue: string) {
    const probe = vi.fn()
    const host = defineComponent({
      setup() {
        const query = ref(modelValue)
        return () =>
          h('div', { onKeydown: probe }, [
            h(OutlineSearchBox, {
              modelValue: query.value,
              'onUpdate:modelValue': (next: string) => {
                query.value = next
              },
            }),
          ])
      },
    })
    return { wrapper: mount(host), probe }
  }

  it('有词时 Esc 清词，且不冒泡到页面', async () => {
    const { wrapper, probe } = renderWithProbe('温度')

    await wrapper.get('input').trigger('keydown', { key: 'Escape' })

    expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('')
    expect(probe).not.toHaveBeenCalled()
  })

  it('空词时 Esc 原样放行给页面', async () => {
    const { wrapper, probe } = renderWithProbe('')

    await wrapper.get('input').trigger('keydown', { key: 'Escape' })

    expect(probe).toHaveBeenCalled()
  })

  it('别的键不清词也照常冒泡', async () => {
    const { wrapper, probe } = renderWithProbe('温度')

    await wrapper.get('input').trigger('keydown', { key: 'a' })

    expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('温度')
    expect(probe).toHaveBeenCalled()
  })
})
