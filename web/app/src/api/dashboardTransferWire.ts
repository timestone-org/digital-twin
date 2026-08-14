/**
 * @fileoverview 导出包与导入结果的线形（后端 snake_case）与载荷（camelCase）互转。
 *
 * ⚠ 落盘与上传的文件一律是**线形**：包是跨部署、跨仓互换的格式，camelCase 只活
 * 在内存里。把 camelCase 写进文件，用户拿后端直接导出的那份来导入就会形状对不上。
 * ⚠ 整包逐字段窄化、认不出就抛：这份数据可能来自用户随手挑的一个文件，
 * 放行一个错形状会让它一路流进渲染层，最后崩在某个深层组件里。
 */
import type {
  DashboardExportPayload,
  DashboardImportResult,
  ExportBindingPayload,
  ExportNodePayload,
  UnresolvedBinding,
} from '@dt/contracts'

import { TransportError } from './client'
import type { DashboardWire } from './dashboardWire'
import {
  fromArchiveDetail,
  fromComputeSpec,
  fromTransform,
  isRecord,
  toArchiveDetail,
  toComputeSpec,
  toDashboard,
  toSourceKind,
  toTransform,
} from './dashboardWire'

/** 导入结果的线形：大屏整包再挂一份告警清单。 */
export interface DashboardImportWire extends DashboardWire {
  unresolved_bindings: unknown
}

function invalid(what: string): TransportError {
  return new TransportError(0, `导出包格式不对：${what}`)
}

function requireRecord(raw: unknown, at: string): Record<string, unknown> {
  if (!isRecord(raw)) throw invalid(`${at} 不是对象`)
  return raw
}

function requireString(raw: unknown, at: string): string {
  if (typeof raw !== 'string') throw invalid(`${at} 不是字符串`)
  return raw
}

function requireNumber(raw: unknown, at: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw invalid(`${at} 不是有限数`)
  }
  return raw
}

function requireArray(raw: unknown, at: string): unknown[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw invalid(`${at} 不是数组`)
  return raw
}

/** 缺席与 null 都按「没给」，给了别的类型即形状不对。 */
function optionalString(raw: unknown, at: string): string | null {
  if (raw === undefined || raw === null) return null
  return requireString(raw, at)
}

function optionalRecord(raw: unknown, at: string): Record<string, unknown> {
  if (raw === undefined || raw === null) return {}
  return requireRecord(raw, at)
}

function optionalBoolean(raw: unknown, at: string, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw !== 'boolean') throw invalid(`${at} 不是布尔`)
  return raw
}

/**
 * 导出态的一条绑定。
 * @param raw 未经检查的一条绑定
 * @param at 出错时报给用户的位置
 */
function toExportBinding(raw: unknown, at: string): ExportBindingPayload {
  const source = requireRecord(raw, at)
  return {
    fieldKey: requireString(source.field_key, `${at}.field_key`),
    sourceKind: toSourceKind(source.source_kind),
    nodeKey: optionalString(source.node_key, `${at}.node_key`),
    staticValueJson: source.static_value_json,
    computeJson: toComputeSpec(source.compute_json),
    detailJson: toArchiveDetail(source.detail_json),
    transformJson: toTransform(source.transform_json),
  }
}

/**
 * 导出态的一个节点。
 * @param raw 未经检查的一个节点
 * @param at 出错时报给用户的位置
 */
function toExportNode(raw: unknown, at: string): ExportNodePayload {
  const source = requireRecord(raw, at)
  return {
    clientKey: requireString(source.client_key, `${at}.client_key`),
    parentClientKey: optionalString(
      source.parent_client_key,
      `${at}.parent_client_key`,
    ),
    moduleType: requireString(source.module_type, `${at}.module_type`),
    x: requireNumber(source.x, `${at}.x`),
    y: requireNumber(source.y, `${at}.y`),
    w: requireNumber(source.w, `${at}.w`),
    h: requireNumber(source.h, `${at}.h`),
    zIndex: requireNumber(source.z_index, `${at}.z_index`),
    isVisible: optionalBoolean(source.is_visible, `${at}.is_visible`, true),
    configJson: optionalRecord(source.config_json, `${at}.config_json`),
    bindings: requireArray(source.bindings, `${at}.bindings`).map(
      (item, index) => toExportBinding(item, `${at}.bindings[${index}]`),
    ),
  }
}

