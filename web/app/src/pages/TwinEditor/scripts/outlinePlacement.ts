/** @fileoverview 大纲实体的相对排序与目标文件夹归属。 */
import type { TwinConfig } from '@dt/twin-config'
import { moveEntity } from './entityOps'
import { moveIntoFolder, removeFromFolder } from './folderOps'
import type { TwinEntityKind } from './types'

export interface OutlinePlacement {
  kind: TwinEntityKind
  id: string
  targetId: string
  position: 'before' | 'after'
}

/** 将实体放到同类目标前后，并随目标归入文件夹。 */
export function placeOutlineEntity(
  config: TwinConfig,
  placement: OutlinePlacement,
): TwinConfig {
  const { kind, id, targetId, position } = placement
  const list = config[kind]
  const from = list.findIndex((item) => item.id === id)
  const target = list.findIndex((item) => item.id === targetId)
  if (from < 0 || target < 0 || id === targetId) return config
  const to = target - (from < target ? 1 : 0) + (position === 'after' ? 1 : 0)
  const folder = config.folders.find(
    (item) => item.kind === kind && item.itemIds.includes(targetId),
  )
  const grouped =
    folder === undefined
      ? removeFromFolder(config, id)
      : moveIntoFolder(config, folder.id, id)
  return to === from ? grouped : moveEntity(grouped, kind, id, to - from)
}
