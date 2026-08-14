/**
 * @fileoverview 大屏出参的线形（后端 snake_case）与它到 `@dt/contracts` 载荷
 * （camelCase）的映射。映射只在这一层做，组件与运行时拿到的一律是载荷类型。
 *
 * ⚠ JSON blob 也逐字段窄化，不写 `as`：后端与前端各改各的时，断言会让错形状
 * 一路流进渲染层，最后崩在某个深层组件里，而不是在这里说「形状不对」。
 * ⚠ `detail_json` 的键是 **snake_case**：服务端要读它里面的 `node_key` 去校验
 * 点位存在（binding_rules.py `_point_key`），写成 camelCase 会让校验静默跳过，
 * 于是一条指向不存在点位的历史绑定照常入库、永不产数据。
 */
import type {
  ArchiveBindingDetail,
  BindingPayload,
  BindingSourceKind,
  BindingTransform,
  ComputeOp,
  ComputeSpec,
  DashboardNodePayload,
  DashboardPayload,
  HistoryTimeRange,
  ProjectPayload,
} from '@dt/contracts'
import { BINDING_SOURCE_KINDS, COMPUTE_OPS } from '@dt/contracts'

import { TransportError } from './client'

/** 列表页的大屏条目，不带节点树。 */
export interface DashboardSummaryWire {
  id: string
  project_id: string
  name: string
  description: string | null
  design_width: number
  design_height: number
  row_version: number
  schema_version: number
  is_public: boolean
  node_count: number
  created_at: string
  updated_at: string
}

/** 加载一张大屏，运行时与编辑器共用。 */
export interface DashboardWire extends DashboardSummaryWire {
  theme_json: Record<string, unknown>
  chrome_json: Record<string, unknown>
  nodes: NodeWire[]
}

/** 一个画布节点。 */
export interface NodeWire {
  id: string
  dashboard_id: string
  parent_id: string | null
  client_key: string | null
  module_type: string
  x: number
  y: number
  w: number
  h: number
  z_index: number
  is_visible: boolean
  config_json: Record<string, unknown>
  created_at: string
  updated_at: string
  bindings: BindingWire[]
}

