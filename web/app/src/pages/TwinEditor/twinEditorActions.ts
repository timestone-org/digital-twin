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
import type { TwinDoc } from './twinDoc'
import type { TwinEntityKind, TwinSelection } from './types'

export interface TwinEditorActions {
  add: (kind: TwinEntityKind) => void
  remove: (kind: TwinEntityKind, id: string) => void
  duplicate: (kind: TwinEntityKind, id: string) => void
  move: (kind: TwinEntityKind, id: string, delta: number) => void
  /** 换掉配置里的某个单例段（模型、视点切换控件）。 */
  patchConfig: (patch: Partial<TwinConfig>) => void
  toggleVisible: (kind: TwinEntityKind, id: string) => void
}

/** 带 `visibility` 的五类；视点没有这一段。 */
type VisibleKind = Exclude<TwinEntityKind, 'cameras'>

function hasVisibility(kind: TwinEntityKind): kind is VisibleKind {
  return kind !== 'cameras'
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
    add: (kind) => {
      const { config, id } = addEntity(doc.config.value, kind)
      doc.commit(config)
      select({ kind, id })
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
