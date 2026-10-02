/** @fileoverview 来源动作的取消、竞态、错误和实际同步计数。 */
import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/api/knowledge'
import type { KnowledgeSource } from '@/api/knowledge'
import { useKnowledgeSources } from '@/pages/Knowledge/scripts/useKnowledgeSources'

const confirm = vi.hoisted(() => vi.fn())
vi.mock('@dt/ui', async () => ({
  ...(await vi.importActual('@dt/ui')),
  useConfirm: () => ({ ask: confirm }),
}))
const SOURCE: KnowledgeSource = {
  id: 's1',
  baseId: 'b1',
  kind: 'platform',
  name: '台账',
  config: {},
  lastSyncedAt: null,
  lastError: '',
}
const CONFIG = {
  path: '/api/v1/platform/tables',
  id_field: 'row_id',
  title_field: '',
  page_param: 'page',
  size_param: 'size',
}
const scopes: ReturnType<typeof effectScope>[] = []

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function pageOf() {
  let baseId = 'b1'
  let isOpen = true
  const scope = effectScope()
  scopes.push(scope)
  const page = scope.run(() =>
    useKnowledgeSources(
      () => baseId,
      () => isOpen,
    ),
  )
  if (!page) throw new Error('missing scope')
  return {
    page,
    close: () => {
      isOpen = false
      page.cancel()
    },
    switch: () => {
      baseId = 'b2'
      page.cancel()
    },
    scope,
  }
}

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true)
  vi.spyOn(api, 'listSources').mockResolvedValue([SOURCE])
  vi.spyOn(api, 'createSource').mockResolvedValue(SOURCE)
  vi.spyOn(api, 'syncSource').mockResolvedValue({
    registered: 2,
    skipped: 3,
    hasMore: true,
  })
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.restoreAllMocks()
})

describe('来源动作', () => {
  it('同步取消不打写API，实际计数和还有更多如实显示', async () => {
    const { page } = pageOf()
    confirm.mockResolvedValueOnce(false)
    expect(await page.sync(SOURCE)).toBe(false)
    expect(api.syncSource).not.toHaveBeenCalled()
    expect(await page.sync(SOURCE)).toBe(true)
    expect(api.syncSource).toHaveBeenCalledWith('s1')
    expect(page.result.value).toContain('登记 2 条，重复跳过 3 条')
    expect(page.result.value).toContain('还有更多')
  })

  it('添加不触发同步，重复提交只创建一次，失败保留可重试原因', async () => {
    const { page } = pageOf()
    const slow = deferred<KnowledgeSource>()
    vi.mocked(api.createSource).mockReturnValueOnce(slow.promise)
    const pending = page.add('台账', CONFIG)
    expect(await page.add('台账', CONFIG)).toBe(false)
    expect(api.createSource).toHaveBeenCalledTimes(1)
    slow.resolve(SOURCE)
    expect(await pending).toBe(true)
    expect(api.syncSource).not.toHaveBeenCalled()
    vi.mocked(api.createSource).mockRejectedValueOnce(new Error('当前不能添加'))
    expect(await page.add('台账', CONFIG)).toBe(false)
    expect(page.error.value).toBe('当前不能添加')
    expect(page.isBusy.value).toBe(false)
  })

  it('关闭或切库取消旧列表，不让旧结果覆盖新库', async () => {
    const context = pageOf()
    const slow = deferred<KnowledgeSource[]>()
    vi.mocked(api.listSources).mockReturnValueOnce(slow.promise)
    const pending = context.page.reload()
    const signal = vi.mocked(api.listSources).mock.calls[0]?.[1]
    context.switch()
    await context.page.reload()
    slow.resolve([{ ...SOURCE, name: '旧列表' }])
    await pending
    expect(signal?.aborted).toBe(true)
    expect(context.page.sources.value[0]?.name).toBe('台账')
    context.close()
    expect(await context.page.add('台账', CONFIG)).toBe(false)
  })

  it('卸载中止列表，加载中不能写；不对不匹配的来源发同步', async () => {
    const context = pageOf()
    const slow = deferred<KnowledgeSource[]>()
    vi.mocked(api.listSources).mockReturnValueOnce(slow.promise)
    const pending = context.page.reload()
    expect(await context.page.add('台账', CONFIG)).toBe(false)
    const signal = vi.mocked(api.listSources).mock.calls[0]?.[1]
    context.scope.stop()
    expect(signal?.aborted).toBe(true)
    slow.resolve([])
    await pending
    context.page.cancel()
    expect(await context.page.sync({ ...SOURCE, baseId: 'other' })).toBe(false)
    expect(await context.page.sync({ ...SOURCE, kind: 'upload' })).toBe(false)
    expect(api.syncSource).not.toHaveBeenCalled()
  })

  it('现有来源若配置为台账记录游标接口也不执行同步', async () => {
    const { page } = pageOf()
    expect(
      await page.sync({
        ...SOURCE,
        config: { path: '/api/v1/platform/dataset-tables/table-id/records' },
      }),
    ).toBe(false)
    expect(api.syncSource).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('确认等待中卸载不会在用户稍后确认时发同步', async () => {
    const context = pageOf()
    const answer = deferred<boolean>()
    confirm.mockReturnValueOnce(answer.promise)
    const pending = context.page.sync(SOURCE)
    context.scope.stop()
    answer.resolve(true)
    expect(await pending).toBe(false)
    expect(api.syncSource).not.toHaveBeenCalled()
  })

  it('同步错误显示实际原因，重开清旧错误；换库后不收旧写结果', async () => {
    const context = pageOf()
    vi.mocked(api.syncSource).mockRejectedValueOnce(
      new Error('来源路径没有权限'),
    )
    expect(await context.page.sync(SOURCE)).toBe(false)
    expect(context.page.error.value).toBe('来源路径没有权限')
    context.page.cancel()
    expect(context.page.error.value).toBe('')
    const slow = deferred<KnowledgeSource>()
    vi.mocked(api.createSource).mockReturnValueOnce(slow.promise)
    const pending = context.page.add('台账', CONFIG)
    context.switch()
    slow.resolve(SOURCE)
    expect(await pending).toBe(false)
    expect(context.page.sources.value).toEqual([])
  })
})
