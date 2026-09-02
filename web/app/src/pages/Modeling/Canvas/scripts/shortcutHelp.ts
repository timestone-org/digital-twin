/**
 * @fileoverview 快捷键清单。
 *
 * ⚠ 与 `useCanvasShortcuts` / `menuItems` 是同一批键的**三处表述**：这里是给人看的
 * 说明，那两处是真实绑定与菜单里的提示。改了绑定要一起改这里——一份对不上的说明
 * 比没有说明更糟。
 */

export interface ShortcutRow {
  keys: string
  desc: string
}

export interface ShortcutSection {
  title: string
  rows: readonly ShortcutRow[]
}

/**
 * 按平台把修饰键换成 ⌘ 或 Ctrl。
 *
 * @param mod 修饰键的显示名，由 `modLabel(navigator.platform)` 给
 */
export function shortcutSections(mod: string): ShortcutSection[] {
  return [
    {
      title: '摆放',
      rows: [
        { keys: '拖动算子', desc: '从左边的面板拖到画布上，落在指哪的位置' },
        { keys: '拖动卡片', desc: '挪位置；靠近别的卡片会吸上去并画参考线' },
        { keys: '按住 Alt 拖', desc: '平移画布（中键拖也一样）' },
        { keys: '方向键', desc: '微调选中的卡片；按住 Shift 走一大格' },
        { keys: '空白处拖', desc: '框选' },
      ],
    },
    {
      title: '连线',
      rows: [
        { keys: '从圆点拖出', desc: '松手落在下游卡片上就连上，不必对准圆点' },
        { keys: '反向拖', desc: '从入口往回拉到上游的出口，一样连得上' },
        {
          keys: '点线 + Delete',
          desc: '删掉一条线；选中后线中间也有一颗删除键',
        },
      ],
    },
    {
      title: '编辑',
      rows: [
        { keys: `${mod}Z / ${mod}⇧Z`, desc: '撤销 / 重做' },
        { keys: `${mod}A`, desc: '全选' },
        {
          keys: `${mod}C / ${mod}V`,
          desc: '复制 / 粘贴（可粘到别的流水线里）',
        },
        { keys: `${mod}D`, desc: '就地再制一份' },
        { keys: 'Delete', desc: '删掉选中的卡片与线' },
        { keys: 'F2', desc: '给这一步改名' },
        { keys: 'Enter / 双击', desc: '打开参数' },
        { keys: 'Esc', desc: '取消选中' },
      ],
    },
    {
      title: '整理',
      rows: [
        { keys: '选中 ≥2 张后右键', desc: '六向对齐；≥3 张时还能等距分布' },
        { keys: '右键 → 一键整理', desc: '按数据流方向把整张图重排' },
        { keys: '滚轮', desc: '以指针为锚缩放；右下角有比例与「适应视图」' },
      ],
    },
  ]
}
