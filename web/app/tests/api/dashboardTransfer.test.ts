/**
 * @fileoverview 契约：复制 / 导出 / 导入的 URL 形状、前缀、幂等键与请求体。
 *
 * ⚠ 复制与导入必带 `Idempotency-Key`：网络抖动导致的重试不该建出第二张屏。
 * ⚠ 导出是只读的动作端点，不带幂等键。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as transfer from '@/api/dashboardTransfer'

const PLATFORM_PREFIX = '/api/v1/platform'

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({
    id: 'db2',
    project_id: 'p1',
    name: '总览 副本',
    description: null,
    design_width: 1920,
    design_height: 1080,
    row_version: 1,
    schema_version: 1,
    is_public: false,
    node_count: 0,
    created_at: '',
    updated_at: '',
    theme_json: {},
    chrome_json: {},
    nodes: [],
    unresolved_bindings: [],
  })
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

const PACKAGE = {
  schemaVersion: 1,
  name: '总览',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  themeJson: {},
  chromeJson: {},
  nodes: [],
}

describe('复制', () => {
  it('动作端点带 `:duplicate`，打在 platform 前缀上并带幂等键', async () => {
    await transfer.duplicateDashboard('db1', {}, 'key-1')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1:duplicate')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })

  it('没给新名与目标项目时不下发这两个键，服务端才用得上自己的缺省', async () => {
    await transfer.duplicateDashboard('db1')

    expect(call()[1].body).toEqual({})
  })

  it('给了新名与目标项目就按 snake_case 下发', async () => {
    await transfer.duplicateDashboard('db1', {
      newName: '总览 二期',
      targetProjectId: 'p2',
    })

    expect(call()[1].body).toEqual({
      new_name: '总览 二期',
      target_project_id: 'p2',
    })
  })

  it('出参是一张完整的大屏载荷', async () => {
    const created = await transfer.duplicateDashboard('db1')

    expect(created).toMatchObject({ id: 'db2', projectId: 'p1', nodes: [] })
  })
})

describe('导出', () => {
  it('动作端点带 `:export`，是 POST 但不带幂等键——只读操作不需要', async () => {
    requestMock.mockResolvedValueOnce({
      schema_version: 1,
      name: '总览',
      description: null,
      design_width: 1920,
      design_height: 1080,
      theme_json: {},
      chrome_json: {},
      nodes: [],
    })
    const payload = await transfer.exportDashboard('db1')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1:export')
    expect(options.method).toBe('POST')
    expect('headers' in options).toBe(false)
    expect(payload).toMatchObject({ name: '总览', schemaVersion: 1 })
  })
})

describe('导入', () => {
  it('打的是集合级动作端点 `/dashboards:import`，带幂等键', async () => {
    await transfer.importDashboard(
      { projectId: 'p1', payload: PACKAGE },
      'key-2',
    )
    const [path, options] = call()

    expect(path).toBe('/dashboards:import')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-2' })
  })

  it('请求体里的整包是线形，不是内存里的 camelCase', async () => {
    await transfer.importDashboard({ projectId: 'p1', payload: PACKAGE })
    const body = call()[1].body as Record<string, unknown>

    expect(body.project_id).toBe('p1')
    expect(Object.keys(body.payload as Record<string, unknown>)).toContain(
      'schema_version',
    )
    expect(Object.keys(body.payload as Record<string, unknown>)).not.toContain(
      'schemaVersion',
    )
  })

  it('没给新名与覆盖目标时不下发这两个键', async () => {
    await transfer.importDashboard({ projectId: 'p1', payload: PACKAGE })
    const body = call()[1].body as Record<string, unknown>

    expect('new_name' in body).toBe(false)
    expect('target_dashboard_id' in body).toBe(false)
  })

  it('给了覆盖目标就下发它——那是「换掉这张屏的配置」这个明确意思', async () => {
    await transfer.importDashboard({
      projectId: 'p1',
      payload: PACKAGE,
      newName: '导入的屏',
      targetDashboardId: 'db9',
    })
    const body = call()[1].body as Record<string, unknown>

    expect(body.new_name).toBe('导入的屏')
    expect(body.target_dashboard_id).toBe('db9')
  })

  it('出参带告警清单——不列出来用户会以为导进来的是一张能用的屏', async () => {
    const result = await transfer.importDashboard({
      projectId: 'p1',
      payload: PACKAGE,
    })

    expect(result.unresolvedBindings).toEqual([])
  })
})

describe('错误码', () => {
  it('包形状不对与覆盖目标错项目各有自己的码，按码分支不按文案', () => {
    expect(transfer.EXPORT_PAYLOAD_INVALID_CODE).toBe(41013)
    expect(transfer.IMPORT_TARGET_MISMATCH_CODE).toBe(41014)
  })
})
