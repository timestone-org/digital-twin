/**
 * @fileoverview 一处绑定的规格书：槽声明 + 每一行喂哪个实体 + 那一行接了什么
 * （docs/AI_ASSISTANT_V3_PLAN.md §2.4）。大屏靠模块清单摊，孪生靠现成行表摊。
 *
 * ⚠ 数组绑定的行号是**文档序**，实体本身不在 fieldKey 里露面。不把实体名摊出来，
 * 模型只能按行号猜——结果是每条绑定都有值、却全接错了对象，而界面上看不出来。
 */
import type {
  BindingPayload,
  BindingRowLabel,
  BindingSpec,
  BindingView,
  ModuleManifest,
} from '@dt/contracts'

import { arrayRowCount, slotRows } from '@/features/dashboard/bindingSlots'

/** 一份规格书最多摊几行。一份大场景能有几百行，整份塞进去会占满上下文。 */
const MAX_ROWS = 150

/**
 * 一个可绑位置落在哪个实体上。
 * ⚠ 标量槽也占一条：`index` 恒 0、`fieldKey` 就是槽键。照抄绑定要连标量一起抄，
 * 分两张表的话调用方每次都得记得拼一次，而漏拼不报错。
 */
export interface BindingRowInput {
  slotKey: string
  index: number
  /** 落库的 fieldKey，如 `anchorValues[2].value`。 */
  fieldKey: string
  /** 这一行喂谁的人话名字。 */
  label: string
  /** 这一行喂的实体 id；没有稳定标识时给空串。 */
  entityId: string
}

/** 一个绑定槽的声明。 */
export interface BindingSlotInput {
  key: string
  label: string
  /** 数据类型；由行表反推出来的槽不知道它，给 null。 */
  dataType: string | null
  isArray: boolean
  isEntityPinned: boolean
  isRequired: boolean
  /** 数组槽应有几行；标量槽给 0。 */
  rowCount: number
}

/** 规格书里的一行。 */
export interface BindingReportRow {
  index: number
  field_key: string
  entity: string
  entity_id: string
  /** 没接来源时为 null——⚠ 空行也要在，省掉的话模型会以为这些实体不存在。 */
  source_kind: string | null
  node_key: string | null
  static_value: unknown
}

/** 规格书里的一个槽。 */
export interface BindingReportSlot {
  key: string
  label: string
  data_type: string | null
  is_array: boolean
  is_entity_pinned: boolean
  is_required: boolean
  row_count: number
  rows: BindingReportRow[]
}

/** 规格书里的一个标量槽。 */
export interface BindingReportScalar {
  key: string
  label: string
  source_kind: string | null
  node_key: string | null
  static_value: unknown
}

/** 一处绑定的规格书。 */
export interface BindingReport {
  node_id: string
  module_type: string
  /** 画布上那个名字。 */
  node_label: string
  slots: BindingReportSlot[]
  scalars: BindingReportScalar[]
  is_truncated: boolean
}

/** 规格书的公共部分：这份绑定挂在谁身上。 */
export interface BindingReportSubject {
  nodeId: string
  moduleType: string
  nodeLabel: string
  /** 最多摊几行；不给用 150。 */
  maxRows?: number
}

/** 靠模块清单摊的那一支：大屏编辑器的每个画布节点都走它。 */
export interface ManifestReportInput extends BindingReportSubject {
  manifest: ModuleManifest | undefined
  /** 该节点落库的配置，行名与行数都从它算。 */
  config: Record<string, unknown>
  bindings: readonly BindingPayload[]
}

/** 靠现成行表摊的那一支：孪生两个子编辑器走它。 */
export interface RowsReportInput extends BindingReportSubject {
  /** `twinBindingRows` / `twin2dBindingRows` 的产出直接喂得进来。 */
  rows: readonly BindingRowInput[]
  bindings: readonly BindingView[]
  /** 槽名，键是槽键；缺的槽用槽键当名字。 */
  slotLabels?: Readonly<Record<string, string>>
}

/** 一个数组槽当前有几行：清单声明了就按声明，否则按已有绑定推。 */
function rowCountOf(
  spec: BindingSpec,
  declared: Readonly<Record<string, number>> | undefined,
  bindings: readonly BindingPayload[],
): number {
  if (spec.isArray !== true) return 0
  const given = declared?.[spec.key]
  // ⚠ `??` 而不是 `||`：0 行是合法声明（一个实体都没有的槽），
  // 按真假判会让它退回「按绑定推」，于是删光实体之后残留的绑定又长出行来
  return given ?? arrayRowCount(bindings, spec.key)
}

/** 清单摊出来的槽表。 */
export function manifestBindingSlots(
  input: Pick<ManifestReportInput, 'manifest' | 'config' | 'bindings'>,
): BindingSlotInput[] {
  const specs = input.manifest?.bindings ?? []
  const counts = input.manifest?.bindingRowCounts?.(input.config)
  return specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    dataType: spec.dataType,
    isArray: spec.isArray === true,
    isEntityPinned: spec.isEntityPinned === true,
    isRequired: spec.isRequired === true,
    rowCount: rowCountOf(spec, counts, input.bindings),
  }))
}

/** 标量槽占的那一条：`index` 恒 0、`fieldKey` 就是槽键。 */
function scalarRowOf(spec: BindingSpec): BindingRowInput {
  return {
    slotKey: spec.key,
    index: 0,
    fieldKey: spec.key,
    label: spec.label,
    entityId: '',
  }
}

