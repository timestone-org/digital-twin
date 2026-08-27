/**
 * @fileoverview 大纲树与检查器发上来的动作，落到文档态上。
 *
 * ⚠ 所有写入都经 `doc.commit`，它会顺带把数组绑定搬到新的行号上。绕开它直接
 * 改配置的话，删一个实体就会让它后面每一条绑定改喂前一个实体——界面上完全
 * 看不出来（见 `remapTwinBindings`）。
 */
import type { GizmoChange } from '@dt/three-core'
import type { TwinConfig, Vec3 } from '@dt/twin-config'

import {
  addEntity,
  duplicateEntity,
  moveEntity,
  removeEntity,
  updateEntity,
} from './entityOps'
import { addPartsFromNodes } from './bulkParts'
import {
  addFolder,
  moveIntoFolder,
  removeFolder,
  removeFromFolder,
  renameFolder,
} from './folderOps'
import { addHierNode, moveHierSibling, reparentHierNode } from './hierOps'
import type { TwinDoc } from './twinDoc'
import type { TwinEntityKind, TwinSelection } from './types'

export interface TwinEditorActions {
  add: (kind: TwinEntityKind) => void
  /** 新建一张信息牌，中心落在给定的世界坐标上（视口拾取的表面点）。 */
  addPanelAt: (position: Vec3) => void
  /** 按模型节点名批量建部件；选中最后建出来的那个。 */
  addParts: (nodeNames: readonly string[]) => void
  remove: (kind: TwinEntityKind, id: string) => void
  duplicate: (kind: TwinEntityKind, id: string) => void
  move: (kind: TwinEntityKind, id: string, delta: number) => void
  /** 换掉配置里的某个单例段（模型、视点切换控件）。 */
  patchConfig: (patch: Partial<TwinConfig>) => void
  /** 在某段下新建一个空夹；返回夹 id，供上层立刻进入就地重命名。 */
  addFolder: (kind: TwinEntityKind) => string
  renameFolder: (id: string, name: string) => void
  /** 删夹不删成员：成员回散行。 */
  removeFolder: (id: string) => void
  moveIntoFolder: (folderId: string, itemId: string) => void
  removeFromFolder: (itemId: string) => void
  /** 新建夹并把一个实体移进去，一笔撤销；返回夹 id。 */
  addFolderWithItem: (kind: TwinEntityKind, itemId: string) => string
  /** 新建一个钻取节点；`parentId` 为 null 时建的是根。 */
  addHier: (parentId: string | null) => void
  /** 同一层里前挪一位或后挪一位。 */
  moveHier: (id: string, delta: number) => void
  /** 换一个钻取节点的上一层；拖进自己的子树时什么都不做。 */
  reparentHier: (id: string, parentId: string | null) => void
  /**
   * 坐标轴手柄拖出来的位置 / 朝向。
   * ⚠ 走合并写入：一次拖动逐帧来几十条，各记一条撤销的话，
   * 撤销一次只退回一帧。
   */
  transformEntity: (change: GizmoChange) => void
  /** 手柄松手了；下一次拖动重新开一帧撤销。 */
  endTransform: () => void
}

/** 文件夹的六个动作：纯展示分组的增删改与成员进出，单独收一处。 */
type TwinFolderActions = Pick<
  TwinEditorActions,
  | 'addFolder'
  | 'renameFolder'
  | 'removeFolder'
  | 'moveIntoFolder'
  | 'removeFromFolder'
  | 'addFolderWithItem'
>

