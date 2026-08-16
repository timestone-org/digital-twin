/**
 * @fileoverview 发布态与公开视图出参的线形，以及它们到载荷的映射。
 */
import type {
  BindingView,
  DashboardNodeView,
  DashboardPublication,
  PublicDashboardPayload,
} from '@dt/contracts'

import {
  toArchiveDetail,
  toComputeSpec,
  toSourceKind,
  toTransform,
} from './dashboardWire'

/** 发布 / 取消发布的出参。⚠ 这里的主键叫 `dashboard_id`，没有 `id`。 */
export interface DashboardPublicationWire {
  dashboard_id: string
  is_public: boolean
  public_token: string | null
  updated_at: string
}

/**
 * 公开面的一条绑定：比管理面的 `BindingWire` **窄**。
 * ⚠ 没有 `node_id` / `created_at` / `updated_at`（它已经嵌在所属节点下面了），
 * 所以**不能复用 `toBinding`**——那个映射会去读这三个键，读到的是 `undefined`。
 */
export interface PublicBindingWire {
  id: string
  field_key: string
  source_kind: string
  node_key: string | null
  static_value_json: unknown
  compute_json: Record<string, unknown> | null
  detail_json: Record<string, unknown> | null
  transform_json: Record<string, unknown> | null
}

/**
 * 公开面的一个节点：比管理面的 `NodeWire` **窄**。
 * ⚠ 没有 `dashboard_id` / `created_at` / `updated_at`，所以**不能复用 `toNode`**
 * ——那个映射会去读这三个键，读到的是 `undefined`，而且一路静默到渲染层。
 */
export interface PublicNodeWire {
  id: string
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
  bindings: PublicBindingWire[]
}

/**
 * 公开端点的出参：只有渲染要用的字段。
 * ⚠ 没有 `id`：公开面不回任何能定位它在库里位置的信息（ADR-0014）。
 */
export interface PublicDashboardWire {
  name: string
  description: string | null
  design_width: number
  design_height: number
  schema_version: number
  theme_json: Record<string, unknown>
  chrome_json: Record<string, unknown>
  updated_at: string
  nodes: PublicNodeWire[]
}

/**
 * 发布态的载荷。
 * @param wire 线上的发布态
 */
export function toPublication(
  wire: DashboardPublicationWire,
): DashboardPublication {
  return {
    dashboardId: wire.dashboard_id,
    isPublic: wire.is_public,
    publicToken: wire.public_token,
  }
}

/**
 * 公开面的一条绑定的载荷。
 * @param wire 线上的公开绑定
 */
export function toPublicBinding(wire: PublicBindingWire): BindingView {
  return {
    id: wire.id,
    fieldKey: wire.field_key,
    sourceKind: toSourceKind(wire.source_kind),
    nodeKey: wire.node_key,
    staticValueJson: wire.static_value_json,
    computeJson: toComputeSpec(wire.compute_json),
    detailJson: toArchiveDetail(wire.detail_json),
    transformJson: toTransform(wire.transform_json),
  }
}

/**
 * 公开面的一个节点的载荷。
 * @param wire 线上的公开节点
 */
export function toPublicNode(wire: PublicNodeWire): DashboardNodeView {
  return {
    id: wire.id,
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
    bindings: wire.bindings.map(toPublicBinding),
  }
}

/**
 * 公开视图的载荷。
 * @param wire 线上的公开大屏
 */
export function toPublicDashboard(
  wire: PublicDashboardWire,
): PublicDashboardPayload {
  return {
    name: wire.name,
    description: wire.description,
    designWidth: wire.design_width,
    designHeight: wire.design_height,
    schemaVersion: wire.schema_version,
    themeJson: wire.theme_json,
    chromeJson: wire.chrome_json,
    updatedAt: wire.updated_at,
    nodes: wire.nodes.map(toPublicNode),
  }
}