/**
 * 把一份整包窄化成载荷。导出端点的出参与用户挑的那个文件都走它。
 * @param raw 未经检查的整包
 */
export function parseExportPackage(raw: unknown): DashboardExportPayload {
  const source = requireRecord(raw, '整包')
  return {
    schemaVersion: requireNumber(source.schema_version, 'schema_version'),
    name: requireString(source.name, 'name'),
    description: optionalString(source.description, 'description'),
    designWidth: requireNumber(source.design_width, 'design_width'),
    designHeight: requireNumber(source.design_height, 'design_height'),
    themeJson: optionalRecord(source.theme_json, 'theme_json'),
    chromeJson: optionalRecord(source.chrome_json, 'chrome_json'),
    nodes: requireArray(source.nodes, 'nodes').map((item, index) =>
      toExportNode(item, `nodes[${index}]`),
    ),
  }
}

function fromExportBinding(
  binding: ExportBindingPayload,
): Record<string, unknown> {
  return {
    field_key: binding.fieldKey,
    source_kind: binding.sourceKind,
    node_key: binding.nodeKey,
    static_value_json: binding.staticValueJson,
    compute_json: fromComputeSpec(binding.computeJson),
    detail_json:
      binding.detailJson === null
        ? null
        : fromArchiveDetail(binding.detailJson),
    transform_json: fromTransform(binding.transformJson),
  }
}

function fromExportNode(node: ExportNodePayload): Record<string, unknown> {
  return {
    client_key: node.clientKey,
    parent_client_key: node.parentClientKey,
    module_type: node.moduleType,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    z_index: node.zIndex,
    is_visible: node.isVisible,
    config_json: node.configJson,
    bindings: node.bindings.map(fromExportBinding),
  }
}

/**
 * 整包写回线形。存盘与导入请求体都用它的产出。
 * @param payload 载荷侧的整包
 */
export function fromExportPackage(
  payload: DashboardExportPayload,
): Record<string, unknown> {
  return {
    schema_version: payload.schemaVersion,
    name: payload.name,
    description: payload.description,
    design_width: payload.designWidth,
    design_height: payload.designHeight,
    theme_json: payload.themeJson,
    chrome_json: payload.chromeJson,
    nodes: payload.nodes.map(fromExportNode),
  }
}

/**
 * 一条未解析绑定的告警；读不懂的条目给 null。
 * ⚠ 读不懂就丢这一条、不抛：导入已在服务端落库成功，为一条读不懂的告警把整份
 * 结果打回，会让用户以为导入失败了。
 * @param raw 未经检查的一条告警
 */
function toUnresolved(raw: unknown): UnresolvedBinding | null {
  if (!isRecord(raw)) return null
  const nodeKey = raw.node_key
  const fieldKey = raw.field_key
  if (typeof nodeKey !== 'string' || typeof fieldKey !== 'string') return null
  return {
    nodeKey,
    fieldKey,
    sourceKind: typeof raw.source_kind === 'string' ? raw.source_kind : '',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
  }
}

/**
 * 导入结果：新屏整包加一份告警清单。
 * @param wire 线上的导入结果
 */
export function toImportResult(
  wire: DashboardImportWire,
): DashboardImportResult {
  const rows = Array.isArray(wire.unresolved_bindings)
    ? wire.unresolved_bindings
    : []
  return {
    ...toDashboard(wire),
    unresolvedBindings: rows
      .map(toUnresolved)
      .filter((item): item is UnresolvedBinding => item !== null),
  }
}
