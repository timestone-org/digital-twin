/**
 * @fileoverview 契约：十二个手势落点各自落到文档态与选中态上。
 *
 * ⚠ 一切改动都要经调用方给的 `commit`：绕开它写的那一笔不会重派绑定，而界面上一切
 * 照旧，只是那之后每一条绑定都接错了对象。
 * ⚠ 连线没有自己的位置（两端定住它），方向键对连线那条轴必须**一步不动**——挪它得去
 * 挪两端的节点。挪了的表现是连线端点凭空偏移，而图上看不出是谁挪的。
 * ⚠ 剪切要先打包再删：反过来的话载荷里就少了跟着走的那几条线，粘回来是一堆互不
 * 相连的节点，而这一步零报错。
 * ⚠ 剪贴板这一族有**两条轴**：正编着一份节点样式、且图元树上选着一枚时对着图元，
 * 否则对着画布。判据只有一处，图元树上那两枚键与 ⌘C / ⌘V 走的是同一支——各写一份的
 * 话，键盘与鼠标会在同一份样式上粘出两种结果，而两边都不报错。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dPrim } from '@dt/twin2d'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createTwin2dCommands } from '@/pages/Twin2dEditor/scripts/editorCommands'
import { createTwin2dSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'
import type { Twin2dEditorSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'

const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 10 },
  styles: [
    {
      id: 'st',
      prims: [
        { id: 'p1', kind: 'box', children: [{ id: 'p2', kind: 'txt' }] },
        { id: 'p3', kind: 'vec' },
      ],
    },
  ],
  nodes: [
    { id: 'n1', styleId: 'st', x: 100, y: 100 },
    { id: 'n2', styleId: 'st', x: 300, y: 100 },
  ],
  edges: [{ id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } }],
  marks: [{ id: 'm1', kind: 'rect', x: 10, y: 20, w: 30, h: 40 }],
})

/** 一台装好的手势，加它写出去的那几份配置。 */
interface Rig {
  selection: Twin2dEditorSelection
  commands: ReturnType<typeof createTwin2dCommands>
  commits: Twin2dConfig[]
  save: ReturnType<typeof vi.fn>
  undo: ReturnType<typeof vi.fn>
  redo: ReturnType<typeof vi.fn>
  /** 图元树上选中的那一枚；页面上是同一只 ref。 */
  selectedPrim: ReturnType<typeof ref<string>>
  /** 最后一次写出去的配置；一次都没写就是初始那份。 */
  now: () => Twin2dConfig
}

/**
 * 装一台；`commit` 之后的配置成为下一次动作的输入，与页面上那条链一致。
 * @param initial 起手的配置
 */
function rigOf(initial: Twin2dConfig = CONFIG): Rig {
  const commits: Twin2dConfig[] = []
  const selection = createTwin2dSelection()
  const save = vi.fn()
  const undo = vi.fn()
  const redo = vi.fn()
  const now = (): Twin2dConfig => commits.at(-1) ?? initial
  const selectedPrim = ref('')
  const commands = createTwin2dCommands({
    config: now,
    selection,
    commit: (next) => commits.push(next),
    undo,
    redo,
    save,
    selectedPrim: () => selectedPrim.value,
    pickPrim: (primId) => {
      selectedPrim.value = primId
    },
  })
  return { selection, commands, commits, save, undo, redo, selectedPrim, now }
}

/** 当下那份样式的图元树。 */
function primsOf(rig: Rig): readonly Twin2dPrim[] {
  return rig.now().styles[0]?.prims ?? []
}

/** 一棵图元树上的全部 id（含各层子树），文档序。 */
function primIdsOf(prims: readonly Twin2dPrim[]): string[] {
  return prims.flatMap((prim) => [
    prim.id,
    ...(prim.kind === 'box' ? primIdsOf(prim.children) : []),
  ])
}

/**
 * 进入「正编着一份节点样式、树上选着一枚」那条轴。
 * @param rig 装好的这一台
 * @param primId 树上选中的那一枚
 */
function editingStyle(rig: Rig, primId: string): void {
  rig.selection.focusStyle('styles', 'st')
  rig.selectedPrim.value = primId
}

beforeEach(() => {
  localStorage.clear()
})

describe('三个直通的落点', () => {
  it('保存、撤销、重做原样转给页面', () => {
    const rig = rigOf()

    rig.commands.handlers.save()
    rig.commands.handlers.undo()
    rig.commands.handlers.redo()

    expect(rig.save).toHaveBeenCalledTimes(1)
    expect(rig.undo).toHaveBeenCalledTimes(1)
    expect(rig.redo).toHaveBeenCalledTimes(1)
  })
})

