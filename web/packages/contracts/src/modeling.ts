/**
 * @fileoverview 分析建模：流水线、算子目录、运行与节点级中间结果的线形。
 *
 * ⚠ 这些类型必须与 platform-server 的 `openapi.json` 逐字一致，由
 * `web/app/tests/contract/modeling-shapes.contract.spec.ts` 钉住。手写类型比真
 * 接口**宽松**时 typecheck / lint / 单测全绿，只在运行时崩。
 *
 * 规格见 docs/MODELING_DESIGN.md。
 */

/** 算子分类，与算子面板的分组一一对应。 */
export const MODELING_CATEGORIES = [
  'source',
  'preprocess',
  'feature',
  'model',
  'evaluate',
] as const
export type ModelingCategory = (typeof MODELING_CATEGORIES)[number]

/**
 * 端口上负载的类型标识。两端不相等即不许连线——**这是唯一的类型判据**，
 * 画布的连线前置校验就比它。
 */
export const MODELING_CONTRACTS = [
  'frame@v1',
  'model@v1',
  'metrics@v1',
] as const
export type ModelingContract = (typeof MODELING_CONTRACTS)[number]

/** 一次运行的生命周期。`cancelling` 是必须有的中间格：取消在下一个节点边界才生效。 */
export const MODELING_RUN_STATUSES = [
  'pending',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type ModelingRunStatus = (typeof MODELING_RUN_STATUSES)[number]

/** 节点比运行多一格 `skipped`：失败即停，它后面的节点一个都没跑。 */
export const MODELING_NODE_STATUSES = [
  ...MODELING_RUN_STATUSES,
  'skipped',
] as const
export type ModelingNodeStatus = (typeof MODELING_NODE_STATUSES)[number]

/** 这次运行是谁发起的。 */
export const MODELING_TRIGGERS = ['manual', 'api'] as const
export type ModelingTrigger = (typeof MODELING_TRIGGERS)[number]

/** 结果摘要的种类。**前端按它显式派发视图，不做结构嗅探。** */
export const MODELING_PREVIEW_KINDS = [
  'frame',
  'model',
  'metrics',
  'unknown',
] as const
export type ModelingPreviewKind = (typeof MODELING_PREVIEW_KINDS)[number]

/** 一个端口。`label` 是画在画布上的短标签，端口名本身是英文标识。 */
export interface ModelingPort {
  name: string
  contract: string
  label: string
  is_required: boolean
  description: string
}

/**
 * 一个算子的完整对外描述。算子面板与参数表单都由它驱动。
 *
 * ⚠ `config_schema` 是 pydantic 生成的标准 JSON Schema，表单**由它动态渲染**，
 * 不按算子 code 硬 switch——那样加一个算子要改四个地方。
 */
export interface ModelingOperator {
  code: string
  name: string
  description: string
  category: string
  spec_version: string
  icon: string
  inputs: ModelingPort[]
  outputs: ModelingPort[]
  config_schema: Record<string, unknown>
  fit_required: boolean
  serving_enabled: boolean
  serving_window_required: boolean
  serving_channel: string
}

/** 节点在画布上的位置。只影响观感，不参与任何寻址。 */
export interface ModelingNodePosition {
  left: number
  top: number
}

/** 图上的一个算子实例。⚠ `alias` 只做展示，寻址一律用 `id`。 */
export interface ModelingGraphNode {
  id: string
  operator: string
  alias: string
  config: Record<string, unknown>
  position: ModelingNodePosition
}

/** 一条数据流。⚠ 两端都必须指明端口名，不然表达不出「要连哪一路」。 */
export interface ModelingGraphEdge {
  id: string
  from_node: string
  from_port: string
  to_node: string
  to_port: string
}

/** 一张完整的流水线图。整体保存、整体校验、整体运行。 */
export interface ModelingGraph {
  format_version: string
  nodes: ModelingGraphNode[]
  edges: ModelingGraphEdge[]
}

/** 一条图校验问题。`node_id` / `edge_id` 给界面定位，两者都空表示整图问题。 */
export interface ModelingGraphIssue {
  message: string
  node_id: string
  edge_id: string
}

/** 一次图校验的结果。问题**逐条列全**，不是只报第一条。 */
export interface ModelingGraphCheck {
  is_valid: boolean
  issues: ModelingGraphIssue[]
}

/** 流水线列表里的一条，不带图。 */
export interface ModelingPipelineSummary {
  id: string
  code: string
  name: string
  description: string | null
  node_count: number
  source_table_codes: string[]
  created_by_name: string | null
  created_at: string
  updated_at: string
}

/** 流水线详情，带整张图。 */
export interface ModelingPipeline extends ModelingPipelineSummary {
  graph: ModelingGraph
}

/** 一个节点在这次运行里的状态，**不含结果摘要**（列表接口每秒被轮询）。 */
export interface ModelingNodeRunSummary {
  node_id: string
  operator: string
  alias: string | null
  ordinal: number
  status: ModelingNodeStatus
  duration_ms: number | null
  has_preview: boolean
  error_text: string | null
}

/** 单个节点的详情，含结果摘要。按节点懒加载。 */
export interface ModelingNodeRun extends ModelingNodeRunSummary {
  preview: Record<string, unknown>
  is_preview_truncated: boolean
}

/** 运行列表里的一条。 */
export interface ModelingRunSummary {
  id: string
  pipeline_id: string
  status: ModelingRunStatus
  trigger: ModelingTrigger
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  row_count: number | null
  is_source_truncated: boolean
  error_text: string | null
  created_by_name: string | null
  created_at: string
}

/**
 * 运行详情：状态 + 节点清单 + 当时那份图。
 *
 * ⚠ `graph` 是**运行时冻结的快照**，不是流水线现在那份：不然历史运行的界面会
 * 显示当前的参数、配着当时的结果。
 */
export interface ModelingRun extends ModelingRunSummary {
  graph: ModelingGraph
  nodes: ModelingNodeRunSummary[]
}

/** 模型的任务类型，决定评估指标用哪一套。 */
export const MODELING_TASKS = ['regression', 'classification'] as const
export type ModelingTask = (typeof MODELING_TASKS)[number]

/**
 * 拟合参数怎么带到推理侧。`json` = 纯数据表达，`binary` = 二进制产物。
 *
 * ⚠ 只有 `json` 的版本才可上线：能走纯数据的一律不许走二进制，否则二进制会
 * 因为「省事」逐渐吃掉纯数据那条路，反序列化面越铺越大。
 */
export const MODELING_SERVING_CHANNELS = ['json', 'binary'] as const
export type ModelingServingChannel = (typeof MODELING_SERVING_CHANNELS)[number]

/** 版本列表里的一条。 */
export interface ModelingVersionSummary {
  id: string
  pipeline_id: string
  run_id: string
  version: number
  name: string
  algo: string
  task: ModelingTask
  is_servable: boolean
  serving_channel: ModelingServingChannel
  unservable_reason: string | null
  feature_keys: string[]
  target_key: string
  created_by_name: string | null
  created_at: string
}

/** 版本详情，带发布时冻结的指标与指纹。 */
export interface ModelingVersion extends ModelingVersionSummary {
  metrics: Record<string, number | null>
  fingerprint: Record<string, unknown>
  description: string | null
}

/** 一个形参落到哪个特征列上。⚠ 映射按**位置**定，名字只用于展示。 */
export interface ModelingParamMap {
  param: string
  feature: string
}

/** 一条受影响的台账列。 */
export interface ModelingBindingUsage {
  table_code: string
  column_key: string
}

/**
 * 一条绑定：公式库条目 ⇄ 模型版本。
 *
 * ⚠ `is_orphaned` 是每次列表时现算的——公式条目可能被删掉，而绑定是逻辑引用
 * 拦不住。界面上要如实标出来，不要装作它还好着。
 */
export interface ModelingBinding {
  id: string
  fx_code: string
  model_version_id: string
  param_map: ModelingParamMap[]
  is_enabled: boolean
  is_orphaned: boolean
  created_by_name: string | null
  created_at: string
  updated_at: string
}

/** 换绑的回执：连同「哪些台账列会跟着变」。重算由用户在台账页显式发起。 */
export interface ModelingBindingImpact extends ModelingBinding {
  usages: ModelingBindingUsage[]
}
