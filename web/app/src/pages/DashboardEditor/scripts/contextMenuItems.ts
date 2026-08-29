/**
 * @fileoverview 画布右键菜单的条目表：按当前状态算出分组、文案、快捷键提示与置灰。
 * 判定收在纯函数里而不是组件内，是为了让「什么时候该置灰」可被单测钉住。
 */

/** 一条菜单项对应的动作，与 `useEditorContextMenu` 的分发一一对应。 */
export type ContextMenuAction =
  | 'front'
  | 'forward'
  | 'backward'
  | 'back'
  | 'center'
  | 'copy'
  | 'duplicate'
  | 'remove'
  | 'hide'
  | 'paste'
  | 'select-all'
  | 'fit'
  | 'customize'

export interface ContextMenuEntry {
  action: ContextMenuAction
  label: string
  /** 快捷键展示串；没有绑定快捷键的给空串。 */
  keys: string
  disabled: boolean
  /** 删除这类不可逆动作，渲染成危险色。 */
  danger: boolean
}

/** 一组菜单项；组与组之间画一条分隔线。 */
export interface ContextMenuGroup {
  key: string
  items: readonly ContextMenuEntry[]
}

/** 算条目要看的全部状态。 */
export interface ContextMenuInput {
  /** 右键落在哪个节点上；落在空白处为 null。 */
  nodeId: string | null
  isNodeVisible: boolean
  /** 选中集里有可复制的根（钉位单例不算）。 */
  canCopy: boolean
  /** 目标节点上下还有没有兄弟；没有就没得挪。 */
  canForward: boolean
  canBackward: boolean
  canPaste: boolean
  canSelectAll: boolean
  /** 画布已经在「适应窗口」档。 */
  isFitted: boolean
  /** 修饰键展示名，由 `modLabel` 给。 */
  mod: string
  /**
   * 这个节点的清单声明的子编辑器入口文案；空串 = 它没有子编辑器，不摆这一条。
   * ⚠ 读**声明**不读模块类型：按类型名判的话，第三方模块与后加的模块永远拿不到
   * 这条入口，而那类判断 typecheck 与 lint 双双放行（DASHBOARD_DESIGN §5.3 陷阱 ③）。
   */
  subEditorLabel: string
}

function entry(
  action: ContextMenuAction,
  label: string,
  keys: string,
  disabled: boolean,
  danger = false,
): ContextMenuEntry {
  return { action, label, keys, disabled, danger }
}

/** 右键落在节点上：层序一组，定位/复制/再制/删除一组，再单独一组显隐切换。 */
function nodeGroups(input: ContextMenuInput): ContextMenuGroup[] {
  return [
    {
      key: 'node-order',
      items: [
        entry('front', '置顶', `${input.mod} ⇧ ]`, !input.canForward),
        entry('forward', '上移一层', `${input.mod} ]`, !input.canForward),
        entry('backward', '下移一层', `${input.mod} [`, !input.canBackward),
        entry('back', '置底', `${input.mod} ⇧ [`, !input.canBackward),
      ],
    },
    // 子编辑器排在最前：它是「进去整页改这一个」，与下面那组「在画布上摆弄它」
    // 不是一类动作
    ...(input.subEditorLabel === ''
      ? []
      : [
          {
            key: 'node-sub-editor',
            items: [entry('customize', `${input.subEditorLabel}…`, '', false)],
          },
        ]),
    {
      key: 'node',
      items: [
        entry('center', '定位到此节点', '', false),
        entry('copy', '复制', `${input.mod} C`, !input.canCopy),
        entry('duplicate', '再制', `${input.mod} D`, !input.canCopy),
        entry('remove', '删除', 'Delete', false, true),
      ],
    },
    {
      key: 'node-visibility',
      items: [
        entry(
          'hide',
          input.isNodeVisible ? '隐藏本节点' : '显示本节点',
          '',
          false,
        ),
      ],
    },
  ]
}

/** 右键落在空白处：粘贴与全选，再单独一组视图。 */
function canvasGroups(input: ContextMenuInput): ContextMenuGroup[] {
  return [
    {
      key: 'canvas',
      items: [
        entry('paste', '粘贴', `${input.mod} V`, !input.canPaste),
        entry('select-all', '全选', `${input.mod} A`, !input.canSelectAll),
      ],
    },
    {
      key: 'canvas-view',
      items: [entry('fit', '适应窗口', `${input.mod} ⇧ 0`, input.isFitted)],
    },
  ]
}

/** 按落点给菜单分组：节点上是节点组，空白处是画布组。 */
export function contextMenuGroups(
  input: ContextMenuInput,
): readonly ContextMenuGroup[] {
  return input.nodeId === null ? canvasGroups(input) : nodeGroups(input)
}
