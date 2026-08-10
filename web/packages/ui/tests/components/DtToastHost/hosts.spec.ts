/**
 * @fileoverview 两个反馈宿主的渲染契约：live region 的角色、关闭按钮、
 * 确认框的每条关闭路径都要把 await 结掉。
 */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import DtConfirmHost from '../../../src/components/DtConfirmHost/DtConfirmHost.vue'
import DtToastHost from '../../../src/components/DtToastHost/DtToastHost.vue'
import { useConfirm } from '../../../src/composables/useConfirm'
import { useToast } from '../../../src/composables/useToast'

enableAutoUnmount(afterEach)

afterEach(() => {
  useToast().clear()
  useConfirm().resolve(false)
})

describe('DtToastHost', () => {
  it('容器是 polite live region，且只播报新增的那条', () => {
    mount(DtToastHost)
    const host = document.querySelector('.dt-toasts')
    expect(host?.getAttribute('aria-live')).toBe('polite')
    expect(host?.getAttribute('aria-atomic')).toBe('false')
  })

  it('渲染队列里的消息', async () => {
    const wrapper = mount(DtToastHost)
    useToast().success('已保存', { title: '用户管理' })
    await flushPromises()
    expect(document.body.textContent).toContain('已保存')
    expect(document.body.textContent).toContain('用户管理')
    void wrapper
  })

  it('失败与警告用 alert 打断朗读，成功不打断', async () => {
    mount(DtToastHost)
    const toast = useToast()
    toast.error('炸了')
    toast.success('好了')
    await flushPromises()
    const roles = [...document.querySelectorAll('.dt-toast')].map((node) =>
      node.getAttribute('role'),
    )
    expect(roles).toEqual(['alert', null])
  })

  it('关闭按钮把那条移出队列', async () => {
    mount(DtToastHost)
    useToast().info('甲', { duration: 0 })
    await flushPromises()
    document
      .querySelector<HTMLButtonElement>('[aria-label="关闭消息"]')
      ?.click()
    await flushPromises()
    expect(useToast().toasts.value).toHaveLength(0)
  })
})

describe('DtConfirmHost', () => {
  /**
   * ⚠ 刻意不是 async：`await open()` 会把里面那个 Promise 直接解开，
   * 而它要等到点击才结，整条用例就挂到超时。
   */
  function open(): Promise<boolean> {
    mount(DtConfirmHost)
    return useConfirm().ask({
      title: '删除用户',
      message: '不可恢复',
      confirmText: '删除',
      danger: true,
    })
  }

  function click(text: string): void {
    const button = [...document.querySelectorAll('button')].find((node) =>
      node.textContent?.includes(text),
    )
    button?.click()
  }

  it('没有待确认项时不渲染任何东西', () => {
    mount(DtConfirmHost)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('渲染标题与说明', async () => {
    const answer = open()
    await flushPromises()
    expect(document.body.textContent).toContain('删除用户')
    expect(document.body.textContent).toContain('不可恢复')
    click('取消')
    await answer
  })

  it('点确定 resolve 为 true', async () => {
    const answer = open()
    await flushPromises()
    click('删除')
    await expect(answer).resolves.toBe(true)
  })

  it('点取消 resolve 为 false', async () => {
    const answer = open()
    await flushPromises()
    click('取消')
    await expect(answer).resolves.toBe(false)
  })

  it('Esc 关闭也要 resolve，否则调用方永远挂着', async () => {
    const answer = open()
    await flushPromises()
    // DtModal 的 Esc 挂在弹窗根节点上，事件不会从 document 往下传
    document
      .querySelector('.dt-modal')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    await expect(answer).resolves.toBe(false)
  })

  it('点遮罩关闭同样 resolve', async () => {
    const answer = open()
    await flushPromises()
    document
      .querySelector<HTMLElement>('.dt-modal__backdrop')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await expect(answer).resolves.toBe(false)
  })

  it('确认文案与取消文案可定制，缺省是「确定 / 取消」', async () => {
    mount(DtConfirmHost)
    const answer = useConfirm().ask({ message: '继续？' })
    await flushPromises()
    expect(document.body.textContent).toContain('确定')
    expect(document.body.textContent).toContain('取消')
    click('取消')
    await answer
  })
})
