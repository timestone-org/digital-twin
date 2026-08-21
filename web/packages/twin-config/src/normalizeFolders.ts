/**
 * @fileoverview 大纲文件夹的归一化：铸缺失的夹 id、剔非法 kind、剔悬空成员、
 * 同 kind 跨夹去重取先见者。
 * ⚠ 必须在实体表归一化之后调用：悬空判定拿的是归一化后的实体 id。
 */
import { isRecord, stringList, toArray, trimmedString } from './sanitize'
import { TWIN_FOLDER_KINDS } from './types'
import type { TwinFolderKind, TwinOutlineFolder } from './types'

/** 悬空判定用的实体表：七类实体各给一份已归一化的 id 载体。 */
export type TwinFolderHosts = Readonly<
  Record<TwinFolderKind, readonly { id: string }[]>
>

/** 幸存的夹带着原始下标；铸 id 按它起步，与实体铸 id 的口径一致。 */
interface ParsedFolder {
  folder: TwinOutlineFolder
  rawIndex: number
}

/** 只收形状，不铸 id：空串 = 待铸，铸 id 要看全表才知道哪些名字已被占。 */
function parseFolder(raw: unknown): TwinOutlineFolder | null {
  if (!isRecord(raw)) return null
  const kind = TWIN_FOLDER_KINDS.find((item) => item === raw.kind)
  if (kind === undefined) return null
  return {
    id: trimmedString(raw.id),
    kind,
    name: trimmedString(raw.name),
    itemIds: stringList(raw.itemIds),
  }
}

/**
 * 给缺 id 的夹铸 `fold-<序号>`：从自身原始下标起，顺延避开已占用的 id。
 * ⚠ 必须避让显式 id 与先铸出的 id：不避让的话，显式叫 `fold-1` 的夹会与铸出的
 * 撞名，下游按夹 id 分组会互抢成员、Vue key 也会重复。铸出的 id 下一遍归一化
 * 就是显式 id 且不再撞，两遍结果逐字相同（幂等），也不引入任何随机。
 */
function mintFolderIds(parsed: readonly ParsedFolder[]): TwinOutlineFolder[] {
  const taken = new Set(
    parsed.map(({ folder }) => folder.id).filter((id) => id !== ''),
  )
  return parsed.map(({ folder, rawIndex }) => {
    if (folder.id !== '') return folder
    let seq = rawIndex
    while (taken.has(`fold-${seq}`)) seq += 1
    const id = `fold-${seq}`
    taken.add(id)
    return { ...folder, id }
  })
}

/**
 * 归一化文件夹表；幂等，空夹合法。
 * @param raw 落库的 folders 块
 * @param hosts 已归一化的七类实体表，悬空成员按它剔除
 */
export function normalizeFolders(
  raw: unknown,
  hosts: TwinFolderHosts,
): TwinOutlineFolder[] {
  const parsed: ParsedFolder[] = []
  toArray(raw).forEach((item, rawIndex) => {
    const folder = parseFolder(item)
    if (folder !== null) parsed.push({ folder, rawIndex })
  })
  const claimed = new Map<TwinFolderKind, Set<string>>()
  return mintFolderIds(parsed).map((folder) => {
    const valid = new Set(hosts[folder.kind].map((item) => item.id))
    const taken = claimed.get(folder.kind) ?? new Set<string>()
    claimed.set(folder.kind, taken)
    const itemIds = folder.itemIds.filter((id) => {
      if (!valid.has(id) || taken.has(id)) return false
      taken.add(id)
      return true
    })
    return { ...folder, itemIds }
  })
}
