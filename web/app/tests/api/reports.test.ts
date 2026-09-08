/** @fileoverview 报告接口的平台前缀、幂等键与直传协议。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as reports from '@/api/reports'
import * as upload from '@/api/upload'
import { configureApiClient } from '@/api/client'
import type {
  ReportTemplate,
  ReportRender,
  ReportSchedule,
} from '@dt/contracts'

const id = '0198c6aa-f101-7000-8000-000000000001'
const stamp = '2026-08-01T00:00:00.000Z'
const template: ReportTemplate = {
  id,
  code: 'energy',
  name: '月报',
  description: null,
  granularity: 'month',
  is_enabled: true,
  row_version: 1,
  created_at: stamp,
  updated_at: stamp,
  doc_json: { type: 'doc' },
  metrics: [],
  page_json: {},
}
const render: ReportRender = {
  id,
  template_id: id,
  schedule_id: null,
  period: '2026-08',
  granularity: 'month',
  timezone: 'UTC',
  kind: 'render',
  status: 'pending',
  warnings: [],
  error: null,
  created_at: stamp,
  started_at: null,
  finished_at: null,
}
const schedule: ReportSchedule = {
  id,
  template_id: id,
  name: '规则',
  granularity: 'month',
  is_enabled: true,
  delay_hours: 24,
  row_version: 1,
  last_run_period: null,
  created_at: stamp,
  updated_at: stamp,
}
function envelope(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ code: 0, message: 'ok', trace_id: 'trace', data }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}
function responseFor(data: unknown, status = 200): () => Promise<Response> {
  return () => Promise.resolve(envelope(data, status))
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  configureApiClient({ getToken: () => null })
})

describe('报告 HTTP 契约', () => {
  it('所有报告资源都走平台前缀，写操作带幂等键', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(responseFor(template))
    vi.stubGlobal('fetch', fetcher)
    configureApiClient({ getToken: () => 'report-test' })
    await reports.getReport(id)
    await reports.createReport({ code: 'energy', name: '月报' })
    await reports.saveReport(id, { name: '月报', expected_version: 1 })
    fetcher.mockImplementation(responseFor(render, 202))
    await reports.generateReport(id, '2026-08')
    fetcher.mockImplementation(responseFor(schedule, 201))
    await reports.createReportSchedule({ template_id: id, name: '规则' })
    fetcher.mockImplementation(responseFor(schedule))
    await reports.saveReportSchedule(id, { name: '规则', expected_version: 1 })
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toContain('/api/v1/platform/report-')
      expect(options?.headers).toEqual(
        expect.objectContaining({ Authorization: 'Bearer report-test' }),
      )
      if (options?.method === 'POST' || options?.method === 'PUT')
        expect(options.headers).toEqual(
          expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
        )
    }
  })
  it('列表使用相应分页，删除响应没有正文', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        responseFor({ items: [], page: 2, size: 20, total: 0 }),
      )
    vi.stubGlobal('fetch', fetcher)
    await reports.listReports(2)
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('page=2')
    await reports.listReportSchedules(2)
    fetcher.mockImplementation(
      responseFor({ items: [], next: null, has_more: false }),
    )
    await reports.listReportRenders('cursor')
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('after=cursor')
    fetcher.mockResolvedValue(new Response(null, { status: 204 }))
    await reports.deleteReport(id)
    await reports.deleteReportSchedule(id)
    expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
  })
  it('试算包含未保存草稿，生成详情和下载各读各的响应', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      responseFor({
        is_valid: true,
        period: '2026-08',
        timezone: 'UTC',
        metrics: [],
        nodes: {},
        warnings: [],
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    fetcher.mockImplementation(responseFor({ is_valid: true, issues: [] }))
    expect(
      (await reports.validateReport({ name: '未保存草稿' })).is_valid,
    ).toBe(true)
    expect(fetcher.mock.calls[0]?.[0]).toContain('/report-templates:validate')
    fetcher.mockImplementation(
      responseFor({
        is_valid: true,
        period: '2026-08',
        timezone: 'UTC',
        metrics: [],
        nodes: {},
        warnings: [],
      }),
    )
    await reports.previewReport(id, '2026-08', { name: '未保存草稿' })
    expect(fetcher.mock.calls[1]?.[1]?.body).toContain('未保存草稿')
    fetcher.mockImplementation(
      responseFor({ ...render, imported: null, preview: null }),
    )
    await reports.getReportRender(id)
    fetcher.mockImplementation(
      responseFor({ is_schedule_enabled: true, timezone: 'UTC' }),
    )
    const runtimeController = new AbortController()
    expect(
      (await reports.reportRuntime(runtimeController.signal))
        .is_schedule_enabled,
    ).toBe(true)
    const requestSignal = fetcher.mock.calls.at(-1)?.[1]?.signal
    runtimeController.abort()
    expect(requestSignal?.aborted).toBe(true)
    fetcher.mockResolvedValue(new Response('PK document'))
    expect(await (await reports.downloadReport(id)).text()).toBe('PK document')
  })
  it('Word 先直传对象存储，再提交对象身份', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        envelope({
          url: 'http://upload.test',
          fields: { key: 'staging' },
          object_key: 'reports/imports/u/file.docx',
        }),
      )
      .mockResolvedValueOnce(
        envelope({ ...render, kind: 'import', period: '' }, 202),
      )
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(upload, 'postUploadForm').mockResolvedValue()
    const file = new File(['Word'], 'report.docx')
    await reports.importReport(file)
    expect(upload.postUploadForm).toHaveBeenCalledWith(
      'http://upload.test',
      { key: 'staging' },
      file,
      { signal: undefined },
    )
    expect(fetcher.mock.calls[1]?.[1]?.body).toContain(
      'reports/imports/u/file.docx',
    )
  })
})

it('规则选择器能读取第一页之外的模板', async () => {
  const secondId = '0198c6aa-f101-7000-8000-000000000002'
  const summary = {
    id,
    code: template.code,
    name: template.name,
    description: template.description,
    granularity: template.granularity,
    is_enabled: template.is_enabled,
    row_version: template.row_version,
    created_at: stamp,
    updated_at: stamp,
  }
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      envelope({ items: [summary], page: 1, size: 200, total: 2 }),
    )
    .mockResolvedValueOnce(
      envelope({
        items: [{ ...summary, id: secondId, code: 'second' }],
        page: 2,
        size: 200,
        total: 2,
      }),
    )
  vi.stubGlobal('fetch', fetcher)
  expect((await reports.listReportChoices()).map((item) => item.id)).toEqual([
    id,
    secondId,
  ])
  expect(fetcher.mock.calls[1]?.[0]).toEqual(expect.stringContaining('page=2'))
})
