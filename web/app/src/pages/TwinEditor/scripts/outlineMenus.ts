/**
 * @fileoverview 大纲行、段头与夹头的「⋯」菜单项。纯函数，值即动作名，
 * 「移入某夹」带 `folder-into:` 前缀 + 夹 id。
 */
import type { DtMenuItem } from '@dt/contracts'

import type { TwinEntityKind } from './types'

/** 行菜单里「移入某夹」的值前缀，后接夹 id。 */
export const ROW_MENU_INTO_PREFIX = 'folder-into:'

/** 大纲行抛给上层的语义动作，行组件把菜单值与行内键都归到这一个口。 */
export type OutlineRowAction =
  | { type: 'select' }
  | { type: 'toggle-visible' }
  | { type: 'move'; delta: number }
  | { type: 'duplicate' }
  | { type: 'remove-request' }
  | { type: 'remove-confirm' }
  | { type: 'remove-cancel' }
  | { type: 'folder-into'; folderId: string }
  | { type: 'folder-out' }
  | { type: 'folder-new' }

/** 行菜单的输入。 */
export interface OutlineRowMenuContext {
  /** 搜索态：上移/下移禁用（重排会改文档序，搜索视图里看不出挪去了哪）。 */
  searching: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  /** 同段全部夹；行已在的那个夹不再生成「移入」项。 */
  folders: readonly { id: string; label: string }[]
  /** 行当前所在夹；null = 散行。 */
  folderId: string | null
}

/** 大纲行的「⋯」菜单。 */
export function outlineRowMenu(context: OutlineRowMenuContext): DtMenuItem[] {
  const suffix = context.searching ? '（搜索中不能重排）' : ''
  const items: DtMenuItem[] = [
    {
      value: 'move-up',
      label: `上移${suffix}`,
      icon: 'chevron-up',
      disabled: context.searching || !context.canMoveUp,
    },
    {
      value: 'move-down',
      label: `下移${suffix}`,
      icon: 'chevron-down',
      disabled: context.searching || !context.canMoveDown,
    },
    { value: 'duplicate', label: '复制', icon: 'copy' },
  ]
  for (const folder of context.folders) {
    if (folder.id === context.folderId) continue
    items.push({
      value: `${ROW_MENU_INTO_PREFIX}${folder.id}`,
      label: `移入「${folder.label}」`,
      icon: 'folder',
    })
  }
  if (context.folderId !== null) {
    items.push({
      value: 'folder-out',
      label: '移出文件夹',
      icon: 'folder-open',
    })
  }
  items.push({ value: 'folder-new', label: '新建文件夹并移入', icon: 'folder' })
  items.push({ value: 'remove', label: '删除', icon: 'trash', danger: true })
  return items
}

/** 段头的「⋯」菜单；parts 段把新增与批量建也并进来。 */
export function outlineSectionMenu(
  kind: TwinEntityKind,
  title: string,
): DtMenuItem[] {
  const items: DtMenuItem[] = []
  if (kind === 'parts') {
    items.push({ value: 'add', label: `新增${title}`, icon: 'plus' })
    items.push({ value: 'bulk-add', label: '从模型节点批量建', icon: 'layers' })
  }
  items.push({ value: 'folder-new', label: '新建文件夹', icon: 'folder' })
  return items
}

/** 夹头的「⋯」菜单。删夹不删成员，文案里写明。 */
export const OUTLINE_FOLDER_MENU: readonly DtMenuItem[] = [
  { value: 'rename', label: '重命名', icon: 'pencil' },
  {
    value: 'remove',
    label: '删除文件夹（不删里面的实体）',
    icon: 'trash',
    danger: true,
  },
]
