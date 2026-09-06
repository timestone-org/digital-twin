/** @fileoverview 报告模块 API，全部走平台前缀。 */
import type {
  CursorPage,
  Page,
  ReportTemplate,
  ReportTemplateSummary,
  ReportTemplateCreate,
  ReportTemplateUpdate,
  ReportBody,
  ReportPreview,
  ReportRender,
  ReportRenderDetail,
  ReportSchedule,
  ReportScheduleCreate,
  ReportScheduleUpdate,
  ReportSchemas,
} from '@dt/contracts'
import { PLATFORM_BASE_URL } from '@/config/app'
import {
  requestData,
  requestBytes,
  request,
  type RequestOptions,
} from './client'
import { newIdempotencyKey } from './idempotency'
import { postUploadForm } from './upload'

function options(extra: RequestOptions = {}): RequestOptions {
  return { baseUrl: PLATFORM_BASE_URL, ...extra }
}
function write(body: unknown, method: 'POST' | 'PUT' = 'POST'): RequestOptions {
  return options({
    method,
    body,
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  })
}
export const listReports = (page = 1, size = 20) =>
  requestData<Page<ReportTemplateSummary>>(
    '/report-templates',
    options({ query: { page, size } }),
  )
export const getReport = (id: string, signal?: AbortSignal) =>
  requestData<ReportTemplate>(`/report-templates/${id}`, options({ signal }))
export const createReport = (body: ReportTemplateCreate) =>
  requestData<ReportTemplate>('/report-templates', write(body))
export const saveReport = (id: string, body: ReportTemplateUpdate) =>
  requestData<ReportTemplate>(`/report-templates/${id}`, write(body, 'PUT'))
export const deleteReport = (id: string) =>
  request(`/report-templates/${id}`, options({ method: 'DELETE' }))
export const previewReport = (
  id: string,
  period: string,
  draft: ReportBody,
  signal?: AbortSignal,
) =>
  requestData<ReportPreview>(`/report-templates/${id}:preview`, {
    ...write({ period, draft }),
    signal,
  })
export const generateReport = (id: string, period: string) =>
  requestData<ReportRender>(
    '/report-renders',
    write({ template_id: id, period }),
  )
export const listReportRenders = (after?: string) =>
  requestData<CursorPage<ReportRender>>(
    '/report-renders',
    options({ query: { after, limit: 20 } }),
  )
export const getReportRender = (id: string, signal?: AbortSignal) =>
  requestData<ReportRenderDetail>(`/report-renders/${id}`, options({ signal }))
export const downloadReport = (id: string) =>
  requestBytes(`/report-renders/${id}/files`, options())
export const listReportSchedules = (page = 1) =>
  requestData<Page<ReportSchedule>>(
    '/report-schedules',
    options({ query: { page, size: 20 } }),
  )
export const createReportSchedule = (body: ReportScheduleCreate) =>
  requestData<ReportSchedule>('/report-schedules', write(body))
export const saveReportSchedule = (id: string, body: ReportScheduleUpdate) =>
  requestData<ReportSchedule>(`/report-schedules/${id}`, write(body, 'PUT'))
export const deleteReportSchedule = (id: string) =>
  request(`/report-schedules/${id}`, options({ method: 'DELETE' }))
export const reportRuntime = () =>
  requestData<ReportSchemas['ReportRuntimeOut']>(
    '/report-renders/runtime/settings',
    options(),
  )

/** 将原件直传对象存储，再提交异步导入。 */
export async function importReport(
  file: File,
  signal?: AbortSignal,
): Promise<ReportRender> {
  const ticket = await requestData<ReportSchemas['ImportTicketOut']>(
    '/report-templates:upload-ticket',
    write({ size_bytes: file.size }),
  )
  await postUploadForm(ticket.url, ticket.fields, file, { signal })
  return await requestData<ReportRender>(
    '/report-templates:import',
    write({ object_key: ticket.object_key }),
  )
}

/** 分页取齐规则选择器的模板目录，避免只能选第一页。 */
export async function listReportChoices(): Promise<ReportTemplateSummary[]> {
  const items: ReportTemplateSummary[] = []
  for (let page = 1; page <= 50; page += 1) {
    const found = await listReports(page, 200)
    items.push(...found.items)
    if (items.length >= found.total || found.items.length === 0) return items
  }
  throw new Error('报告模板目录超过加载上限')
}
