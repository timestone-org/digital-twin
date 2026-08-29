/**
 * @fileoverview 把大屏、素材与点位历史的线形钉在 platform-server 的
 * openapi.json 上。做法与 auth 那份一致：`Record<keyof T, true>` 在**类型层**
 * 枚举一遍键（漏一个或多一个都过不了 typecheck），再与 openapi 的 properties 比对。
 *
 * ⚠ 手写类型比真接口宽松时编译器无从发现：页面照着读一个后端并不返回的字段，
 * 运行时取到 undefined，崩在渲染里而不是取数处。哪些形状必须在这里出现，
 * 由 `scripts/gates/check_wire_shapes.py` 守——它把「有没有人想到写」变成红灯。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type {
  BindingWire,
  DashboardSummaryWire,
  DashboardWire,
  NodeWire,
  ProjectWire,
} from '@/api/dashboardWire'
import type { DashboardImportWire } from '@/api/dashboardTransferWire'
import type {
  DashboardPublicationWire,
  PublicBindingWire,
  PublicDashboardWire,
  PublicNodeWire,
} from '@/api/dashboardShareWire'
import type { CardStyleWire } from '@/api/cardStylesWire'
import type {
  DashboardTemplateDetailWire,
  DashboardTemplateSummaryWire,
} from '@/api/dashboardTemplatesWire'
import type { DashboardThumbnailWire } from '@/api/dashboardThumbnailWire'
import type { ProjectThemeWire } from '@/api/projectThemesWire'
import type { HistoryPointWire } from '@/api/pointHistories'
import type { LayoutIssue, ValidationReportWire } from '@/api/dashboard'
import type {
  AssetKindWire,
  AssetVariantWire,
  AssetWire,
  UploadTicketWire,
} from '@/api/assetsWire'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'openapi.json',
)

const schemas = (
  JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
    components: { schemas: Record<string, OpenApiSchema> }
  }
).components.schemas

/** 键集的类型层枚举。少写一个键、或写了接口上没有的键，vue-tsc 直接红。 */
type Keys<T> = Record<keyof T, true>

