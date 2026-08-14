/**
 * @fileoverview 锁住大屏组态面接口的 URL 形状、前缀、幂等键与版本断言。
 *
 * ⚠ 前缀写错会静默打到 auth-server 上——那边对未知路径回 404，
 * 现象是「这个功能没做」而不是「地址错了」。
 * ⚠ `:replace-layout` **必带 `expected_version`**：不带版本断言的整树替换就是
 * 「最后写入者获胜」，人与 Agent 同时在场时一方的改动被静默抹掉（ADR-0012）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as dashboards from '@/api/dashboard'

const PLATFORM_PREFIX = '/api/v1/platform'

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({
    items: [],
    page: 1,
    size: 20,
    total: 0,
    id: 'db1',
    project_id: 'p1',
    name: '大屏',
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
    dashboard_id: 'db1',
    is_valid: true,
    issues: [],
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

describe('前缀', () => {
  it('读与写都打在 platform 前缀上', async () => {
    await dashboards.listDashboards()
    expect(call()[1].baseUrl).toBe(PLATFORM_PREFIX)

    await dashboards.deleteDashboard('db1')
    expect(call()[1].baseUrl).toBe(PLATFORM_PREFIX)
  })
})

describe('项目', () => {
  it('列表带关键字与分页', async () => {
    await dashboards.listProjects({ q: '园区', page: 2, size: 50 })
    const [path, options] = call()

    expect(path).toBe('/dashboard-projects')
    expect(options.query).toEqual({ q: '园区', page: 2, size: 50 })
  })

  it('新建带幂等键，描述缺席时显式写 null', async () => {
    await dashboards.createProject({ name: '园区' }, 'key-1')
    const [path, options] = call()

    expect(path).toBe('/dashboard-projects')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({ name: '园区', description: null })
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })
})

describe('大屏', () => {
  it('列表按项目与关键字过滤', async () => {
    await dashboards.listDashboards({ projectId: 'p1', q: '总览', page: 1 })
    const [path, options] = call()

    expect(path).toBe('/dashboards')
    expect(options.query).toMatchObject({ project_id: 'p1', q: '总览' })
  })

  it('加载带取消信号，快速切屏时掐得掉在途请求', async () => {
    const controller = new AbortController()
    await dashboards.getDashboard('db1', controller.signal)
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1')
    expect(options.signal).toBe(controller.signal)
  })

  it('不给取消信号时不往请求里塞一个 undefined', async () => {
    await dashboards.getDashboard('db1')

    expect('signal' in call()[1]).toBe(false)
  })

  it('新建带幂等键与设计尺寸', async () => {
    await dashboards.createDashboard(
      { projectId: 'p1', name: '总览', designWidth: 2560, designHeight: 1440 },
      'key-2',
    )
    const [path, options] = call()

    expect(path).toBe('/dashboards')
    expect(options.body).toEqual({
      project_id: 'p1',
      name: '总览',
      description: null,
      design_width: 2560,
      design_height: 1440,
    })
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-2' })
  })

  it('没给设计尺寸时不下发这两个键，服务端才用得上自己的缺省', async () => {
    await dashboards.createDashboard({ projectId: 'p1', name: '总览' })

    expect(call()[1].body).toEqual({
      project_id: 'p1',
      name: '总览',
      description: null,
    })
  })

  it('改元数据只发给了的那几项', async () => {
    await dashboards.updateDashboard('db1', { name: '改过' }, 'key-3')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1')
    expect(options.method).toBe('PATCH')
    expect(options.body).toEqual({ name: '改过' })
  })

  it('描述显式给 null 时也发出去——那是「清空描述」这个明确意思', async () => {
    await dashboards.updateDashboard('db1', { description: null })

    expect(call()[1].body).toEqual({ description: null })
  })

  it('删除走 DELETE', async () => {
    await dashboards.deleteDashboard('db1')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1')
    expect(options.method).toBe('DELETE')
  })
})

describe('整树替换与自检', () => {
  it('动作端点带 `:replace-layout`，请求体里必有 expected_version', async () => {
    await dashboards.replaceLayout(
      'db1',
      { expectedVersion: 7, nodes: [] },
      'key-4',
    )
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1:replace-layout')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({ expected_version: 7, nodes: [] })
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-4' })
  })

  it('自检是动作端点，且只读不改', async () => {
    const report = await dashboards.validateDashboard('db1')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1:validate')
    expect(options.method).toBe('POST')
    expect(report).toEqual({ dashboardId: 'db1', isValid: true, issues: [] })
  })

  it('版本冲突的错误码按码分支，不按文案', () => {
    expect(dashboards.DASHBOARD_VERSION_CONFLICT_CODE).toBe(41007)
  })
})
