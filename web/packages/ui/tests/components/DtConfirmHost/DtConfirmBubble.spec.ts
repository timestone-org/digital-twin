/** @fileoverview 锚定确认气泡的定位、取消、确认与焦点归还契约。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import DtConfirmHost from '../../../src/components/DtConfirmHost/DtConfirmHost.vue'
import { useConfirm } from '../../../src/composables/useConfirm'

const cleanups: Array<() => void> = []
function setup() {
  const button = document.createElement('button')
  button.textContent = '关闭全部页签'
  document.body.append(button)
  button.focus()
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(500, 40, 24, 24),
  )
  const wrapper = mount(DtConfirmHost, { attachTo: document.body })
  cleanups.push(() => wrapper.unmount())
  const confirm = useConfirm()
  const answer = confirm.ask(
    { title: '关闭全部页签', message: '返回工作台', confirmText: '关闭全部' },
    button,
  )
  return { button, answer, confirm }
}
function panel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]')
  if (found === null) throw new Error('没有确认气泡')
  return found
}
function choose(label: string): void {
  const button = [...panel().querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  )
  if (button === undefined) throw new Error(`没有按钮 ${label}`)
  button.click()
}
afterEach(() => {
  useConfirm().resolve(false)
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('确认气泡', () => {
  it('在按钮下方展示，没有遮罩且默认聚焦取消', async () => {
    const { answer, confirm } = setup()
    await flushPromises()
    expect(panel().style.position).toBe('fixed')
    expect(panel().style.top).toBe('72px')
    expect(panel().textContent).toContain('返回工作台')
    expect(document.querySelector('.dt-modal__backdrop')).toBeNull()
    expect(document.activeElement?.textContent).toBe('取消')
    confirm.resolve(false)
    await expect(answer).resolves.toBe(false)
  })
  it.each(['取消', '关闭全部'])('%s 后结算并归还焦点', async (label) => {
    const { answer, button, confirm } = setup()
    await flushPromises()
    choose(label)
    await expect(answer).resolves.toBe(label === '关闭全部')
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(confirm.anchor.value).toBeNull()
  })
  it('Esc 取消且不传给后台编辑器', async () => {
    const { answer } = setup()
    await flushPromises()
    const editor = vi.fn()
    window.addEventListener('keydown', editor)
    panel().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )
    await expect(answer).resolves.toBe(false)
    expect(editor).not.toHaveBeenCalled()
    window.removeEventListener('keydown', editor)
  })
  it('点气泡外部取消', async () => {
    const { answer } = setup()
    await flushPromises()
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    )
    await expect(answer).resolves.toBe(false)
  })
  it('气泡内的删除键不会作用于后台编辑器', async () => {
    const { answer, confirm } = setup()
    await flushPromises()
    const editor = vi.fn()
    window.addEventListener('keydown', editor)
    panel().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    )
    expect(editor).not.toHaveBeenCalled()
    window.removeEventListener('keydown', editor)
    confirm.resolve(false)
    await expect(answer).resolves.toBe(false)
  })
  it('没有锚点的既有确认仍正常显示', async () => {
    const { answer, confirm } = setup()
    const second = confirm.ask({ message: '独立确认' })
    await expect(answer).resolves.toBe(false)
    await flushPromises()
    expect(document.querySelector('.dt-confirm-bubble')).toBeNull()
    expect(document.querySelector('.dt-modal__backdrop')).not.toBeNull()
    choose('取消')
    await expect(second).resolves.toBe(false)
  })
  it('触发按钮已经离开文档时直接取消', async () => {
    const { button, answer } = setup()
    button.remove()
    await flushPromises()
    await expect(answer).resolves.toBe(false)
    expect(document.querySelector('.dt-confirm-bubble')).toBeNull()
  })
})
