/**
 * @fileoverview 大纲树与检查器发上来的动作，落到文档态上。
 *
 * ⚠ 所有写入都经 `doc.commit`，它会顺带把数组绑定搬到新的行号上。绕开它直接
 * 改配置的话，删一个实体就会让它后面每一条绑定改喂前一个实体——界面上完全
 * 看不出来（见 `remapTwinBindings`）。
 */
import type { TwinConfig, TwinVisibilityRule } from '@dt/twin-config'

import {
  addEntity,
  duplicateEntity,
  moveEntity,
  removeEntity,
  updateEntity,
} from './entityOps'
import { addPartsFromNodes } from './bulkParts'
import { addHierNode, moveHierSibling, reparentHierNode } from './hierOps'
import type { TwinDoc } from './twinDoc'
import type { TwinEntityKind, TwinSelection } from './types'

export interface TwinEditorActions {
  add: (kind: TwinEntityKind) => void
  /** 按模型节点名批量建部件；选中最后建出来的那个。 */
  addParts: (nodeNames: readonly string[]) => void
  remove: (kind: TwinEntityKind, id: string) => void
  duplicate: (kind: TwinEntityKind, id: string) => void
  move: (kind: TwinEntityKind, id: string, delta: number) => void
  /** 换掉配置里的某个单例段（模型、视点切换控件）。 */
  patchConfig: (patch: Partial<TwinConfig>) => void
  toggleVisible: (kind: TwinEntityKind, id: string) => void
  /** 新建一个钻取节点；`parentId` 为 null 时建的是根。 */
  addHier: (parentId: string | null) => void
  /** 同一层里前挪一位或后挪一位。 */
  moveHier: (id: string, delta: number) => void
  /** 换一个钻取节点的上一层；拖进自己的子树时什么都不做。 */
  reparentHier: (id: string, parentId: string | null) => void
}

/** 带 `visibility` 的五类；视点与钻取节点没有这一段。 */
type VisibleKind = Exclude<TwinEntityKind, 'cameras' | 'hierNodes'>

function hasVisibility(kind: TwinEntityKind): kind is VisibleKind {
  return kind !== 'cameras' && kind !== 'hierNodes'
}

/** 取某个实体当前的显隐规则；没有这一段给 null。 */
function visibilityOf(
  config: TwinConfig,
  kind: VisibleKind,
  id: string,
): TwinVisibilityRule | null {
  const list: readonly { id: string; visibility: TwinVisibilityRule }[] =
    config[kind]
  return list.find((item) => item.id === id)?.visibility ?? null
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

    add: (kind) => {
      const { config, id } = addEntity(doc.config.value, kind)
      doc.commit(config)
      select({ kind, id })
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

    toggleVisible: (kind, id) => {
      if (!hasVisibility(kind)) return
      const visibility = visibilityOf(doc.config.value, kind, id)
      if (visibility === null) return
      doc.commit(
        updateEntity(doc.config.value, kind, id, {
          visibility: { ...visibility, visible: !visibility.visible },
        }),
      )
    },
  }
}