describe('删除与全选', () => {
  it('删掉选中的那一批节点，挂在上头的连线跟着走', () => {
    const rig = rigOf()
    rig.selection.select('nodes', 'n1')

    rig.commands.handlers.remove()

    expect(rig.now().nodes.map((node) => node.id)).toEqual(['n2'])
    expect(rig.now().edges).toHaveLength(0)
  })

  it('选中的是标注就删标注', () => {
    const rig = rigOf()
    rig.selection.select('marks', 'm1')

    rig.commands.handlers.remove()

    expect(rig.now().marks).toHaveLength(0)
  })

  it('选中的是连线就只删那条线', () => {
    const rig = rigOf()
    rig.selection.select('edges', 'e1')

    rig.commands.handlers.remove()

    expect(rig.now().edges).toHaveLength(0)
    expect(rig.now().nodes).toHaveLength(2)
  })

  it('一个都没选时全选落到节点上', () => {
    const rig = rigOf()

    rig.commands.handlers.selectAll()

    expect(rig.selection.idsOf('nodes')).toEqual(['n1', 'n2'])
  })

  it('已经停在标注那条轴上时全选选的是标注', () => {
    const rig = rigOf()
    rig.selection.select('marks', 'm1')

    rig.commands.handlers.selectAll()

    expect(rig.selection.idsOf('marks')).toEqual(['m1'])
  })
})

describe('方向键微调', () => {
  it('选中的节点整体平移', () => {
    const rig = rigOf()
    rig.selection.selectMany('nodes', ['n1', 'n2'], false)

    rig.commands.handlers.nudge({ x: 10, y: -10 })

    expect(rig.now().nodes.map((node) => node.x)).toEqual([110, 310])
    expect(rig.now().nodes[0]?.y).toBe(90)
  })

  it('标注那条轴两端一起挪', () => {
    const rig = rigOf()
    rig.selection.select('marks', 'm1')

    rig.commands.handlers.nudge({ x: 5, y: 5 })

    expect(rig.now().marks[0]?.x).toBe(15)
    expect(rig.now().marks[0]?.y).toBe(25)
  })

  // ⚠ 连线的位置由两端定住，自己挪不了
  it('连线那条轴一步不动，也不白记一帧', () => {
    const rig = rigOf()
    rig.selection.select('edges', 'e1')

    rig.commands.handlers.nudge({ x: 10, y: 0 })

    expect(rig.commits).toEqual([CONFIG])
  })
})

describe('复制、剪切与粘贴', () => {
  it('再制一批节点，选中转到副本上', () => {
    const rig = rigOf()
    rig.selection.select('nodes', 'n1')

    rig.commands.handlers.duplicate()

    expect(rig.now().nodes).toHaveLength(3)
    expect(rig.selection.idsOf('nodes')).not.toContain('n1')
  })

  it('复制之后粘一份，节点数加一', () => {
    const rig = rigOf()
    rig.selection.select('nodes', 'n1')

    rig.commands.handlers.copy()
    rig.commands.handlers.paste()

    expect(rig.now().nodes).toHaveLength(3)
    expect(rig.selection.idsOf('nodes')).toHaveLength(1)
  })

  it('剪切先打包再删，粘回来还是那一个', () => {
    const rig = rigOf()
    rig.selection.select('nodes', 'n1')

    rig.commands.handlers.cut()
    expect(rig.now().nodes).toHaveLength(1)

    rig.commands.handlers.paste()
    expect(rig.now().nodes).toHaveLength(2)
  })

  it('剪贴板空着时粘贴一步不动', () => {
    const rig = rigOf()

    rig.commands.handlers.paste()

    expect(rig.commits).toHaveLength(0)
  })

  it('一条都没选中时复制不写剪贴板', () => {
    const rig = rigOf()

    rig.commands.handlers.copy()
    rig.commands.handlers.paste()

    expect(rig.commits).toHaveLength(0)
  })

  it('一条都没选中时剪切一步不动', () => {
    const rig = rigOf()

    rig.commands.handlers.cut()

    expect(rig.commits).toHaveLength(0)
  })
})

describe('Esc 与工具', () => {
  it('Esc 清掉画布那条选中', () => {
    const rig = rigOf()
    rig.selection.select('nodes', 'n1')

    rig.commands.handlers.escape()

    expect(rig.selection.pick.value).toBeNull()
  })

  it('数字键切工具', () => {
    const rig = rigOf()
    expect(rig.commands.tool.value).toBe('select')

    rig.commands.handlers.selectTool('link')

    expect(rig.commands.tool.value).toBe('link')
  })
})

