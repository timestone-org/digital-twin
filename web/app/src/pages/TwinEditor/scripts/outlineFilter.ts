/**
 * @fileoverview 大纲搜索的纯逻辑：不分大小写包含匹配（行名/行 id/分组标题/夹名），
 * 命中给出 [前|中|后] 高亮切片。展开态只算不写：搜索态一律按展开渲染，用户自己的
 * 折叠集原样留着，清词即恢复。
 */
import type {
  TwinOutlineFolderView,
  TwinOutlineRow,
  TwinOutlineSection,
  TwinSceneEntry,
} from './outlineNodes'

/** 命中文本的三段切片：`before + match + after` 拼回原文。 */
export interface TwinTextSlices {
  before: string
  match: string
  after: string
}

/** 一行的过滤视图；`slices` 为 null = 名字没命中（可能是按 id 或整段放行）。 */
export interface TwinOutlineRowView {
  row: TwinOutlineRow
  slices: TwinTextSlices | null
}

/** 一个夹的过滤视图。 */
export interface TwinOutlineFolderRowView {
  folder: TwinOutlineFolderView
  slices: TwinTextSlices | null
  rows: readonly TwinOutlineRowView[]
}

/** 一个实体分组的过滤视图。 */
export interface TwinOutlineSectionView {
  section: TwinOutlineSection
  slices: TwinTextSlices | null
  folders: readonly TwinOutlineFolderRowView[]
  rows: readonly TwinOutlineRowView[]
  /** 搜索态 = 命中行数；非搜索态 = 段内总数。 */
  hitCount: number
}

/** 「场景」区一行的过滤视图。 */
export interface TwinSceneEntryView {
  entry: TwinSceneEntry
  slices: TwinTextSlices | null
}

/** 整棵大纲的过滤视图；`active` 为 false 时就是原样直通。 */
export interface TwinOutlineView {
  active: boolean
  scene: readonly TwinSceneEntryView[]
  sections: readonly TwinOutlineSectionView[]
}

/**
 * 不分大小写的包含匹配；命中返回三段切片，没命中或空词返回 null。
 * @param text 原文
 * @param query 已 trim 的搜索词
 */
export function matchSlices(
  text: string,
  query: string,
): TwinTextSlices | null {
  if (query === '') return null
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return null
  return {
    before: text.slice(0, at),
    match: text.slice(at, at + query.length),
    after: text.slice(at + query.length),
  }
}

function rowMatchesId(row: TwinOutlineRow, query: string): boolean {
  return query !== '' && row.id.toLowerCase().includes(query.toLowerCase())
}

/** 过滤一串行；`whole` = 上层（段/夹）已整体命中，行全部放行但仍算高亮。 */
function filterRows(
  rows: readonly TwinOutlineRow[],
  query: string,
  whole: boolean,
): TwinOutlineRowView[] {
  return rows
    .map((row) => ({ row, slices: matchSlices(row.label, query) }))
    .filter(
      (view) => whole || view.slices !== null || rowMatchesId(view.row, query),
    )
}

function filterFolder(
  folder: TwinOutlineFolderView,
  query: string,
  wholeSection: boolean,
): TwinOutlineFolderRowView | null {
  const slices = matchSlices(folder.label, query)
  // 夹名命中显示整夹
  const rows = filterRows(folder.rows, query, wholeSection || slices !== null)
  if (query !== '' && !wholeSection && slices === null && rows.length === 0) {
    return null
  }
  return { folder, slices, rows }
}

function filterSection(
  section: TwinOutlineSection,
  query: string,
): TwinOutlineSectionView | null {
  const slices = matchSlices(section.title, query)
  // 分组标题命中显示整段
  const whole = query === '' || slices !== null
  const folders = section.folders
    .map((folder) => filterFolder(folder, query, whole))
    .filter((view): view is TwinOutlineFolderRowView => view !== null)
  const rows = filterRows(section.rows, query, whole)
  const hitCount = folders.reduce(
    (sum, folder) => sum + folder.rows.length,
    rows.length,
  )
  if (query !== '' && !whole && hitCount === 0) return null
  return { section, slices, folders, rows, hitCount }
}

/**
 * 过滤整棵大纲。空词直通（全部可见、无高亮）；有词时无命中的段/夹整体隐藏。
 * @param sections `buildTwinOutline` 的输出
 * @param scene 「场景」区的三行
 * @param rawQuery 搜索框原文，内部 trim
 */
export function filterTwinOutline(
  sections: readonly TwinOutlineSection[],
  scene: readonly TwinSceneEntry[],
  rawQuery: string,
): TwinOutlineView {
  const query = rawQuery.trim()
  const active = query !== ''
  return {
    active,
    scene: scene
      .map((entry) => ({ entry, slices: matchSlices(entry.title, query) }))
      .filter((view) => !active || view.slices !== null),
    sections: sections
      .map((section) => filterSection(section, query))
      .filter((view): view is TwinOutlineSectionView => view !== null),
  }
}