function createFolderActions(doc: TwinDoc): TwinFolderActions {
  return {
    addFolder: (kind) => {
      const created = addFolder(doc.config.value, kind)
      doc.commit(created.config)
      return created.id
    },

    renameFolder: (id, name) => {
      doc.commit(renameFolder(doc.config.value, id, name))
    },

    removeFolder: (id) => {
      doc.commit(removeFolder(doc.config.value, id))
    },

    moveIntoFolder: (folderId, itemId) => {
      doc.commit(moveIntoFolder(doc.config.value, folderId, itemId))
    },

    removeFromFolder: (itemId) => {
      doc.commit(removeFromFolder(doc.config.value, itemId))
    },

    addFolderWithItem: (kind, itemId) => {
      // 建夹 + 移入只 commit 一次：撤销一步就该回到「没这个夹」的状态
      const created = addFolder(doc.config.value, kind)
      doc.commit(moveIntoFolder(created.config, created.id, itemId))
      return created.id
    },
  }
}

/** 钻取树的三个动作：它们不按 `kind` 分派，与其余动作形状不同，单独收一处。 */
type TwinHierActions = Pick<
  TwinEditorActions,
  'addHier' | 'moveHier' | 'reparentHier'
>

function createHierActions(
  doc: TwinDoc,
  select: (selection: TwinSelection) => void,
): TwinHierActions {
  return {
    addHier: (parentId) => {
      const { config, id } = addHierNode(doc.config.value, parentId)
      doc.commit(config)
      select({ kind: 'hierNodes', id })
    },

    moveHier: (id, delta) => {
      doc.commit(moveHierSibling(doc.config.value, id, delta))
    },

    reparentHier: (id, parentId) => {
      doc.commit(reparentHierNode(doc.config.value, id, parentId))
    },
  }
}

/**
 * 把手柄拖出来的位置 / 朝向落进配置。
 * ⚠ 走合并写入：一次拖动逐帧来几十条，各记一条撤销的话撤销一次只退回一帧。
 * @param doc 文档态
 * @param change 手柄回传的改动
 */
function applyTransform(doc: TwinDoc, change: GizmoChange): void {
  const config = doc.config.value
  const list = config[change.kind]
  const patch = {
    position: change.position,
    ...(change.direction === null ? {} : { direction: change.direction }),
    ...(change.rotation === null ? {} : { rotation: change.rotation }),
  }
  doc.commitMerged(
    {
      ...config,
      [change.kind]: list.map((item) =>
        item.id === change.id ? { ...item, ...patch } : item,
      ),
    },
    `gizmo:${change.kind}:${change.id}`,
  )
}

/**
 * 装上动作集。
 * @param doc 文档态
 * @param select 动作产生新实体时把选中挪过去
 */
export function createTwinEditorActions(
  doc: TwinDoc,
  select: (selection: TwinSelection) => void,
): TwinEditorActions {
  return {
    ...createHierActions(doc, select),
    ...createFolderActions(doc),

    add: (kind) => {
      const { config, id } = addEntity(doc.config.value, kind)
      doc.commit(config)
      select({ kind, id })
    },

    // 建牌 + 落点只 commit 一次：撤销一步就该回到「没这张牌」的状态
    addPanelAt: (position) => {
      const created = addEntity(doc.config.value, 'panels')
      doc.commit(
        updateEntity(created.config, 'panels', created.id, { position }),
      )
      select({ kind: 'panels', id: created.id })
    },

    addParts: (nodeNames) => {
      const { config, ids } = addPartsFromNodes(doc.config.value, nodeNames)
      if (ids.length === 0) return
      doc.commit(config)
      const last = ids[ids.length - 1]
      if (last !== undefined) select({ kind: 'parts', id: last })
    },

    remove: (kind, id) => {
      doc.commit(removeEntity(doc.config.value, kind, id))
    },

    duplicate: (kind, id) => {
      const result = duplicateEntity(doc.config.value, kind, id)
      if (result.id === null) return
      doc.commit(result.config)
      select({ kind, id: result.id })
    },

    move: (kind, id, delta) => {
      doc.commit(moveEntity(doc.config.value, kind, id, delta))
    },

    patchConfig: (patch) => {
      doc.commit({ ...doc.config.value, ...patch })
    },

    transformEntity: (change) => applyTransform(doc, change),
    endTransform: () => doc.endMerge(),
  }
}