const SHAPES = {
  DashboardSummaryOut: {
    created_at: true,
    description: true,
    design_height: true,
    design_width: true,
    id: true,
    is_public: true,
    name: true,
    node_count: true,
    project_id: true,
    row_version: true,
    schema_version: true,
    updated_at: true,
  } satisfies Keys<DashboardSummaryWire>,
  DashboardOut: {
    chrome_json: true,
    created_at: true,
    description: true,
    design_height: true,
    design_width: true,
    id: true,
    is_public: true,
    name: true,
    node_count: true,
    nodes: true,
    project_id: true,
    row_version: true,
    schema_version: true,
    theme_json: true,
    updated_at: true,
  } satisfies Keys<DashboardWire>,
  NodeOut: {
    bindings: true,
    client_key: true,
    config_json: true,
    created_at: true,
    dashboard_id: true,
    h: true,
    id: true,
    is_visible: true,
    module_type: true,
    parent_id: true,
    updated_at: true,
    w: true,
    x: true,
    y: true,
    z_index: true,
  } satisfies Keys<NodeWire>,
  BindingOut: {
    compute_json: true,
    created_at: true,
    detail_json: true,
    field_key: true,
    id: true,
    node_id: true,
    node_key: true,
    source_kind: true,
    static_value_json: true,
    transform_json: true,
    updated_at: true,
  } satisfies Keys<BindingWire>,
  ProjectOut: {
    brand_json: true,
    created_at: true,
    dashboard_count: true,
    description: true,
    id: true,
    name: true,
    theme_json: true,
    updated_at: true,
  } satisfies Keys<ProjectWire>,
  DashboardImportOut: {
    chrome_json: true,
    created_at: true,
    description: true,
    design_height: true,
    design_width: true,
    id: true,
    is_public: true,
    name: true,
    node_count: true,
    nodes: true,
    project_id: true,
    row_version: true,
    schema_version: true,
    theme_json: true,
    unresolved_bindings: true,
    updated_at: true,
  } satisfies Keys<DashboardImportWire>,
  DashboardShareOut: {
    dashboard_id: true,
    is_public: true,
    public_token: true,
    updated_at: true,
  } satisfies Keys<DashboardPublicationWire>,
  PublicBindingOut: {
    compute_json: true,
    detail_json: true,
    field_key: true,
    id: true,
    node_key: true,
    source_kind: true,
    static_value_json: true,
    transform_json: true,
  } satisfies Keys<PublicBindingWire>,
  PublicNodeOut: {
    bindings: true,
    client_key: true,
    config_json: true,
    h: true,
    id: true,
    is_visible: true,
    module_type: true,
    parent_id: true,
    w: true,
    x: true,
    y: true,
    z_index: true,
  } satisfies Keys<PublicNodeWire>,
  PublicDashboardOut: {
    chrome_json: true,
    description: true,
    design_height: true,
    design_width: true,
    name: true,
    nodes: true,
    schema_version: true,
    theme_json: true,
    updated_at: true,
  } satisfies Keys<PublicDashboardWire>,
  TemplateSummaryOut: {
    category: true,
    created_at: true,
    description: true,
    id: true,
    name: true,
    source_project_id: true,
    thumbnail: true,
    updated_at: true,
  } satisfies Keys<DashboardTemplateSummaryWire>,
  TemplateOut: {
    category: true,
    created_at: true,
    description: true,
    id: true,
    name: true,
    payload: true,
    source_project_id: true,
    thumbnail: true,
    updated_at: true,
  } satisfies Keys<DashboardTemplateDetailWire>,
  CardStyleOut: {
    chrome_json: true,
    config_json: true,
    created_at: true,
    description: true,
    id: true,
    module_type: true,
    name: true,
    thumbnail: true,
    updated_at: true,
  } satisfies Keys<CardStyleWire>,
  ThumbnailOut: {
    dashboard_id: true,
    data: true,
    updated_at: true,
  } satisfies Keys<DashboardThumbnailWire>,
  ThemeOut: {
    id: true,
    mode: true,
    name: true,
    tokens: true,
  } satisfies Keys<ProjectThemeWire>,
  HistoryPointOut: {
    node_key: true,
    quality: true,
    ts: true,
    value: true,
  } satisfies Keys<HistoryPointWire>,
  LayoutIssueOut: {
    code: true,
    field: true,
    message: true,
  } satisfies Keys<LayoutIssue>,
  ValidationReportOut: {
    dashboard_id: true,
    is_valid: true,
    issues: true,
  } satisfies Keys<ValidationReportWire>,
  AssetOut: {
    checksum: true,
    content_type: true,
    created_at: true,
    created_by: true,
    id: true,
    kind: true,
    name: true,
    ref: true,
    size_bytes: true,
    variants: true,
  } satisfies Keys<AssetWire>,
  AssetVariantOut: {
    checksum: true,
    error: true,
    hint: true,
    label: true,
    size_bytes: true,
    status: true,
    variant: true,
  } satisfies Keys<AssetVariantWire>,
  AssetKindOut: {
    content_types: true,
    kind: true,
    label: true,
    max_bytes: true,
  } satisfies Keys<AssetKindWire>,
  UploadTicketOut: {
    asset_id: true,
    expires_seconds: true,
    fields: true,
    url: true,
  } satisfies Keys<UploadTicketWire>,
}

describe('大屏与素材线形与 openapi 一致', () => {
  it.each(Object.keys(SHAPES))('%s 的键与后端逐字相等', (name) => {
    const declared = Object.keys(schemas[name]?.properties ?? {}).sort()
    expect(declared.length).toBeGreaterThan(0)
    const mapped = SHAPES[name as keyof typeof SHAPES]
    expect(Object.keys(mapped).sort()).toEqual(declared)
  })
})
