/**
 * @fileoverview 大屏导出包与导入结果：一份包把一张屏搬到别的项目或别的部署。
 *
 * ⚠ 包里没有任何 id，节点父子一律用 `clientKey` / `parentClientKey` 表达。
 * 带 id 的包导回同一个库，会让「导入」变成「悄悄改掉源屏」。
 */
import type {
  BindingDetail,
  BindingSourceKind,
  BindingTransform,
  ComputeSpec,
} from './binding'
import type { DashboardPayload } from './dashboard'

/** 导出态的一条绑定，去掉了 id 与 `nodeId`。 */
export interface ExportBindingPayload {
  fieldKey: string
  sourceKind: BindingSourceKind
  /** 点位身份 `{sourceId}:{pointCode}`；非 `opcua` 来源为 null。 */
  nodeKey: string | null
  staticValueJson: unknown
  computeJson: ComputeSpec | null
  detailJson: BindingDetail | null
  transformJson: BindingTransform | null
}

/** 导出态的一个节点。父子关系只由 `parentClientKey` 表达。 */
export interface ExportNodePayload {
  /** 包内唯一的稳定键；源屏没有的由导出侧补一个。 */
  clientKey: string
  /** 父节点的 `clientKey`。⚠ `null` 是「顶层节点」这个明确语义。 */
  parentClientKey: string | null
  moduleType: string
  x: number
  y: number
  w: number
  h: number
  zIndex: number
  isVisible: boolean
  configJson: Record<string, unknown>
  bindings: ExportBindingPayload[]
}

/** 一张屏的整包。 */
export interface DashboardExportPayload {
  /** 文档格式版本，决定导入时要不要做坐标迁移。 */
  schemaVersion: number
  name: string
  description: string | null
  designWidth: number
  designHeight: number
  themeJson: Record<string, unknown>
  chromeJson: Record<string, unknown>
  nodes: ExportNodePayload[]
}

/**
 * 导入后指向本部署不存在的点位的一条绑定。
 * 这样的绑定照常入库，但必须逐条列给用户——静默丢绑定会让人以为导进来的是一张能用的屏。
 */
export interface UnresolvedBinding {
  nodeKey: string
  fieldKey: string
  /**
   * ⚠ 这里不做闭合集合窄化，用原始串：导入本身已在服务端落库成功，
   * 为一个没见过的来源名把整份结果打回，等于让用户以为导入失败了。
   */
  sourceKind: string
  reason: string
}

/** 导入 / 模板实例化的结果：新屏整包，外加一份说得出原因的告警清单。 */
export interface DashboardImportResult extends DashboardPayload {
  unresolvedBindings: UnresolvedBinding[]
}
