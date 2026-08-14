/**
 * @fileoverview 大屏的复制、导出与导入。
 *
 * ⚠ 存盘的导出文件用 `fromExportPackage` 的产出（线形 snake_case），不是内存里
 * 的 camelCase 载荷：包要能与后端直接导出的那份互换。
 */
import type {
  DashboardExportPayload,
  DashboardImportResult,
  DashboardPayload,
} from '@dt/contracts'

import { requestData } from './client'
import { idempotent, onPlatform } from './dashboard'
import type { DashboardImportWire } from './dashboardTransferWire'
import {
  fromExportPackage,
  parseExportPackage,
  toImportResult,
} from './dashboardTransferWire'
import type { DashboardWire } from './dashboardWire'
import { toDashboard } from './dashboardWire'
import { newIdempotencyKey } from './idempotency'

/**
 * 导入包形状不对（领域 10）。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const EXPORT_PAYLOAD_INVALID_CODE = 41013

/** 覆盖目标不在给定项目下。 */
export const IMPORT_TARGET_MISMATCH_CODE = 41014

export interface DashboardDuplicateInput {
  /** 缺省是源名加「副本」；项目内大屏名不唯一，重名不去重。 */
  newName?: string | undefined
  /** 缺省复制到源屏所在的项目。 */
  targetProjectId?: string | undefined
}

/**
 * 复制一张屏。
 * @param dashboardId 源屏 id
 * @param input 新名与目标项目
 * @param key 幂等键
 */
export async function duplicateDashboard(
  dashboardId: string,
  input: DashboardDuplicateInput = {},
  key: string = newIdempotencyKey(),
): Promise<DashboardPayload> {
  const body: Record<string, unknown> = {}
  if (input.newName !== undefined) body.new_name = input.newName
  if (input.targetProjectId !== undefined) {
    body.target_project_id = input.targetProjectId
  }
  const wire = await requestData<DashboardWire>(
    `/dashboards/${dashboardId}:duplicate`,
    onPlatform({ method: 'POST', body, headers: idempotent(key) }),
  )
  return toDashboard(wire)
}

/** 导出一张屏。只读，故不带幂等键。 */
export async function exportDashboard(
  dashboardId: string,
): Promise<DashboardExportPayload> {
  const raw = await requestData<unknown>(
    `/dashboards/${dashboardId}:export`,
    onPlatform({ method: 'POST' }),
  )
  return parseExportPackage(raw)
}

export interface DashboardImportInput {
  projectId: string
  payload: DashboardExportPayload
  /** 只在新建时生效。 */
  newName?: string | undefined
  /** 给了就是覆盖既有屏：保留它的 id 与名字，只换配置。 */
  targetDashboardId?: string | undefined
}

/**
 * 导入一份整包。
 * ⚠ 出参里的 `unresolvedBindings` 必须真的展示出来：指向本部署不存在的点位的
 * 绑定照常入库，不列出来用户会以为导进来的是一张能用的屏。
 * @param input 目标项目、整包与覆盖目标
 * @param key 幂等键
 */
export async function importDashboard(
  input: DashboardImportInput,
  key: string = newIdempotencyKey(),
): Promise<DashboardImportResult> {
  const body: Record<string, unknown> = {
    project_id: input.projectId,
    payload: fromExportPackage(input.payload),
  }
  if (input.newName !== undefined) body.new_name = input.newName
  if (input.targetDashboardId !== undefined) {
    body.target_dashboard_id = input.targetDashboardId
  }
  const wire = await requestData<DashboardImportWire>(
    '/dashboards:import',
    onPlatform({ method: 'POST', body, headers: idempotent(key) }),
  )
  return toImportResult(wire)
}
