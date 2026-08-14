/**
 * @fileoverview 大屏组态面的接口封装：项目、大屏、整树替换与自检。
 * 组件不直接发请求，一律经这里；出参的线形映射在 `dashboardWire.ts`。
 *
 * ⚠ 这一组打的是 platform-server，每个函数都要给 `baseUrl`：漏给会打到
 * `/api/v1/auth/...`，边缘按前缀反代，拿回来的是一个 404 信封。
 * ⚠ `:replace-layout` **必带 `expected_version`**：不带版本断言的整树替换就是
 * 「最后写入者获胜」，人与 Agent 同时在场时一方的改动被静默抹掉（ADR-0012 二）。
 */
import type {
  BindingSourceKind,
  BindingTransform,
  ComputeSpec,
  DashboardPayload,
  Page,
} from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'
import { request, requestData, type RequestOptions } from './client'
import type {
  DashboardSummary,
  DashboardSummaryWire,
  DashboardWire,
  ProjectSummary,
  ProjectWire,
} from './dashboardWire'
import { toDashboard, toDashboardSummary, toProject } from './dashboardWire'
import { newIdempotencyKey } from './idempotency'

/**
 * 行版本与库里不符的错误码（领域 10）。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const DASHBOARD_VERSION_CONFLICT_CODE = 41007

/** 整树替换里的一条绑定。缺 `id` 表示新增，服务端分配后永不再变。 */
export interface LayoutBindingInput {
  id?: string
  field_key: string
  source_kind: BindingSourceKind
  node_key?: string | null
  static_value_json?: unknown
  compute_json?: ComputeSpec | null
  /** ⚠ 键是 snake_case，服务端要读里面的 `node_key`（见 dashboardWire.ts）。 */
  detail_json?: Record<string, unknown> | null
  transform_json?: BindingTransform | null
}

/**
 * 整树替换里的一个节点。
 * ⚠ `id` 总是给：新节点的 id 由前端先生成，同一次替换里的子节点才写得出
 * `parent_id`，而服务端按 id 三路比对、不重新生成。
 */
export interface LayoutNodeInput {
  id: string
  parent_id: string | null
  client_key?: string | null
  module_type: string
  x: number
  y: number
  w: number
  h: number
  z_index: number
  is_visible: boolean
  config_json: Record<string, unknown>
  bindings: LayoutBindingInput[]
}

export interface ReplaceLayoutInput {
  expectedVersion: number
  nodes: readonly LayoutNodeInput[]
}

export interface DashboardListQuery {
  projectId?: string | undefined
  q?: string | undefined
  page?: number | undefined
  size?: number | undefined
}

export interface DashboardCreateInput {
  projectId: string
  name: string
  description?: string | undefined
  designWidth?: number | undefined
  designHeight?: number | undefined
}

export interface DashboardPatchInput {
  name?: string | undefined
  description?: string | null | undefined
  designWidth?: number | undefined
  designHeight?: number | undefined
}

/** 自检发现的一处悬空引用。`field` 用点号与方括号表达路径。 */
export interface LayoutIssue {
  field: string
  code: string
  message: string
}

export interface ValidationReport {
  dashboardId: string
  isValid: boolean
  issues: LayoutIssue[]
}

interface ValidationReportWire {
  dashboard_id: string
  is_valid: boolean
  issues: LayoutIssue[]
}

/** 给一次调用补上 platform 前缀。 */
function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

/** 写操作的幂等头：网络抖动导致的重试不该建出第二张大屏。 */
function idempotent(key: string): Record<'Idempotency-Key', string> {
  return { 'Idempotency-Key': key }
}

export async function listProjects(
  query: { q?: string | undefined; page?: number; size?: number } = {},
): Promise<Page<ProjectSummary>> {
  const page = await requestData<Page<ProjectWire>>(
    '/dashboard-projects',
    onPlatform({ query }),
  )
  return { ...page, items: page.items.map(toProject) }
}

