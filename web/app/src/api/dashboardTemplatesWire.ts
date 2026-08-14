/**
 * @fileoverview 模板库出参的线形（后端 snake_case）与它到载荷（camelCase）的映射。
 */
import type {
  DashboardTemplateDetail,
  DashboardTemplateSummary,
} from '@dt/contracts'

import { parseExportPackage } from './dashboardTransferWire'

/** 列表项，不带整包。 */
export interface DashboardTemplateSummaryWire {
  id: string
  name: string
  description: string | null
  category: string | null
  thumbnail: string | null
  source_project_id: string | null
  created_at: string
  updated_at: string
}

/** 详情，`payload` 即导出端点的产出整包。 */
export interface DashboardTemplateDetailWire extends DashboardTemplateSummaryWire {
  payload: unknown
}

/**
 * 一个模板列表项的载荷。
 * @param wire 线上的模板条目
 */
export function toTemplateSummary(
  wire: DashboardTemplateSummaryWire,
): DashboardTemplateSummary {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    category: wire.category,
    thumbnail: wire.thumbnail,
    sourceProjectId: wire.source_project_id,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  }
}

/**
 * 一个模板详情的载荷。整包按导出包的口径逐字段窄化。
 * @param wire 线上的模板详情
 */
export function toTemplateDetail(
  wire: DashboardTemplateDetailWire,
): DashboardTemplateDetail {
  return {
    ...toTemplateSummary(wire),
    payload: parseExportPackage(wire.payload),
  }
}
