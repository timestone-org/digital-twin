/**
 * @fileoverview 大纲文件夹的增删改与成员进出。全是纯函数：收一份配置，回一份新配置。
 * ⚠ 文件夹是纯展示分组：这里的任何操作都不碰实体数组，文档序（=数组绑定的
 * 对齐位次）在移入移出前后逐字不变。
 */
import { type TwinConfig, normalizeTwinConfig } from '@dt/twin-config'

import { freshId, newEntityId } from './entityOps'
import type { TwinIdFactory } from './entityOps'
import type { TwinEntityKind } from './types'

// ⚠ 不用 `folder`：零类型字面量闸对常见单词误报（见按钮控件的先例）
const FOLDER_ID_PREFIX = 'fold'

/** 新建的夹先叫这个名字；上层会立刻进入就地重命名。 */
export const NEW_FOLDER_NAME = '新文件夹'

/** 归一化收口：所有写操作都从这里出去，悬空清理与跨夹去重只有一处定义。 */
function renormalize(config: unknown): TwinConfig {
  return normalizeTwinConfig(config)
}

/**
 * 新建一个空夹，追加在夹表末尾。
 * @param config 当前配置
 * @param kind 夹所属的实体段
 * @param makeId id 工厂，缺省随机
 */
export function addFolder(
  config: TwinConfig,
  kind: TwinEntityKind,
  makeId: TwinIdFactory = newEntityId,
): { config: TwinConfig; id: string } {
  const taken = new Set(config.folders.map((folder) => folder.id))
  const id = freshId(FOLDER_ID_PREFIX, taken, makeId)
  const folder = { id, kind, name: NEW_FOLDER_NAME, itemIds: [] }
  return {
    config: renormalize({ ...config, folders: [...config.folders, folder] }),
    id,
  }
}

/**
 * 重命名一个夹；夹不存在时原样返回。
 * @param config 当前配置
 * @param id 夹 id
 * @param name 新名字
 */
export function renameFolder(
  config: TwinConfig,
  id: string,
  name: string,
): TwinConfig {
  const target = config.folders.find((folder) => folder.id === id)
  // 名字没变时原引用返回，`doc.commit` 便不会白记一帧撤销
  if (target === undefined || target.name === name.trim()) return config
  return renormalize({
    ...config,
    folders: config.folders.map((folder) =>
      folder.id === id ? { ...folder, name } : folder,
    ),
  })
}

/**
 * 删掉一个夹：只删夹对象，成员回到散行，实体一个不动。
 * @param config 当前配置
 * @param id 夹 id
 */
export function removeFolder(config: TwinConfig, id: string): TwinConfig {
  if (!config.folders.some((folder) => folder.id === id)) return config
  return renormalize({
    ...config,
    folders: config.folders.filter((folder) => folder.id !== id),
  })
}

/**
 * 把一个实体移入指定夹（追加在夹内末尾）。夹或实体不存在时原样返回。
 * ⚠ 先从同类其它夹里摘出来再放进目标夹：归一化的跨夹去重取先见者，
 * 不摘的话按夹表序谁在前谁赢，往后面的夹移动会静默失败。
 * @param config 当前配置
 * @param folderId 目标夹 id
 * @param itemId 成员实体 id
 */
export function moveIntoFolder(
  config: TwinConfig,
  folderId: string,
  itemId: string,
): TwinConfig {
  const target = config.folders.find((folder) => folder.id === folderId)
  if (target === undefined) return config
  const members: readonly { id: string }[] = config[target.kind]
  if (!members.some((member) => member.id === itemId)) return config
  const folders = config.folders.map((folder) => {
    if (folder.id === folderId) {
      const kept = folder.itemIds.filter((id) => id !== itemId)
      return { ...folder, itemIds: [...kept, itemId] }
    }
    if (folder.kind !== target.kind) return folder
    return { ...folder, itemIds: folder.itemIds.filter((id) => id !== itemId) }
  })
  return renormalize({ ...config, folders })
}

/**
 * 把一个实体从所在夹移出，回到散行；不在任何夹里时原样返回。
 * @param config 当前配置
 * @param itemId 成员实体 id
 */
export function removeFromFolder(
  config: TwinConfig,
  itemId: string,
): TwinConfig {
  if (!config.folders.some((folder) => folder.itemIds.includes(itemId))) {
    return config
  }
  return renormalize({
    ...config,
    folders: config.folders.map((folder) =>
      folder.itemIds.includes(itemId)
        ? { ...folder, itemIds: folder.itemIds.filter((id) => id !== itemId) }
        : folder,
    ),
  })
}