export async function createProject(
  input: { name: string; description?: string | undefined },
  key: string = newIdempotencyKey(),
): Promise<ProjectSummary> {
  const created = await requestData<ProjectWire>(
    '/dashboard-projects',
    onPlatform({
      method: 'POST',
      body: { name: input.name, description: input.description ?? null },
      headers: idempotent(key),
    }),
  )
  return toProject(created)
}

export async function listDashboards(
  query: DashboardListQuery = {},
): Promise<Page<DashboardSummary>> {
  const page = await requestData<Page<DashboardSummaryWire>>(
    '/dashboards',
    onPlatform({
      query: {
        project_id: query.projectId,
        q: query.q,
        page: query.page,
        size: query.size,
      },
    }),
  )
  return { ...page, items: page.items.map(toDashboardSummary) }
}

/**
 * 加载一张大屏，运行时与编辑器共用。
 * @param dashboardId 大屏 id
 * @param signal 取消信号；快速切换大屏时用它掐掉在途请求
 */
export async function getDashboard(
  dashboardId: string,
  signal?: AbortSignal,
): Promise<DashboardPayload> {
  const wire = await requestData<DashboardWire>(
    `/dashboards/${dashboardId}`,
    onPlatform(signal === undefined ? {} : { signal }),
  )
  return toDashboard(wire)
}

export async function createDashboard(
  input: DashboardCreateInput,
  key: string = newIdempotencyKey(),
): Promise<DashboardPayload> {
  const body: Record<string, unknown> = {
    project_id: input.projectId,
    name: input.name,
    description: input.description ?? null,
  }
  if (input.designWidth !== undefined) body.design_width = input.designWidth
  if (input.designHeight !== undefined) body.design_height = input.designHeight
  const wire = await requestData<DashboardWire>(
    '/dashboards',
    onPlatform({ method: 'POST', body, headers: idempotent(key) }),
  )
  return toDashboard(wire)
}

export async function updateDashboard(
  dashboardId: string,
  patch: DashboardPatchInput,
  key: string = newIdempotencyKey(),
): Promise<DashboardPayload> {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.description !== undefined) body.description = patch.description
  if (patch.designWidth !== undefined) body.design_width = patch.designWidth
  if (patch.designHeight !== undefined) body.design_height = patch.designHeight
  const wire = await requestData<DashboardWire>(
    `/dashboards/${dashboardId}`,
    onPlatform({ method: 'PATCH', body, headers: idempotent(key) }),
  )
  return toDashboard(wire)
}

export async function deleteDashboard(dashboardId: string): Promise<void> {
  await request<null>(
    `/dashboards/${dashboardId}`,
    onPlatform({ method: 'DELETE' }),
  )
}

/**
 * 整棵树替换。
 * ⚠ `expected_version` 与库里不符时后端回 41007 / HTTP 409，调用方必须真的处理
 * 「你的版本旧了，重新加载」这条路径，不许静默重试或覆盖。
 * @param dashboardId 大屏 id
 * @param input 版本断言与全部节点
 * @param key 幂等键
 */
export async function replaceLayout(
  dashboardId: string,
  input: ReplaceLayoutInput,
  key: string = newIdempotencyKey(),
): Promise<DashboardPayload> {
  const wire = await requestData<DashboardWire>(
    `/dashboards/${dashboardId}:replace-layout`,
    onPlatform({
      method: 'POST',
      body: { expected_version: input.expectedVersion, nodes: input.nodes },
      headers: idempotent(key),
    }),
  )
  return toDashboard(wire)
}

/** 自检：列出这张大屏上全部悬空引用，不改任何东西。 */
export async function validateDashboard(
  dashboardId: string,
): Promise<ValidationReport> {
  const wire = await requestData<ValidationReportWire>(
    `/dashboards/${dashboardId}:validate`,
    onPlatform({ method: 'POST' }),
  )
  return {
    dashboardId: wire.dashboard_id,
    isValid: wire.is_valid,
    issues: wire.issues,
  }
}
