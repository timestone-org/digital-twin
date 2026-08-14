/**
 * @fileoverview 快捷键让位判定：原生表单、contenteditable、combobox 触发器与
 * 弹窗内的一切都要独占键盘；普通按钮不让位。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { isFormFocused } from '@/pages/DashboardEditor/isFormFocused'

/** 造一个带属性的元素；属性名与值就是判定要看的那几个。 */
function el(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value)
  }
  return node
}

/** 把 host 换成 body 的全部内容，再让 target 获焦；host 缺省就是 target 自己。 */
function mountAndFocus(target: HTMLElement, host: HTMLElement = target): void {
  document.body.replaceChildren(host)
  target.focus()
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('让位', () => {
  it('input 与 textarea 让位', () => {
    mountAndFocus(el('input'))
    expect(isFormFocused()).toBe(true)
    mountAndFocus(el('textarea'))
    expect(isFormFocused()).toBe(true)
  })

  it('contenteditable 让位，显式 false 不让', () => {
    mountAndFocus(el('div', { contenteditable: '', tabindex: '0' }))
    expect(isFormFocused()).toBe(true)
    mountAndFocus(el('div', { contenteditable: 'false', tabindex: '0' }))
    expect(isFormFocused()).toBe(false)
  })

  it('combobox 触发器按钮让位——它的方向键不吞冒泡', () => {
    mountAndFocus(el('button', { role: 'combobox' }))
    expect(isFormFocused()).toBe(true)
  })

  it('弹窗里的普通按钮也让位', () => {
    const dialog = el('div', { role: 'dialog' })
    const button = el('button')
    dialog.append(button)
    mountAndFocus(button, dialog)
    expect(isFormFocused()).toBe(true)
  })

  it('画布区的普通按钮不让位', () => {
    mountAndFocus(el('button'))
    expect(isFormFocused()).toBe(false)
  })

  it('没有焦点时不让位', () => {
    const paragraph = el('p')
    paragraph.textContent = '无'
    document.body.replaceChildren(paragraph)
    expect(isFormFocused()).toBe(false)
  })
})