/** 一条绑定。 */
export interface BindingWire {
  id: string
  node_id: string
  field_key: string
  source_kind: string
  node_key: string | null
  static_value_json: unknown
  compute_json: Record<string, unknown> | null
  detail_json: Record<string, unknown> | null
  transform_json: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/** 一个项目。 */
export interface ProjectWire {
  id: string
  name: string
  description: string | null
  theme_json: Record<string, unknown>
  brand_json: Record<string, unknown>
  dashboard_count: number
  created_at: string
  updated_at: string
}

/** 项目载荷加上列表页要显示的规模。 */
export interface ProjectSummary extends ProjectPayload {
  dashboardCount: number
}

/** 大屏列表项载荷。 */
export interface DashboardSummary {
  id: string
  projectId: string
  name: string
  description: string | null
  designWidth: number
  designHeight: number
  rowVersion: number
  schemaVersion: number
  isPublic: boolean
  nodeCount: number
  createdAt: string
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 有限数，其余一律按没给。 */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isSourceKind(value: unknown): value is BindingSourceKind {
  return BINDING_SOURCE_KINDS.some((kind) => kind === value)
}

function isComputeOp(value: unknown): value is ComputeOp {
  return COMPUTE_OPS.some((op) => op === value)
}

/**
 * 窄化来源种类。
 * ⚠ 认不出就抛：`source_kind` 是闭合集合，出现第五种值意味着两侧的清单漂了，
 * 静默按某一种处理会让整屏数据看上去正常而实际全错。
 * @param raw 线上的来源种类
 */
function toSourceKind(raw: unknown): BindingSourceKind {
  if (isSourceKind(raw)) return raw
  throw new TransportError(0, `服务端返回了未知的绑定来源：${String(raw)}`)
}

/**
 * 派生规格。op 不在闭合集合里或 inputs 不是字符串数组时给 null——
 * 求值层会把它渲染成一条说得出原因的错误槽。
 * @param raw 线上的 `compute_json`
 */
function toComputeSpec(raw: Record<string, unknown> | null): ComputeSpec | null {
  if (raw === null || !isComputeOp(raw.op)) return null
  const inputs = Array.isArray(raw.inputs) ? raw.inputs : []
  const spec: ComputeSpec = {
    op: raw.op,
    inputs: inputs.filter((item): item is string => typeof item === 'string'),
  }
  const precision = finite(raw.precision)
  if (precision !== null) spec.precision = precision
  return spec
}

/**
 * 定值变换。
 * @param raw 线上的 `transform_json`
 */
function toTransform(
  raw: Record<string, unknown> | null,
): BindingTransform | null {
  if (raw === null) return null
  return {
    scale: finite(raw.scale),
    offset: finite(raw.offset),
    round: finite(raw.round),
  }
}

/**
 * 历史取数的时间范围。缺席的边界不写进对象——`exactOptionalPropertyTypes` 下
 * 「没有这个键」与「键值是 undefined」是两回事。
 * @param raw 线上的 `range`
 */
export function toHistoryRange(raw: unknown): HistoryTimeRange {
  const source = isRecord(raw) ? raw : {}
  const range: HistoryTimeRange = {}
  const fromMs = finite(source.from_ms)
  if (fromMs !== null) range.fromMs = fromMs
  const toMs = finite(source.to_ms)
  if (toMs !== null) range.toMs = toMs
  if (typeof source.last_window === 'string' && source.last_window !== '') {
    range.lastWindow = source.last_window
  }
  const limit = finite(source.limit)
  if (limit !== null) range.limit = limit
  return range
}

/**
 * 时间范围写回线上形状。
 * @param range 载荷侧的时间范围
 */
export function fromHistoryRange(
  range: HistoryTimeRange,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (range.fromMs !== undefined) out.from_ms = range.fromMs
  if (range.toMs !== undefined) out.to_ms = range.toMs
  if (range.lastWindow !== undefined) out.last_window = range.lastWindow
  if (range.limit !== undefined) out.limit = range.limit
  return out
}

/**
 * 历史绑定的取数说明。缺点位身份时给 null：那样的绑定取不到数，
 * 由求值层报「历史绑定没有取数说明」，而不是在这里凭空补一个点位。
 * @param raw 线上的 `detail_json`
 */
function toArchiveDetail(
  raw: Record<string, unknown> | null,
): ArchiveBindingDetail | null {
  if (raw === null || typeof raw.node_key !== 'string') return null
  return { nodeKey: raw.node_key, range: toHistoryRange(raw.range) }
}

/**
 * 取数说明写回线上形状。
 * @param detail 载荷侧的取数说明
 */
export function fromArchiveDetail(
  detail: ArchiveBindingDetail,
): Record<string, unknown> {
  return { node_key: detail.nodeKey, range: fromHistoryRange(detail.range) }
}

/**
 * 一条绑定的载荷。
 * @param wire 线上的绑定
 */
export function toBinding(wire: BindingWire): BindingPayload {
  return {
    id: wire.id,
    nodeId: wire.node_id,
    fieldKey: wire.field_key,
    sourceKind: toSourceKind(wire.source_kind),
    nodeKey: wire.node_key,
    staticValueJson: wire.static_value_json,
    computeJson: toComputeSpec(wire.compute_json),
    detailJson: toArchiveDetail(wire.detail_json),
    transformJson: toTransform(wire.transform_json),
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  }
}

/**
 * 一个节点的载荷。
 * @param wire 线上的节点
 */
export function toNode(wire: NodeWire): DashboardNodePayload {
  return {
    id: wire.id,
    dashboardId: wire.dashboard_id,
    parentId: wire.parent_id,
    clientKey: wire.client_key,
    moduleType: wire.module_type,
    x: wire.x,
    y: wire.y,
    w: wire.w,
    h: wire.h,
    zIndex: wire.z_index,
    isVisible: wire.is_visible,
    configJson: wire.config_json,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
    bindings: wire.bindings.map(toBinding),
  }
}

/**
 * 一张大屏的载荷。
 * ⚠ `publicToken` 恒为 null：一期不开放公开分享面，接口里根本没有这一列，
 * 编造一个 token 会让「这张屏已经公开了」看上去是真的（DASHBOARD_DESIGN §8）。
 * @param wire 线上的大屏
 */
export function toDashboard(wire: DashboardWire): DashboardPayload {
  return {
    ...toDashboardSummary(wire),
    themeJson: wire.theme_json,
    chromeJson: wire.chrome_json,
    publicToken: null,
    nodes: wire.nodes.map(toNode),
  }
}

/**
 * 列表项的载荷。
 * @param wire 线上的大屏条目
 */
export function toDashboardSummary(wire: DashboardSummaryWire): DashboardSummary {
  return {
    id: wire.id,
    projectId: wire.project_id,
    name: wire.name,
    description: wire.description,
    designWidth: wire.design_width,
    designHeight: wire.design_height,
    rowVersion: wire.row_version,
    schemaVersion: wire.schema_version,
    isPublic: wire.is_public,
    nodeCount: wire.node_count,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  }
}

/**
 * 一个项目的载荷。
 * @param wire 线上的项目
 */
export function toProject(wire: ProjectWire): ProjectSummary {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    themeJson: wire.theme_json,
    brandJson: wire.brand_json,
    dashboardCount: wire.dashboard_count,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  }
}
