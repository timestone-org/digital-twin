/**
 * @fileoverview 契约：弹窗怎么关得掉，以及**填了一半时怎么关不掉**。
 *
 * ⚠ 误关一次就是十几个字段全没了。点弹窗外面纯属误触，一律不关；Esc 可能只是
 * 习惯性动作，所以第一次只提示、再按一次才真的丢。「关闭」按钮不在此列——
 * 那是瞄准了才点得中的目标。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'

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

it('缓存页停用时隐藏弹窗，再次激活保留输入内容', async () => {
  const visible = ref(true)
  const page = defineComponent({
    setup: () => () =>
      h(
        DtModal,
        {
          modelValue: true,
          title: '编辑数据源',
        },
        () => h('input', { value: '未保存的输入' }),
      ),
  })
  const host = defineComponent({
    setup: () => () => h(KeepAlive, () => (visible.value ? h(page) : null)),
  })
  const wrapper = mount(host, { attachTo: document.body })
  visible.value = false
  await nextTick()
  expect(document.querySelector<HTMLElement>('.dt-modal')?.style.display).toBe(
    'none',
  )
  visible.value = true
  await nextTick()
  expect(
    document.querySelector<HTMLElement>('.dt-modal')?.style.display,
  ).not.toBe('none')
  expect(
    document.querySelector<HTMLInputElement>('.dt-modal input')?.value,
  ).toBe('未保存的输入')
  wrapper.unmount()
})

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

describe('以打开态挂载的弹窗', () => {
  function mountOpenFrom(trigger: HTMLElement) {
    trigger.focus()
    return mount(DtModal, {
      props: { modelValue: true, title: '批量编辑' },
      slots: { default: '<input class="field" />' },
      attachTo: document.body,
    })
  }

  function backgroundButton(): HTMLButtonElement {
    const button = document.createElement('button')
    document.body.appendChild(button)
    return button
  }

  it('焦点进入弹窗，键盘事件才落得到 Esc 与焦点陷阱上', async () => {
    const button = backgroundButton()
    const wrapper = mountOpenFrom(button)
    await nextTick()
    const panel = document.body.querySelector('.dt-modal__panel')
    expect(panel?.contains(document.activeElement)).toBe(true)
    wrapper.unmount()
    button.remove()
  })

  it('由父级卸载时焦点归还给打开前的元素', async () => {
    const button = backgroundButton()
    const wrapper = mountOpenFrom(button)
    await nextTick()
    wrapper.unmount()
    expect(document.activeElement).toBe(button)
    button.remove()
  })
})

describe('出现与离开的动效', () => {
  // ⚠ VTU 默认把 Transition 桩掉，不关掉的话这里断言的类名永远不存在
  const realTransition = { stubs: { transition: false } }

  // 离场中的节点在卸载后还会留一帧，不清掉下一条用例会查到它
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function root(): HTMLElement {
    const found = document.body.querySelector<HTMLElement>('.dt-modal')
    if (found === null) throw new Error('弹窗不在页面上')
    return found
  }

  it('挂载时就开着的弹窗也播入场，否则 v-if 包着的弹窗全部直出', () => {
    const wrapper = mount(DtModal, {
      props: { modelValue: true, title: '编辑' },
      attachTo: document.body,
      global: realTransition,
    })
    expect(root().classList).toContain('dt-modal-enter-active')
    wrapper.unmount()
  })

  it('关闭时走离场，而不是立刻摘掉节点', async () => {
    const wrapper = mount(DtModal, {
      props: { modelValue: true, title: '编辑' },
      attachTo: document.body,
      global: realTransition,
    })
    await wrapper.setProps({ modelValue: false })
    expect(root().classList).toContain('dt-modal-leave-active')
    wrapper.unmount()
  })

  it('页面被 KeepAlive 收起时不播离场，弹窗不许留在下一个页面上', async () => {
    const visible = ref(true)
    const page = defineComponent({
      setup: () => () => h(DtModal, { modelValue: true, title: '编辑' }),
    })
    const host = defineComponent({
      setup: () => () => h(KeepAlive, () => (visible.value ? h(page) : null)),
    })
    const wrapper = mount(host, {
      attachTo: document.body,
      global: realTransition,
    })
    visible.value = false
    await nextTick()
    expect(root().classList).not.toContain('dt-modal-leave-active')
    expect(root().style.display).toBe('none')
    wrapper.unmount()
  })
})
