/**
 * @fileoverview 契约：弹窗怎么关得掉，以及**填了一半时怎么关不掉**。
 *
 * ⚠ 误关一次就是十几个字段全没了。点弹窗外面纯属误触，一律不关；Esc 可能只是
 * 习惯性动作，所以第一次只提示、再按一次才真的丢。「关闭」按钮不在此列——
 * 那是瞄准了才点得中的目标。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import DtModal from '../../src/components/DtModal/DtModal.vue'

function mountModal(dirty = false) {
  return mount(DtModal, {
    props: { modelValue: true, title: '编辑数据源', dirty },
    attachTo: document.body,
  })
}

function backdrop(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('.dt-modal__backdrop')
  if (found === null) throw new Error('弹窗没有遮罩')
  return found
}

function pressEscape(): void {
  document.body
    .querySelector('.dt-modal')
    ?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
}

function closedTimes(wrapper: ReturnType<typeof mountModal>): number {
  return (wrapper.emitted('update:modelValue') ?? []).length
}

describe('干净的弹窗', () => {
  it('点外面就关', () => {
    const wrapper = mountModal()

    backdrop().click()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('按 Esc 就关', () => {
    const wrapper = mountModal()

    pressEscape()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    wrapper.unmount()
  })
})

describe('填了一半的弹窗', () => {
  it('点外面不关，只提示——这条路径没有一次是故意的', async () => {
    const wrapper = mountModal(true)

    backdrop().click()
    await nextTick()

    expect(closedTimes(wrapper)).toBe(0)
    expect(document.body.textContent).toContain('有还没提交的内容')
    wrapper.unmount()
  })

  it('点第二次、第三次照样不关', async () => {
    const wrapper = mountModal(true)

    backdrop().click()
    backdrop().click()
    backdrop().click()
    await nextTick()

    expect(closedTimes(wrapper)).toBe(0)
    wrapper.unmount()
  })

  it('第一次 Esc 只提示', async () => {
    const wrapper = mountModal(true)

    pressEscape()
    await nextTick()

    expect(closedTimes(wrapper)).toBe(0)
    expect(document.body.textContent).toContain('再按一次 Esc')
    wrapper.unmount()
  })

  it('提示挂着之后再按一次 Esc 才真的关', async () => {
    const wrapper = mountModal(true)

    pressEscape()
    await nextTick()
    pressEscape()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('「关闭」按钮照常一下就关：那是瞄准了才点得中的目标', () => {
    const wrapper = mountModal(true)

    document.body
      .querySelector<HTMLButtonElement>('[aria-label="关闭"]')
      ?.click()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('重开一次要重新拦一次，不许把上一次的「再按就丢」带过来', async () => {
    const wrapper = mountModal(true)
    pressEscape()
    await nextTick()

    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    pressEscape()
    await nextTick()

    // 关一次是上面 setProps 自己造的，这里只看 Esc 有没有再关一次
    expect(closedTimes(wrapper)).toBe(0)
    expect(document.body.textContent).toContain('有还没提交的内容')
    wrapper.unmount()
  })
})
