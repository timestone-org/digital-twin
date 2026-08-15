/**
 * @fileoverview 绑定行 ⇄ 孪生实体的对应关系，以及实体增删之后的重映射。
 *
 * ⚠ 这是全仓唯一知道「`anchorValues[2]` 喂的是哪个锚点」的地方。数组绑定的行号
 * 是**文档序**，实体本身不在 fieldKey 里露面——所以删掉一个实体之后，它后面每一行
 * 都会安静地改喂前一个实体。绑定还在、值也还在，只是全接错了对象，界面上看不出来。
 * 编辑器每次增删/重排实体，都必须拿 `remapBindingRows` 把绑定跟着搬一次。
 */
import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_PANEL_BINDING_KEY,
  arrayRowFieldKey,
} from './constants'
import { flattenPanelFields } from './normalizeElements'
import type { TwinConfig } from './types'

/** 一个数组绑定行落在哪个实体上。 */
export interface TwinBindingRow {
  slotKey: string
  index: number
  /** 落库的 fieldKey，如 `anchorValues[2].value`。 */
  fieldKey: string
  /** 这一行喂的实体 id；重映射按它对齐。 */
  entityId: string
  /** 给人看的一行名字，绑点面板拿它当组标题。 */
  label: string
}

/** 名字空着时退回 id：绑点面板上一行没有任何标识比显示 id 更糟。 */
function nameOr(name: string, fallback: string): string {
  return name.trim() === '' ? fallback : name.trim()
}

function rowsOf(
  slotKey: string,
  entities: readonly { id: string; label: string }[],
  sub: 'value' | 'intensity',
): TwinBindingRow[] {
  return entities.map((entity, index) => ({
    slotKey,
    index,
    fieldKey: arrayRowFieldKey(slotKey, index, sub),
    entityId: entity.id,
    label: entity.label,
  }))
}

/**
 * 一份配置摊成全部绑定行，顺序与运行时缝合读值的顺序**逐行相同**。
 * ⚠ 两边各算各的顺序时，每一行都会有值、但全都接错了对象——所以缝合函数与
 * 这里必须共用同一套文档序推导，由契约测试钉住。
 * @param config 归一化后的孪生配置
 */
export function twinBindingRows(config: TwinConfig): TwinBindingRow[] {
  const anchors = config.anchors.map((item) => ({
    id: item.id,
    label: nameOr(item.name, item.id),
  }))
  // 信息牌按**扁平化后**的字段序，不是按牌
  const panels = flattenPanelFields(config.panels).map((entry) => ({
    id: entry.valueKey,
    label: `${nameOr(panelNameOf(config, entry.panelId), entry.panelId)} · ${nameOr(entry.field.label, entry.field.key)}`,
  }))
  const arrows = config.arrows.map((item) => ({
    id: item.id,
    label: nameOr(item.name, nameOr(item.labelText, item.id)),
  }))
  const flows = config.flows.map((item) => ({
    id: item.id,
    label: nameOr(item.name, item.id),
  }))
  return [
    ...rowsOf(TWIN_ANCHOR_BINDING_KEY, anchors, 'value'),
    ...rowsOf(TWIN_PANEL_BINDING_KEY, panels, 'value'),
    ...rowsOf(TWIN_ARROW_BINDING_KEY, arrows, 'value'),
    ...rowsOf(TWIN_FLOW_BINDING_KEY, flows, 'intensity'),
  ]
}

function panelNameOf(config: TwinConfig, panelId: string): string {
  return config.panels.find((item) => item.id === panelId)?.name ?? ''
}

/** 绑定行的组标题表，键是 fieldKey。绑点面板直接用。 */
export function twinRowLabels(config: TwinConfig): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const row of twinBindingRows(config)) labels[row.fieldKey] = row.label
  return labels
}

/** 四个数组槽，重映射逐个走一遍。 */
const ARRAY_SLOTS = [
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_PANEL_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_FLOW_BINDING_KEY,
] as const

/** 一份配置里某个槽的实体 id，按文档序。 */
function entityIdsOf(config: TwinConfig, slotKey: string): string[] {
  return twinBindingRows(config)
    .filter((row) => row.slotKey === slotKey)
    .map((row) => row.entityId)
}

/**
 * 配置改动前后对比，把四个槽的绑定一次全搬到位。
 *
 * ⚠ 编辑器每一次写配置都要过这里，别挑「看起来会影响绑定」的那几个动作调用——
 * 会影响的动作比直觉多：给某张信息牌插一个字段，会让**后面每一张牌**的每一行
 * 整体后移一格，因为牌的值是按摊平后的字段序对齐的。
 *
 * @param before 改动前的配置
 * @param after 改动后的配置
 * @param bindings 该节点当前的全部绑定
 */
export function remapTwinBindings<T extends { fieldKey: string }>(
  before: TwinConfig,
  after: TwinConfig,
  bindings: readonly T[],
): T[] {
  let moved = [...bindings]
  for (const slotKey of ARRAY_SLOTS) {
    moved = remapBindingRows(
      slotKey,
      entityIdsOf(before, slotKey),
      entityIdsOf(after, slotKey),
      moved,
    )
  }
  return moved
}

/** `slotKey[index].sub` 拆成三段；形状不符给 null。 */
function parseFieldKey(
  fieldKey: string,
): { slotKey: string; index: number; sub: string } | null {
  const matched = /^([A-Za-z0-9_]+)\[(\d+)\]\.([A-Za-z0-9_]+)$/.exec(fieldKey)
  if (matched === null) return null
  const [, slotKey = '', digits = '', sub = ''] = matched
  return { slotKey, index: Number(digits), sub }
}

/**
 * 实体增删或重排之后，把绑定搬到新的行号上。
 *
 * ⚠ 这一步漏掉，删一个实体就会让它后面的每一条绑定改喂前一个实体——**没有任何
 * 报错**，读数照常刷新，只是全都接错了对象。
 * ⚠ 实体没了的那些行整条丢弃，不留着：留着的话它会占住一个行号，把后面的又推错一格。
 *
 * ⚠ 只按 `fieldKey` 认人、其余字段整份带走：这里既要能搬已落库的绑定，也要能搬
 * 编辑器里还没落库的草稿，两者字段集不同。收窄成某一种就得在另一种上补一堆
 * 用不到的字段，而那些字段一旦被顺手填错，落库时才会炸。
 *
 * @param slotKey 受影响的数组槽
 * @param beforeIds 改动前这个槽的实体 id，按文档序
 * @param afterIds 改动后这个槽的实体 id，按文档序
 * @param bindings 该节点当前的全部绑定
 */
export function remapBindingRows<T extends { fieldKey: string }>(
  slotKey: string,
  beforeIds: readonly string[],
  afterIds: readonly string[],
  bindings: readonly T[],
): T[] {
  const target = new Map(afterIds.map((id, index) => [id, index]))
  const kept: T[] = []
  for (const binding of bindings) {
    const parsed = parseFieldKey(binding.fieldKey)
    if (parsed === null || parsed.slotKey !== slotKey) {
      kept.push(binding)
      continue
    }
    const entityId = beforeIds[parsed.index]
    const moved = entityId === undefined ? undefined : target.get(entityId)
    if (moved === undefined) continue
    kept.push({
      ...binding,
      fieldKey: `${slotKey}[${moved}].${parsed.sub}`,
    })
  }
  return kept
}
