/** @fileoverview 勾中的节点转成点位草稿，编码校验见 docs/COLLECT_DESIGN.md §2。 */
import type { CollectDataType, CollectPointItemInput } from '@dt/contracts'
import type { Romanize, TreeNode } from './browseTree'
import { suggestCode } from './browseTree'
import { pointCodeProblem } from './pointCode'

/** 一条待建点位。`code` 可以是空串，那是「等人填」。 */
export interface ImportDraft {
  address: string
  name: string
  code: string
  /** 现场读到的类型；`null` = 没读到，按整批的那一档建。 */
  fieldType: CollectDataType | null
}

/**
 * 把勾选的变量节点转成草稿。
 * @param selected 勾选的地址
 * @param index 地址 → 节点
 * @param taken 库里已被占用的编码
 * @param romanize 中文转写，用来给中文标记名推一个能看懂的编码
 */
export function toDrafts(
  selected: readonly string[],
  index: ReadonlyMap<string, TreeNode>,
  taken: ReadonlySet<string>,
  romanize?: Romanize,
): ImportDraft[] {
  const drafts: ImportDraft[] = []
  const used = new Set(taken)
  for (const address of selected) {
    const node = index.get(address)
    if (node === undefined) continue
    const code = unique(suggestCode(address, romanize), used)
    if (code !== '') used.add(code)
    drafts.push({ address, name: node.name, code, fieldType: node.dataType })
  }
  return drafts
}

/** 撞名时挂一个序号后缀；推不出编码时返回空串。 */
function unique(base: string, used: ReadonlySet<string>): string {
  if (base === '') return ''
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}_${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return ''
}

/**
 * 逐条挑编码的毛病，`地址 → 一句话`。没毛病的不进结果。
 * @param drafts 全部草稿
 * @param taken 库里已被占用的编码
 */
export function codeProblems(
  drafts: readonly ImportDraft[],
  taken: ReadonlySet<string>,
): Map<string, string> {
  const seen = new Map<string, number>()
  const found = new Map<string, string>()
  for (const [row, draft] of drafts.entries()) {
    const code = draft.code.trim()
    const twin = seen.get(code)
    if (twin !== undefined) found.set(draft.address, `与第 ${twin + 1} 行重复`)
    else seen.set(code, row)
    const problem = problemOf(code, taken)
    if (problem !== null) found.set(draft.address, problem)
  }
  return found
}

function problemOf(code: string, taken: ReadonlySet<string>): string | null {
  if (code === '') return '编码必填，现场的中文名推不出编码'
  const problem = pointCodeProblem(code)
  if (problem !== null) return problem
  if (taken.has(code)) return '这个编码在本数据源下已经有点位用了'
  return null
}

/** 一批点位共用的那几项设置。 */
export interface BatchDefaults {
  /** 现场没读出类型的那些按它建。 */
  fallbackType: CollectDataType
  samplingIntervalMs: number
  archiveEnabled: boolean
  deadband: number
  retentionDays: number
}

/**
 * 草稿 → 可提交的点位。调用方须先确认 `codeProblems` 是空的。
 * @param drafts 全部草稿
 * @param defaults 整批共用的设置
 */
export function toPointItems(
  drafts: readonly ImportDraft[],
  defaults: BatchDefaults,
): CollectPointItemInput[] {
  return drafts.map((draft) => ({
    code: draft.code.trim(),
    name: draft.name,
    address: draft.address,
    data_type: draft.fieldType ?? defaults.fallbackType,
    sampling_interval_ms: defaults.samplingIntervalMs,
    archive_enabled: defaults.archiveEnabled,
    deadband: defaults.archiveEnabled ? defaults.deadband : 0,
    archive_retention_days:
      defaults.archiveEnabled && defaults.retentionDays > 0
        ? defaults.retentionDays
        : null,
  }))
}
