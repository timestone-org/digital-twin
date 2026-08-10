/**
 * @fileoverview 二次确认的契约：await 一定会结，且除「确定」外全判否。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { useConfirm } from '../../src/composables/useConfirm'

afterEach(() => {
  useConfirm().resolve(false)
})

describe('useConfirm', () => {
  it('ask 之后有待确认项，带上调用方给的文案', () => {
    const confirm = useConfirm()
    void confirm.ask({ message: '将删除账号', title: '删除用户', danger: true })
    expect(confirm.pending.value?.message).toBe('将删除账号')
    expect(confirm.pending.value?.title).toBe('删除用户')
    expect(confirm.pending.value?.danger).toBe(true)
  })

  it('确定 → true', async () => {
    const confirm = useConfirm()
    const answer = confirm.ask({ message: '删？' })
    confirm.resolve(true)
    await expect(answer).resolves.toBe(true)
  })

  it('取消 → false', async () => {
    const confirm = useConfirm()
    const answer = confirm.ask({ message: '删？' })
    confirm.resolve(false)
    await expect(answer).resolves.toBe(false)
  })

  it('结掉之后清空待确认项', async () => {
    const confirm = useConfirm()
    const answer = confirm.ask({ message: '删？' })
    confirm.resolve(true)
    await answer
    expect(confirm.pending.value).toBeNull()
  })

  it('前一个还没结就再问，前一个判取消——不然它的 await 永远挂着', async () => {
    const confirm = useConfirm()
    const first = confirm.ask({ message: '第一个' })
    const second = confirm.ask({ message: '第二个' })
    await expect(first).resolves.toBe(false)
    expect(confirm.pending.value?.message).toBe('第二个')
    confirm.resolve(true)
    await expect(second).resolves.toBe(true)
  })

  it('没有待确认项时 resolve 不炸', () => {
    expect(() => {
      useConfirm().resolve(true)
    }).not.toThrow()
  })
})
