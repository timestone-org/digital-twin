/**
 * @fileoverview 样式库抽屉的行推导：预置库 ∪ 文档里那两张表合成一列，每一行画什么
 * （名字、来路、几处在用、给哪几枚键），以及关键字过滤。纯读，不改文档也不改选中。
 *
 * ⚠ 来路四档决定给哪枚键：只有 `override` 那一档给「恢复内置」（= 删掉文档里那条
 * 覆盖，§13.4），`custom` 那一档给「删除」，`builtin` 那一档两枚都不给——预置库
 * 里那一份本来就不在文档里，删它是一步什么都不做的空动作，而按钮看着能按。
 * ⚠ 合并次序走 `styleOps` 那一支（`twin2dMerged*Styles`），不在这里另合一遍：
 * 抽屉与调色板对同一份样式排出两种位置时，两处单看都对。
 */
import type { Twin2dConfig } from '@dt/twin2d'

import type { Twin2dStyleKind } from './editorSelection'
import {
  twin2dEdgeStyleOrigin,
  twin2dEdgeStyleUsage,
  twin2dMergedEdgeStyles,
  twin2dMergedNodeStyles,
  twin2dNodeStyleOrigin,
  twin2dNodeStyleUsage,
} from './styleOps'
import type { Twin2dStyleOrigin } from './styleOps'
import { TWIN_2D_ENTITY_LABELS } from './types'

/** 四档来路各自的徽标；`missing` 那一档在库里列不出来，所以是空串。 */
export const TWIN_2D_STYLE_ORIGIN_LABELS: Readonly<
  Record<Twin2dStyleOrigin, string>
> = {
  builtin: '内置',
  override: '覆盖内置',
  custom: '自建',
  missing: '',
}

/** 样式库里的一行。 */
export interface Twin2dStyleLibRow {
  /** 列表键，也是这一行的测试钩子；两类同 id 并存，所以键带类别。 */
  key: string
  kind: Twin2dStyleKind
  id: string
  /** 显示名；样式没起名就退到 id，免得一行只剩几枚按钮。 */
  name: string
  /** 类别名加 id，画在主名下面。 */
  note: string
  origin: Twin2dStyleOrigin
  originLabel: string
  /** 还有几个实体在用它。 */
  usedBy: number
  /** 给不给「恢复内置」：文档里压着一份同 id 的覆盖时才给。 */
  canRestore: boolean
  /** 给不给「删除」：用户自建的那一档才给。 */
  canRemove: boolean
}

/**
 * 一行落成什么样。
 * @param kind 哪条样式轴
 * @param style 这一份样式的身份与名字
 * @param origin 它的来路
 * @param usedBy 还有几个实体在用它
 */
function rowOf(
  kind: Twin2dStyleKind,
  style: { id: string; name: string },
  origin: Twin2dStyleOrigin,
  usedBy: number,
): Twin2dStyleLibRow {
  return {
    key: `${kind}:${style.id}`,
    kind,
    id: style.id,
    name: style.name !== '' ? style.name : style.id,
    note: `${TWIN_2D_ENTITY_LABELS[kind]} · ${style.id}`,
    origin,
    originLabel: TWIN_2D_STYLE_ORIGIN_LABELS[origin],
    usedBy,
    canRestore: origin === 'override',
    canRemove: origin === 'custom',
  }
}

/**
 * 整座样式库摊成一列：节点样式在前，连线样式在后。
 * @param config 当前配置
 */
export function twin2dStyleLibRows(
  config: Twin2dConfig,
): readonly Twin2dStyleLibRow[] {
  const nodes = twin2dMergedNodeStyles(config.styles).map((style) =>
    rowOf(
      'styles',
      style,
      twin2dNodeStyleOrigin(config, style.id),
      twin2dNodeStyleUsage(config, style.id).length,
    ),
  )
  const edges = twin2dMergedEdgeStyles(config.edgeStyles).map((style) =>
    rowOf(
      'edgeStyles',
      style,
      twin2dEdgeStyleOrigin(config, style.id),
      twin2dEdgeStyleUsage(config, style.id).length,
    ),
  )
  return [...nodes, ...edges]
}

/**
 * 关键字过滤：名字与 id 都算，大小写不敏感。
 * ⚠ id 也算：库里几十条时用户记得住的常常只有 id（`boiler`、`pipe-hot`），
 * 只按名字过滤会让他确信这份样式已经不在了。
 * @param rows 整座样式库
 * @param keyword 关键字；空白串即不过滤
 */
export function twin2dStyleLibFilter(
  rows: readonly Twin2dStyleLibRow[],
  keyword: string,
): readonly Twin2dStyleLibRow[] {
  const needle = keyword.trim().toLowerCase()
  if (needle === '') return rows
  return rows.filter((row) =>
    `${row.name} ${row.id}`.toLowerCase().includes(needle),
  )
}
