/**
 * @fileoverview 编辑器快捷键清单，帮助面板的单一真源。集中在此而不写死在
 * 弹窗模板里，是为了让「修饰键随平台变形」可被单测钉住。
 */

/** 修饰键显示名：Mac 系用 ⌘，其余平台用 Ctrl。按 platform 串判定，不碰 DOM。 */
export function modLabel(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl'
}

export interface ShortcutItem {
  /** 按平台替换过修饰键的组合展示串。 */
  keys: string
  desc: string
}

export interface ShortcutGroup {
  title: string
  items: ShortcutItem[]
}

/** 全量手势清单；`mod` 由 `modLabel` 决定。 */
export function shortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      title: '文件',
      items: [
        { keys: `${mod} S`, desc: '保存大屏' },
        { keys: '?  /  F1', desc: '打开本帮助' },
      ],
    },
    {
      title: '编辑',
      items: [
        { keys: `${mod} Z`, desc: '撤销' },
        { keys: `${mod} ⇧ Z  /  ${mod} Y`, desc: '重做' },
        { keys: `${mod} C`, desc: '复制选中节点' },
        { keys: `${mod} V`, desc: '粘贴（选中容器时粘入其中）' },
        { keys: `${mod} D`, desc: '再制选中节点' },
        { keys: 'Delete  /  ⌫', desc: '删除选中节点' },
      ],
    },
    {
      title: '选择',
      items: [
        { keys: `${mod} A`, desc: '全选顶层节点' },
        { keys: 'Shift 点击', desc: '累积多选（图层树同样适用）' },
        { keys: '空白处拖拽', desc: '框选' },
        { keys: 'Esc', desc: '取消选中 / 关闭菜单与预览' },
      ],
    },
    {
      title: '画布',
      items: [
        { keys: '方向键', desc: '按吸附步进微调位置' },
        { keys: 'Alt 方向键', desc: '1px 精调（临时忽略吸附）' },
        { keys: 'Alt 拖拽', desc: '临时自由放置（不吸附、不认参考线）' },
        { keys: '双击图层名', desc: '重命名节点' },
      ],
    },
    {
      title: '缩放 / 平移',
      items: [
        { keys: `${mod} +  /  ${mod} -`, desc: '画布逐档放大 / 缩小' },
        { keys: `${mod} 0`, desc: '画布 1:1（100%）' },
        { keys: `${mod} ⇧ 0`, desc: '回到适应窗口' },
        { keys: `${mod} 滚轮`, desc: '以指针为锚点缩放画布' },
        { keys: '空格 拖拽  /  中键拖拽', desc: '平移画布' },
      ],
    },
  ]
}