describe('配置还没读出来', () => {
  it('每一支都一步不动', () => {
    const commits: Twin2dConfig[] = []
    const selection = createTwin2dSelection()
    const commands = createTwin2dCommands({
      config: () => null,
      selection,
      commit: (next) => commits.push(next),
      undo: vi.fn(),
      redo: vi.fn(),
      save: vi.fn(),
      selectedPrim: () => 'p1',
      pickPrim: vi.fn(),
    })

    commands.handlers.copy()
    commands.handlers.cut()
    commands.handlers.paste()
    commands.handlers.duplicate()
    commands.handlers.remove()
    commands.handlers.selectAll()
    commands.handlers.nudge({ x: 1, y: 1 })

    expect(commits).toHaveLength(0)
    expect(selection.pick.value).toBeNull()
  })
})

describe('图元这条轴', () => {
  it('复制一枚再粘一份，树上多一枚且 id 不撞', () => {
    const rig = rigOf()
    editingStyle(rig, 'p3')

    rig.commands.handlers.copy()
    rig.commands.handlers.paste()

    const ids = primIdsOf(primsOf(rig))
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    expect(ids.slice(0, 3)).toEqual(['p1', 'p2', 'p3'])
  })

  // ⚠ 只换根那一枚的话，同 id 的两枚会被归一化按同层去重丢掉一枚，而变体补丁又都按
  // id 寻址，于是「粘出来的那份」会跟着原件一起变——三处都零报错
  it('子树里每一枚都重新发号，一个原 id 都不留', () => {
    const rig = rigOf()
    editingStyle(rig, 'p1')

    rig.commands.handlers.copy()
    rig.commands.handlers.paste()

    const ids = primIdsOf(primsOf(rig))
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    expect(ids.slice(3)).not.toContain('p2')
  })

  it('粘完把选中转到副本上，接着就能改它', () => {
    const rig = rigOf()
    editingStyle(rig, 'p3')

    rig.commands.handlers.copy()
    rig.commands.handlers.paste()

    const ids = primIdsOf(primsOf(rig))
    expect(rig.selectedPrim.value).toBe(ids.at(-1))
    expect(rig.selectedPrim.value).not.toBe('p3')
  })

  it('剪切把那一枚从树上摘走，选中跟着清掉', () => {
    const rig = rigOf()
    editingStyle(rig, 'p3')

    rig.commands.handlers.cut()

    expect(primIdsOf(primsOf(rig))).toEqual(['p1', 'p2'])
    expect(rig.selectedPrim.value).toBe('')
  })

  it('剪切之后粘得回来', () => {
    const rig = rigOf()
    editingStyle(rig, 'p3')
    rig.commands.handlers.cut()

    rig.commands.handlers.paste()

    expect(primIdsOf(primsOf(rig))).toHaveLength(3)
  })

  // ⚠ 图元载荷落不进画布：认错了只会往文档里塞一堆归一化随后丢掉的东西，而界面上
  // 一声不吭
  it('图元载荷粘不进画布：退出样式编辑之后按粘贴一步不动', () => {
    const rig = rigOf()
    editingStyle(rig, 'p3')
    rig.commands.handlers.copy()
    rig.selection.clearStyleFocus()
    const before = rig.commits.length

    rig.commands.handlers.paste()

    expect(rig.commits).toHaveLength(before)
  })

  it('没在编样式时复制的是画布上选中的那一批', () => {
    const rig = rigOf()
    rig.selectedPrim.value = 'p3'
    rig.selection.select('nodes', 'n1')

    rig.commands.handlers.copy()
    rig.commands.handlers.paste()

    expect(rig.now().nodes).toHaveLength(3)
    expect(primIdsOf(primsOf(rig))).toEqual(['p1', 'p2', 'p3'])
  })

  it('树上一枚都没选时复制的也是画布上那一批', () => {
    const rig = rigOf()
    editingStyle(rig, '')
    rig.selection.select('nodes', 'n1')

    rig.commands.handlers.copy()
    rig.commands.handlers.paste()

    expect(rig.now().nodes).toHaveLength(3)
  })

  // ⚠ 连线样式没有图元树：算进来的话在连线样式面上按粘贴会往一份根本画不出图元的
  // 样式里塞东西
  it('编的是连线样式时不算图元这条轴', () => {
    const rig = rigOf()
    rig.selection.focusStyle('edgeStyles', 'flow')
    rig.selectedPrim.value = 'p3'
    rig.selection.select('nodes', 'n1')

    rig.commands.handlers.copy()
    rig.commands.handlers.paste()

    expect(rig.now().nodes).toHaveLength(3)
  })

  it('编的那份样式已经不在了就一步不动', () => {
    const rig = rigOf()
    rig.selection.focusStyle('styles', 'ghost')
    rig.selectedPrim.value = 'p3'

    rig.commands.handlers.copy()
    rig.commands.handlers.cut()

    expect(rig.commits).toHaveLength(0)
  })
})
