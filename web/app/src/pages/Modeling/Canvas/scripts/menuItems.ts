/**
 * @fileoverview 画布右键菜单的条目表：按当前状态算出分组、文案、快捷键提示与置灰。
 *
 * 判定收在纯函数里而不是组件内，是为了让「什么时候该置灰」可被单测钉住。
 * ⚠ 对齐那一组只在**选中两张以上**时才摆出来：常摆着的话，一张卡片上右键会
 * 弹出一列点了没反应的灰条，而右键菜单是用户找功能的地方。
 */
import { ALIGN_KINDS } from './nodeLayout'
import type { AlignKind } from './nodeLayout'

/** 一条菜单项对应的动作。 */
export type MenuAction =
  | 'config'
  | 'result'
  | 'rename'
  | 'copy'
  | 'duplicate'
  | 'paste'
  | 'disconnect'
  | 'select-all'
  | 'auto-layout'
  | 'fit'
  | 'remove'
  | `align:${AlignKind}`
  | 'spread:x'
  | 'spread:y'

export interface MenuEntry {
  action: MenuAction
  label: string
  /** 快捷键展示串；没有绑定快捷键的给空串。 */
  keys: string
  disabled: boolean
  /** 删除这类不可逆动作，渲染成危险色。 */
  danger: boolean
}

/** 一组菜单项；组与组之间画一条分隔线。 */
export interface MenuGroup {
  key: string
  items: readonly MenuEntry[]
}

/** 算条目要看的全部状态。 */
export interface MenuInput {
  /** 右键落在哪个节点上；落在别处为 null。 */
  nodeId: string | null
  /** 右键落在哪条边上；落在别处为 null。 */
  edgeId: string | null
  /** 选中的节点张数——对齐与分布按它开关。 */
  selectedCount: number
  /** 这个节点上有没有接进来的线。 */
  hasIncoming: boolean
  /** 这个节点有没有结果可看。 */
  hasResult: boolean
  canPaste: boolean
  hasNodes: boolean
  /** 只读时除了「看结果」与「适应视图」之外一律置灰。 */
  isReadonly: boolean
  /** 修饰键展示名（⌘ 或 Ctrl）。 */
  mod: string
}

const ALIGN_LABELS: Record<AlignKind, string> = {
  left: '左对齐',
  'center-x': '水平居中',
  right: '右对齐',
  top: '顶对齐',
  'center-y': '垂直居中',
  bottom: '底对齐',
}

function entry(
  action: MenuAction,
  label: string,
  over: Partial<Omit<MenuEntry, 'action' | 'label'>> = {},
): MenuEntry {
  return {
    action,
    label,
    keys: over.keys ?? '',
    disabled: over.disabled ?? false,
    danger: over.danger ?? false,
  }
}

/** 「打开」组：只在右键落在节点上时才有。 */
function openGroup(input: MenuInput): MenuGroup | null {
  if (input.nodeId === null) return null
  return {
    key: 'open',
    items: [
      entry('config', '参数', { keys: '双击', disabled: input.isReadonly }),
      entry('result', '结果', { disabled: !input.hasResult }),
    ],
  }
}

/** 对齐与分布。选中不足两张时整组不出现。 */
function alignGroup(input: MenuInput): MenuGroup | null {
  if (input.selectedCount < 2 || input.isReadonly) return null
  const spread = input.selectedCount < 3
  return {
    key: 'align',
    items: [
      ...ALIGN_KINDS.map((kind) => entry(`align:${kind}`, ALIGN_LABELS[kind])),
      entry('spread:x', '水平等距', { disabled: spread }),
      entry('spread:y', '垂直等距', { disabled: spread }),
    ],
  }
}

/** 编辑组：改名、剪贴板、断线。 */
function editGroup(input: MenuInput): MenuGroup {
  const locked = input.isReadonly
  const onNode = input.nodeId !== null
  return {
    key: 'edit',
    items: [
      entry('rename', '改名', {
        keys: 'F2',
        disabled: locked || !onNode,
      }),
      entry('copy', '复制', {
        keys: `${input.mod}C`,
        disabled: input.selectedCount === 0,
      }),
      entry('duplicate', '再制', {
        keys: `${input.mod}D`,
        disabled: locked || input.selectedCount === 0,
      }),
      entry('paste', '粘贴', {
        keys: `${input.mod}V`,
        disabled: locked || !input.canPaste,
      }),
      entry('disconnect', '断开接进来的线', {
        disabled: locked || !onNode || !input.hasIncoming,
      }),
    ],
  }
}

/** 画布组：整体性的那几个动作。 */
function canvasGroup(input: MenuInput): MenuGroup {
  return {
    key: 'canvas',
    items: [
      entry('select-all', '全选', {
        keys: `${input.mod}A`,
        disabled: !input.hasNodes,
      }),
      entry('auto-layout', '一键整理', {
        disabled: input.isReadonly || !input.hasNodes,
      }),
      entry('fit', '适应视图', { disabled: !input.hasNodes }),
    ],
  }
}

/** 删除。落在边上时删的是那条线，落在节点上时删的是整份选中。 */
function removeGroup(input: MenuInput): MenuGroup | null {
  if (input.isReadonly) return null
  if (input.edgeId === null && input.selectedCount === 0) return null
  return {
    key: 'remove',
    items: [
      entry('remove', input.edgeId === null ? '删除' : '删掉这条线', {
        keys: 'Delete',
        danger: true,
      }),
    ],
  }
}

/** 当前该摆哪些菜单项。空组会被丢掉，于是不会画出孤零零的分隔线。 */
export function groupsFor(input: MenuInput): MenuGroup[] {
  const groups = [
    openGroup(input),
    alignGroup(input),
    editGroup(input),
    canvasGroup(input),
    removeGroup(input),
  ]
  return groups.filter(
    (group): group is MenuGroup => group !== null && group.items.length > 0,
  )
}