/**
 * 一个数组槽摊出来的行。
 * ⚠ 行名按**该行第一个子槽**的 fieldKey 查（`bindingRowLabels` 的键就是它），
 * 同一行的其余子槽共用这个名字；查不到退回「第 N 行」。
 */
function arrayRowsOf(
  spec: BindingSpec,
  total: number,
  labels: Readonly<Record<string, BindingRowLabel>> | undefined,
): BindingRowInput[] {
  const head = (spec.arrayFields ?? [])[0]
  return slotRows(spec, total).map((row) => {
    const index = row.rowIndex ?? 0
    const found =
      head === undefined
        ? undefined
        : labels?.[`${spec.key}[${index}].${head.key}`]
    return {
      slotKey: spec.key,
      index,
      fieldKey: row.fieldKey,
      label: found?.title ?? `第 ${index + 1} 行`,
      entityId: found?.id ?? '',
    }
  })
}

/** 清单摊出来的行表，含标量槽。 */
export function manifestBindingRows(
  input: Pick<ManifestReportInput, 'manifest' | 'config' | 'bindings'>,
): BindingRowInput[] {
  const specs = input.manifest?.bindings ?? []
  const labels = input.manifest?.bindingRowLabels?.(input.config)
  const counts = input.manifest?.bindingRowCounts?.(input.config)
  return specs.flatMap((spec) =>
    spec.isArray === true
      ? arrayRowsOf(spec, rowCountOf(spec, counts, input.bindings), labels)
      : [scalarRowOf(spec)],
  )
}

/**
 * 行表反推出来的槽表，按行的出现次序。
 * ⚠ 一律标成「行钉在实体上」：行表这样东西之所以存在，就是因为第 i 行喂的是
 * 文档序第 i 个实体（`twinBindingRows` 的注释）。
 */
export function slotsFromRows(
  rows: readonly BindingRowInput[],
  labels?: Readonly<Record<string, string>>,
): BindingSlotInput[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.slotKey, (counts.get(row.slotKey) ?? 0) + 1)
  }
  return [...counts].map(([key, rowCount]) => ({
    key,
    label: labels?.[key] ?? key,
    dataType: null,
    isArray: true,
    isEntityPinned: true,
    isRequired: false,
    rowCount,
  }))
}

/** 这一行此刻接的是什么。 */
function sourceOf(
  bound: ReadonlyMap<string, BindingView>,
  fieldKey: string,
): Pick<BindingReportRow, 'source_kind' | 'node_key' | 'static_value'> {
  const found = bound.get(fieldKey)
  if (found === undefined) {
    return { source_kind: null, node_key: null, static_value: null }
  }
  return {
    source_kind: found.sourceKind,
    node_key: found.nodeKey,
    static_value: found.staticValueJson,
  }
}

/** 按 fieldKey 索引一次绑定，省掉逐行线性找。 */
function boundBy(
  bindings: readonly BindingView[],
): ReadonlyMap<string, BindingView> {
  return new Map(bindings.map((one) => [one.fieldKey, one]))
}

interface ReportParts extends BindingReportSubject {
  slots: readonly BindingSlotInput[]
  rows: readonly BindingRowInput[]
  bindings: readonly BindingView[]
}

/** 槽表 + 行表 + 已有绑定 → 规格书。 */
function reportOf(parts: ReportParts): BindingReport {
  const bound = boundBy(parts.bindings)
  const arrays = new Set(
    parts.slots.filter((slot) => slot.isArray).map((slot) => slot.key),
  )
  const limit = parts.maxRows ?? MAX_ROWS
  const wanted = parts.rows.filter((row) => arrays.has(row.slotKey))
  const kept = wanted.slice(0, limit)
  const bySlot = new Map<string, BindingReportRow[]>()
  for (const row of kept) {
    const list = bySlot.get(row.slotKey) ?? []
    list.push({
      index: row.index,
      field_key: row.fieldKey,
      entity: row.label,
      entity_id: row.entityId,
      ...sourceOf(bound, row.fieldKey),
    })
    bySlot.set(row.slotKey, list)
  }
  return {
    node_id: parts.nodeId,
    module_type: parts.moduleType,
    node_label: parts.nodeLabel,
    slots: parts.slots
      .filter((slot) => slot.isArray)
      .map((slot) => ({
        key: slot.key,
        label: slot.label,
        data_type: slot.dataType,
        is_array: true,
        is_entity_pinned: slot.isEntityPinned,
        is_required: slot.isRequired,
        row_count: slot.rowCount,
        rows: bySlot.get(slot.key) ?? [],
      })),
    scalars: parts.slots
      .filter((slot) => !slot.isArray)
      .map((slot) => ({
        key: slot.key,
        label: slot.label,
        ...sourceOf(bound, slot.key),
      })),
    is_truncated: wanted.length > kept.length,
  }
}

/** 靠模块清单合成一份规格书。 */
export function manifestBindingReport(
  input: ManifestReportInput,
): BindingReport {
  return reportOf({
    ...input,
    slots: manifestBindingSlots(input),
    rows: manifestBindingRows(input),
  })
}

/** 靠现成行表合成一份规格书。 */
export function rowsBindingReport(input: RowsReportInput): BindingReport {
  return reportOf({
    ...input,
    slots: slotsFromRows(input.rows, input.slotLabels),
  })
}
