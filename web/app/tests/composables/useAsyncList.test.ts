/**
 * @fileoverview 列表取数状态机的契约：三态、分页、以及**乱序返回时丢弃旧结果**。
 * ⚠ 竞态那条是测试规范 §3.6 的强制项：没有它，删掉序号判断也没人发现，
 * 而线上表现是「快速切筛选后看到过期数据且没有任何报错」。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Page } from '@dt/contracts'

import { TransportError } from '@/api/client'
import { useAsyncList } from '@/composables/useAsyncList'

function page<T>(items: T[], total = items.length): Page<T> {
  return { items, page: 1, size: 20, total }
}

/** 手动控制何时 resolve，用来编排乱序返回。 */
function deferred<T>() {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    settle = done
  })
  return { promise, settle }
}

describe('useAsyncList 取数三态', () => {
  it('成功后填数据并清掉错误', async () => {
    const list = useAsyncList(() => Promise.resolve(page(['a'], 7)))
    await list.reload()
    expect(list.items.value).toEqual(['a'])
    expect(list.total.value).toBe(7)
    expect(list.error.value).toBeNull()
    expect(list.loading.value).toBe(false)
  })

  it('失败时给可读原因，并把上一批数据清掉', async () => {
    const list = useAsyncList(() => Promise.resolve(page(['a'])))
    await list.reload()
    const failing = useAsyncList(() =>
      Promise.reject(new TransportError(0, '无法连接服务器')),
    )
    await failing.reload()
    expect(failing.error.value).toBe('无法连接服务器')
    expect(failing.items.value).toEqual([])
    expect(failing.total.value).toBe(0)
  })

  it('未知异常也归一成一句人话，而不是抛出去', async () => {
    const list = useAsyncList(() => Promise.reject(new Error('boom')))
    await list.reload()
    expect(list.error.value).toBe('请求失败，请重试')
  })
})

describe('useAsyncList 竞态', () => {
  it('慢的那次先发、后返回时，结果被丢弃', async () => {
    const slow = deferred<Page<string>>()
    const fast = deferred<Page<string>>()
    const queue = [slow, fast]
    let index = 0
    const list = useAsyncList(() => {
      const current = queue[index]
      index += 1
      return current?.promise ?? Promise.resolve(page([]))
    })

    const first = list.reload()
    const second = list.reload()
    // 后发的先回
    fast.settle(page(['新']))
    await second
    // 先发的后回：必须被丢掉，否则界面显示过期数据且没有任何报错
    slow.settle(page(['旧']))
    await first

    expect(list.items.value).toEqual(['新'])
  })

  it('被丢弃的那次失败不会覆盖已经成功的结果', async () => {
    const slow = deferred<Page<string>>()
    const fast = deferred<Page<string>>()
    const queue = [slow, fast]
    let index = 0
    const list = useAsyncList(() => {
      const current = queue[index]
      index += 1
      return current?.promise ?? Promise.resolve(page([]))
    })

    const first = list.reload()
    const second = list.reload()
    fast.settle(page(['新']))
    await second
    slow.settle(Promise.reject(new TransportError(0, '超时')) as never)
    await first.catch(() => undefined)

    expect(list.items.value).toEqual(['新'])
    expect(list.error.value).toBeNull()
  })

  it('被丢弃的那次不会把 loading 关掉', async () => {
    const slow = deferred<Page<string>>()
    const pending = deferred<Page<string>>()
    const queue = [slow, pending]
    let index = 0
    const list = useAsyncList(() => {
      const current = queue[index]
      index += 1
      return current?.promise ?? Promise.resolve(page([]))
    })

    const first = list.reload()
    void list.reload()
    slow.settle(page(['旧']))
    await first
    // 第二次还在飞，加载态必须还亮着
    expect(list.loading.value).toBe(true)
    pending.settle(page(['新']))
  })
})

describe('useAsyncList 分页', () => {
  it('把当前页码与页大小喂给取数函数', async () => {
    const fetcher = vi.fn(() => Promise.resolve(page<string>([], 0)))
    const list = useAsyncList(fetcher, 50)
    await list.reload()
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 50 })
  })

  it('翻页后按新页码取数', async () => {
    const fetcher = vi.fn(() => Promise.resolve(page<string>([], 0)))
    const list = useAsyncList(fetcher)
    await list.goToPage(3)
    expect(fetcher).toHaveBeenLastCalledWith({ page: 3, size: 20 })
  })

  it('翻到当前页不重复取数', async () => {
    const fetcher = vi.fn(() => Promise.resolve(page<string>([], 0)))
    const list = useAsyncList(fetcher)
    await list.reload()
    await list.goToPage(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('改每页条数时回到第一页——不回就直接落到空页', async () => {
    const fetcher = vi.fn(() => Promise.resolve(page<string>([], 0)))
    const list = useAsyncList(fetcher, 10)
    await list.goToPage(9)
    await list.setSize(100)
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 100 })
  })

  it('改筛选条件也回第一页', async () => {
    const fetcher = vi.fn(() => Promise.resolve(page<string>([], 0)))
    const list = useAsyncList(fetcher)
    await list.goToPage(4)
    await list.reloadFromFirstPage()
    expect(fetcher).toHaveBeenLastCalledWith({ page: 1, size: 20 })
  })

  it('pager 直接可以喂给 DtDataView', async () => {
    const list = useAsyncList(() => Promise.resolve(page(['a'], 42)), 20)
    await list.reload()
    expect(list.pager.value).toEqual({ page: 1, size: 20, total: 42 })
  })
})
