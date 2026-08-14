/**
 * @fileoverview 整屏模板库：列表、另存为模板、详情、删除与实例化。
 */
import type {
  DashboardImportResult,
  DashboardTemplateDetail,
  DashboardTemplateSummary,
  Page,
} from '@dt/contracts'

import { request, requestData } from './client'
import { idempotent, onPlatform } from './dashboard'
import type {
  DashboardTemplateDetailWire,
  DashboardTemplateSummaryWire,
} from './dashboardTemplatesWire'
import { toTemplateDetail, toTemplateSummary } from './dashboardTemplatesWire'
import type { DashboardImportWire } from './dashboardTransferWire'
import { toImportResult } from './dashboardTransferWire'
import { newIdempotencyKey } from './idempotency'

/**
 * 模板不存在（领域 10）。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const TEMPLATE_NOT_FOUND_CODE = 41015

export interface DashboardTemplateListQuery {
  category?: string | undefined
  page?: number | undefined
  size?: number | undefined
}

export interface DashboardTemplateCreateInput {
  sourceDashboardId: string
  name: string
  category?: string | undefined
  description?: string | undefined
}

export interface DashboardTemplateInstantiateInput {
  targetProjectId: string
  /** 缺省用模板名。 */
  name?: string | undefined
}

/** 列模板。⚠ 列表项不带整包，要整包得再拉一次详情。 */
export async function listDashboardTemplates(
  query: DashboardTemplateListQuery = {},
): Promise<Page<DashboardTemplateSummary>> {
  const page = await requestData<Page<DashboardTemplateSummaryWire>>(
    '/dashboard-templates',
    onPlatform({
      query: { category: query.category, page: query.page, size: query.size },
    }),
  )
  return { ...page, items: page.items.map(toTemplateSummary) }
}

/**
 * 从一张屏另存为模板。整包与缩略图都由服务端从源屏拷。
 * @param input 源屏、模板名与分类
 * @param key 幂等键
 */
export async function createDashboardTemplate(
  input: DashboardTemplateCreateInput,
  key: string = newIdempotencyKey(),
): Promise<DashboardTemplateDetail> {
  const wire = await requestData<DashboardTemplateDetailWire>(
    '/dashboard-templates',
    onPlatform({
      method: 'POST',
      body: {
        source_dashboard_id: input.sourceDashboardId,
        name: input.name,
        category: input.category ?? null,
        description: input.description ?? null,
      },
      headers: idempotent(key),
    }),
  )
  return toTemplateDetail(wire)
}

export async function getDashboardTemplate(
  templateId: string,
): Promise<DashboardTemplateDetail> {
  const wire = await requestData<DashboardTemplateDetailWire>(
    `/dashboard-templates/${templateId}`,
    onPlatform(),
  )
  return toTemplateDetail(wire)
}

export async function deleteDashboardTemplate(
  templateId: string,
): Promise<void> {
  await request<null>(
    `/dashboard-templates/${templateId}`,
    onPlatform({ method: 'DELETE' }),
  )
}

/**
 * 把模板实例化成目标项目下的一张新屏。出参与导入同形。
 * @param templateId 模板 id
 * @param input 目标项目与新屏名
 * @param key 幂等键
 */
export async function instantiateDashboardTemplate(
  templateId: string,
  input: DashboardTemplateInstantiateInput,
  key: string = newIdempotencyKey(),
): Promise<DashboardImportResult> {
  const body: Record<string, unknown> = {
    target_project_id: input.targetProjectId,
  }
  if (input.name !== undefined) body.name = input.name
  const wire = await requestData<DashboardImportWire>(
    `/dashboard-templates/${templateId}:instantiate`,
    onPlatform({ method: 'POST', body, headers: idempotent(key) }),
  )
  return toImportResult(wire)
}
