/**
 * @fileoverview 契约：模板库的 URL 形状、分页过滤、幂等键，以及线形到载荷的映射。
 *
 * ⚠ 列表项不带整包：整包几百 KB，列表一次拉几十条就是几十 MB。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as templates from '@/api/dashboardTemplates'
import {
  toTemplateDetail,
  toTemplateSummary,
} from '@/api/dashboardTemplatesWire'

const PLATFORM_PREFIX = '/api/v1/platform'

const SUMMARY_WIRE = {
  id: 't1',
  name: '光伏总览模板',
  description: null,
  category: '光伏',
  thumbnail: 'data:image/png;base64,AAA',
  source_project_id: 'p1',
  created_at: '2026-08-14T00:00:00Z',
  updated_at: '2026-08-14T00:00:00Z',
}

const PACKAGE_WIRE = {
  schema_version: 1,
  name: '总览',
  description: null,
  design_width: 1920,
  design_height: 1080,
  theme_json: {},
  chrome_json: {},
  nodes: [],
}

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({
    items: [SUMMARY_WIRE],
    page: 1,
    size: 20,
    total: 1,
    ...SUMMARY_WIRE,
    payload: PACKAGE_WIRE,
    project_id: 'p1',
    design_width: 1920,
    design_height: 1080,
    row_version: 1,
    schema_version: 1,
    is_public: false,
    node_count: 0,
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

describe('线形映射', () => {
  it('列表项字段名转成 camelCase', () => {
    expect(toTemplateSummary(SUMMARY_WIRE)).toEqual({
      id: 't1',
      name: '光伏总览模板',
      description: null,
      category: '光伏',
      thumbnail: 'data:image/png;base64,AAA',
      sourceProjectId: 'p1',
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-14T00:00:00Z',
    })
  })

  it('详情的整包按导出包那套口径逐字段窄化', () => {
    expect(
      toTemplateDetail({ ...SUMMARY_WIRE, payload: PACKAGE_WIRE }).payload,
    ).toMatchObject({ schemaVersion: 1, name: '总览', nodes: [] })
  })

  it('整包形状不对时当场抛，不放行到渲染层', () => {
    expect(() =>
      toTemplateDetail({ ...SUMMARY_WIRE, payload: { name: '总览' } }),
    ).toThrow(/schema_version/)
  })
})

describe('列表', () => {
  it('打在 platform 前缀的 `/dashboard-templates` 上，带分类与分页', async () => {
    await templates.listDashboardTemplates({
      category: '光伏',
      page: 2,
      size: 50,
    })
    const [path, options] = call()

    expect(path).toBe('/dashboard-templates')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(options.query).toEqual({ category: '光伏', page: 2, size: 50 })
  })

  it('出参逐项转成载荷', async () => {
    const page = await templates.listDashboardTemplates()

    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ id: 't1', sourceProjectId: 'p1' })
  })
})

describe('建模板', () => {
  it('带幂等键，分类与描述缺席时显式写 null', async () => {
    await templates.createDashboardTemplate(
      { sourceDashboardId: 'db1', name: '光伏总览模板' },
      'key-1',
    )
    const [path, options] = call()

    expect(path).toBe('/dashboard-templates')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({
      source_dashboard_id: 'db1',
      name: '光伏总览模板',
      category: null,
      description: null,
    })
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })
})

describe('详情与删除', () => {
  it('详情按 id 取，出参带整包', async () => {
    const detail = await templates.getDashboardTemplate('t1')

    expect(call()[0]).toBe('/dashboard-templates/t1')
    expect(detail.payload).toMatchObject({ name: '总览' })
  })

  it('删除走 DELETE', async () => {
    await templates.deleteDashboardTemplate('t1')
    const [path, options] = call()

    expect(path).toBe('/dashboard-templates/t1')
    expect(options.method).toBe('DELETE')
  })
})

describe('实例化', () => {
  it('动作端点带 `:instantiate`，带幂等键，出参与导入同形', async () => {
    const result = await templates.instantiateDashboardTemplate(
      't1',
      { targetProjectId: 'p2', name: '二期总览' },
      'key-2',
    )
    const [path, options] = call()

    expect(path).toBe('/dashboard-templates/t1:instantiate')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({ target_project_id: 'p2', name: '二期总览' })
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-2' })
    expect(result.unresolvedBindings).toEqual([])
  })

  it('没给新屏名时不下发这个键，服务端才用得上模板名', async () => {
    await templates.instantiateDashboardTemplate('t1', {
      targetProjectId: 'p2',
    })

    expect(call()[1].body).toEqual({ target_project_id: 'p2' })
  })
})

describe('错误码', () => {
  it('模板不存在有自己的码，按码分支不按文案', () => {
    expect(templates.TEMPLATE_NOT_FOUND_CODE).toBe(41015)
  })
})
