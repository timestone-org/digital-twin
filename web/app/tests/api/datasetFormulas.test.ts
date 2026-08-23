/**
 * @fileoverview 锁住公式库接口的 URL 形状、方法、载荷，以及**每一条都带
 * platform 前缀**、每个写动作都带幂等键。
 *
 * ⚠ 漏给 `baseUrl` 不会有任何编译期报错：请求会打到 `/api/v1/auth/...`，边缘按
 * 前缀反代，拿回来的是一个 404 信封——现象是「这个页面没数据」，与真实原因隔得极远。
 * ⚠ `/usages` 是**子资源**而不是动作端点：末段带 `:` 的路径必须是 POST，
 * 一次读操作写成 `GET …:usages` 会当场撞上契约闸（docs/DATASET_DESIGN.md §6）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as formulas from '@/api/datasetFormulas'
import { PLATFORM_BASE_URL } from '@/config/app'

// ⚠ 两个入口都要打桩：取数走 requestData（必须有 data），删除那条 204 走 request。
// 只桩一个的话另一个会真的去发 fetch。
let requestMock: ReturnType<typeof vi.fn>
let requestDataMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue(null)
  requestDataMock = vi.fn().mockResolvedValue([])
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestDataMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function lastCall(
  mock: ReturnType<typeof vi.fn>,
): [string, Record<string, unknown>] {
  const args = mock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

const DRAFT = {
  code: '折标煤',
  name: '折标煤',
  category: 'energy',
  expression: '{电耗} * 0.1229',
  params: [],
  description: null,
}

describe('每一条都打 platform 前缀', () => {
  it.each([
    ['listDatasetFormulas', () => formulas.listDatasetFormulas()],
    ['listDatasetFormulaUsages', () => formulas.listDatasetFormulaUsages('f1')],
    ['createDatasetFormula', () => formulas.createDatasetFormula(DRAFT)],
    [
      'updateDatasetFormula',
      () => formulas.updateDatasetFormula('f1', { name: '改' }),
    ],
    ['restoreDatasetFormula', () => formulas.restoreDatasetFormula('f1')],
    ['deleteDatasetFormula', () => formulas.deleteDatasetFormula('f1')],
  ])('%s', async (_name, run) => {
    await run()
    const mock =
      requestDataMock.mock.calls.length > 0 ? requestDataMock : requestMock
    const [, options] = lastCall(mock)
    expect(options.baseUrl).toBe(PLATFORM_BASE_URL)
  })
})

describe('公式库的读写', () => {
  it('列表就是资源复数，且不带翻页参数——后端不分页', async () => {
    await formulas.listDatasetFormulas()
    const [path, options] = lastCall(requestDataMock)
    expect(path).toBe('/formulas')
    expect(options.query).toBeUndefined()
  })

  it('引用反查是子资源而不是动作端点', async () => {
    await formulas.listDatasetFormulaUsages('f1')
    const [path, options] = lastCall(requestDataMock)
    expect(path).toBe('/formulas/f1/usages')
    expect(options.method).toBeUndefined()
  })

  it('新建走 POST，带上标识与形参表，且带幂等键', async () => {
    await formulas.createDatasetFormula(DRAFT, 'key-1')
    const [path, options] = lastCall(requestDataMock)
    expect(path).toBe('/formulas')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual(DRAFT)
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })

  it('改一条走 PATCH，且**不带** code——它建后不可改', async () => {
    await formulas.updateDatasetFormula('f1', { name: '新名' }, 'key-2')
    const [path, options] = lastCall(requestDataMock)
    expect(path).toBe('/formulas/f1')
    expect(options.method).toBe('PATCH')
    expect(options.body).not.toHaveProperty('code')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-2' })
  })

  it('停用也是一次 PATCH：它与改口径共用同一个端点', async () => {
    await formulas.updateDatasetFormula('f1', { is_enabled: false })
    const [, options] = lastCall(requestDataMock)
    expect(options.body).toEqual({ is_enabled: false })
  })

  it('恢复出厂口径是动作端点，必须是 POST', async () => {
    await formulas.restoreDatasetFormula('f1', 'key-3')
    const [path, options] = lastCall(requestDataMock)
    expect(path).toBe('/formulas/f1:restore')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-3' })
  })

  it('⚠ 删除走 request 而不是 requestData：它回 204，没有 data', async () => {
    await formulas.deleteDatasetFormula('f1', 'key-4')
    const [path, options] = lastCall(requestMock)
    expect(path).toBe('/formulas/f1')
    expect(options.method).toBe('DELETE')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-4' })
    expect(requestDataMock).not.toHaveBeenCalled()
  })

  it('⚠ 删除不给 force：后端没有这个出口，界面也不许造一个', async () => {
    await formulas.deleteDatasetFormula('f1')
    const [, options] = lastCall(requestMock)
    expect(options.query).toBeUndefined()
  })

  it('不传幂等键时自己生成一个，且两次不一样', async () => {
    await formulas.createDatasetFormula(DRAFT)
    const first = lastCall(requestDataMock)[1].headers
    await formulas.createDatasetFormula(DRAFT)
    const second = lastCall(requestDataMock)[1].headers
    expect(first).not.toEqual(second)
  })
})
