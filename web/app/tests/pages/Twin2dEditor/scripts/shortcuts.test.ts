/**
 * @fileoverview 契约：编辑类快捷键在表单获焦时全部让位，而「表单」按**最近可交互
 * 祖先**判（含 `role=combobox` / `listbox` / `dialog`），不是只看 `activeElement.tagName`；
 * 焦点回到画布上时同一批键必须照常生效；卸载之后 window 上不许再留下键盘监听。
 *
 * ⚠ 只看 tagName 的后果不报错：用户在自定义下拉里用方向键翻选项时，画布上选中的
 * 节点会同时被挪一格并压进撤销栈——图悄悄动了，而用户以为自己只是在选下拉。
 * ⚠ 反过来写成「永远不响应」同样是一条永远绿的假用例，所以两头都要钉。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Pt, Twin2dConfig } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import type { ShallowRef } from 'vue'

import { updateNode } from '@/pages/Twin2dEditor/scripts/nodeOps'
import {
  TWIN_2D_TOOLS,
  isTwin2dFormFocused,
  twin2dNudgeOf,
  twin2dNudgeStep,
  twin2dShortcutOf,
  twin2dToolOf,
  useTwin2dShortcuts,
} from '@/pages/Twin2dEditor/scripts/shortcuts'
import type {
  Twin2dShortcutHandlers,
  Twin2dTool,
} from '@/pages/Twin2dEditor/scripts/shortcuts'

/** 一个 20 格栅格、一个节点的最小文档。 */
function makeConfig(): Twin2dConfig {
  return normalizeTwin2dConfig({
    canvas: { grid: 20 },
    styles: [{ id: 'sty', size: { w: 40, h: 20 } }],
    nodes: [{ id: 'a', styleId: 'sty', x: 100, y: 100 }],
  })
}

function keyEvent(key: string, mods: Partial<KeyboardEventInit> = {}) {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...mods })
}

/** 造一个能获焦的元素挂进 body，并让它拿到焦点。 */
function focusOn(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value)
  }
  element.setAttribute('tabindex', '0')
  document.body.appendChild(element)
  element.focus()
  return element
}

/** 造一个外壳，把焦点落在壳里那个子元素上。 */
function focusInside(role: string): HTMLElement {
  const shell = document.createElement('div')
  shell.setAttribute('role', role)
  const inner = document.createElement('button')
  shell.appendChild(inner)
  document.body.appendChild(shell)
  inner.focus()
  return inner
}

/** 装上快捷键的那个壳记下了什么。 */
interface Recorder {
  actions: string[]
  tools: Twin2dTool[]
  config: ShallowRef<Twin2dConfig>
}

/** 把每个动作都记一笔；`nudge` 真把节点挪过去，让「有没有动」能被断言。 */
function handlersOf(rec: Recorder): Twin2dShortcutHandlers {
  const note = (name: string) => () => {
    rec.actions.push(name)
  }
  return {
    save: note('save'),
    undo: note('undo'),
    redo: note('redo'),
    copy: note('copy'),
    cut: note('cut'),
    paste: note('paste'),
    duplicate: note('duplicate'),
    remove: note('remove'),
    selectAll: note('selectAll'),
    escape: note('escape'),
    nudge: (at: Pt) => {
      const node = rec.config.value.nodes[0]
      if (node === undefined) return
      rec.config.value = updateNode(rec.config.value, node.id, {
        x: node.x + at.x,
        y: node.y + at.y,
      })
    },
    selectTool: (tool) => {
      rec.tools.push(tool)
    },
  }
}

/**
 * 装过快捷键的那些壳。
 * ⚠ 不逐个卸载的话，上一条用例留下的 window 监听会在这一条里先跑一步——它把输入框
 * 的焦点收走之后，这一条自己的监听看到的就是「没有表单获焦」，于是断言测的是别人。
 */
const mounted: { unmount: () => void }[] = []

function mountShortcuts(suspended?: () => boolean) {
  const rec: Recorder = {
    actions: [],
    tools: [],
    config: shallowRef(makeConfig()),
  }
  const wrapper = mount(
    defineComponent({
      setup() {
        useTwin2dShortcuts({
          handlers: handlersOf(rec),
          grid: () => rec.config.value.canvas.grid,
          ...(suspended === undefined ? {} : { suspended }),
        })
        return () => h('div')
      },
    }),
  )
  mounted.push(wrapper)
  return { rec, wrapper }
}

/** 当前节点落在哪。 */
function nodeAt(rec: Recorder): Pt {
  const node = rec.config.value.nodes[0]
  return { x: node?.x ?? Number.NaN, y: node?.y ?? Number.NaN }
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  while (document.body.firstChild !== null) {
    document.body.removeChild(document.body.firstChild)
  }
})

describe('让位判定按最近可交互祖先', () => {
  it('焦点在下拉触发器上时算表单获焦', () => {
    focusOn('button', { role: 'combobox' })

    expect(isTwin2dFormFocused()).toBe(true)
  })

  it('焦点落在列表框里的选项上时算表单获焦', () => {
    focusInside('listbox')

    expect(isTwin2dFormFocused()).toBe(true)
  })

  it('焦点落在弹窗里的按钮上时算表单获焦', () => {
    focusInside('dialog')

    expect(isTwin2dFormFocused()).toBe(true)
  })

  it('焦点在输入框里时算表单获焦', () => {
    focusOn('input')

    expect(isTwin2dFormFocused()).toBe(true)
  })

  it('焦点在可编辑区域里时算表单获焦', () => {
    focusOn('div', { contenteditable: 'true' })

    expect(isTwin2dFormFocused()).toBe(true)
  })

  it('把 contenteditable 关掉的元素不算表单获焦', () => {
    focusOn('div', { contenteditable: 'false' })

    expect(isTwin2dFormFocused()).toBe(false)
  })

  it('焦点在画布上时不算表单获焦', () => {
    focusOn('div', { 'data-test': 'canvas' })

    expect(isTwin2dFormFocused()).toBe(false)
  })

  it('一个元素都没获焦时不算表单获焦', () => {
    expect(isTwin2dFormFocused()).toBe(false)
  })
})

describe('按键判定', () => {
  it('保存键连表单里也接管', () => {
    expect(twin2dShortcutOf(keyEvent('s', { metaKey: true }), true)).toBe(
      'save',
    )
    expect(twin2dShortcutOf(keyEvent('S', { ctrlKey: true }), true)).toBe(
      'save',
    )
  })

  it('表单获焦时编辑类手势一律让位', () => {
    const keys = ['z', 'c', 'x', 'v', 'd', 'a']
    const actions = keys.map((key) =>
      twin2dShortcutOf(keyEvent(key, { metaKey: true }), true),
    )

    expect(actions).toEqual([null, null, null, null, null, null])
    expect(twin2dShortcutOf(keyEvent('Delete'), true)).toBeNull()
    expect(twin2dShortcutOf(keyEvent('ArrowUp'), true)).toBeNull()
    expect(twin2dShortcutOf(keyEvent('1'), true)).toBeNull()
  })

  it('撤销与重做的三种写法各归各的', () => {
    expect(twin2dShortcutOf(keyEvent('z', { metaKey: true }), false)).toBe(
      'undo',
    )
    expect(
      twin2dShortcutOf(keyEvent('z', { metaKey: true, shiftKey: true }), false),
    ).toBe('redo')
    expect(twin2dShortcutOf(keyEvent('y', { ctrlKey: true }), false)).toBe(
      'redo',
    )
  })

  it('复制剪切粘贴再制全选各归各的键', () => {
    const pairs: readonly [string, string][] = [
      ['c', 'copy'],
      ['x', 'cut'],
      ['v', 'paste'],
      ['d', 'duplicate'],
      ['a', 'selectAll'],
    ]
    const got = pairs.map(([key]) =>
      twin2dShortcutOf(keyEvent(key, { ctrlKey: true }), false),
    )

    expect(got).toEqual(pairs.map(([, action]) => action))
  })

  it('Delete 与退格都是删除', () => {
    expect(twin2dShortcutOf(keyEvent('Delete'), false)).toBe('remove')
    expect(twin2dShortcutOf(keyEvent('Backspace'), false)).toBe('remove')
  })

  it('画布上的退出键收手势，表单里的不吃', () => {
    expect(twin2dShortcutOf(keyEvent('Escape'), false)).toBe('escape')
    expect(twin2dShortcutOf(keyEvent('Escape'), true)).toBeNull()
  })

  it('数字键切工具，超出工具数的那些不切', () => {
    expect(twin2dShortcutOf(keyEvent('1'), false)).toBe('selectTool')
    expect(twin2dToolOf('1')).toBe(TWIN_2D_TOOLS[0])
    expect(twin2dToolOf(String(TWIN_2D_TOOLS.length))).toBe(
      TWIN_2D_TOOLS[TWIN_2D_TOOLS.length - 1],
    )
    expect(twin2dToolOf(String(TWIN_2D_TOOLS.length + 1))).toBeNull()
    expect(twin2dToolOf('0')).toBeNull()
    expect(twin2dToolOf('ArrowUp')).toBeNull()
  })

  it('带修饰键的数字键不切工具', () => {
    expect(twin2dShortcutOf(keyEvent('1', { metaKey: true }), false)).toBeNull()
  })

  it('认不出的键不触发任何动作', () => {
    expect(twin2dShortcutOf(keyEvent('F9'), false)).toBeNull()
    expect(twin2dShortcutOf(keyEvent('q', { metaKey: true }), false)).toBeNull()
  })
})

describe('方向键步长', () => {
  it('缺省按这张图的栅格走一格', () => {
    expect(twin2dNudgeOf(keyEvent('ArrowRight'), 20)).toEqual({ x: 20, y: 0 })
    expect(twin2dNudgeOf(keyEvent('ArrowLeft'), 20)).toEqual({ x: -20, y: 0 })
    expect(twin2dNudgeOf(keyEvent('ArrowUp'), 20)).toEqual({ x: 0, y: -20 })
    expect(twin2dNudgeOf(keyEvent('ArrowDown'), 20)).toEqual({ x: 0, y: 20 })
  })

  it('按住 Alt 走 1 px，按住 Shift 走十格', () => {
    expect(twin2dNudgeStep(keyEvent('ArrowRight', { altKey: true }), 20)).toBe(
      1,
    )
    expect(
      twin2dNudgeStep(keyEvent('ArrowRight', { shiftKey: true }), 20),
    ).toBe(200)
  })

  it('Alt 与 Shift 同按时精调优先', () => {
    const event = keyEvent('ArrowRight', { altKey: true, shiftKey: true })

    expect(twin2dNudgeStep(event, 20)).toBe(1)
  })

  it('栅格取不到正数时回缺省栅格', () => {
    const event = keyEvent('ArrowRight')

    expect(twin2dNudgeStep(event, 0)).toBe(20)
    expect(twin2dNudgeStep(event, Number.NaN)).toBe(20)
    expect(twin2dNudgeStep(event, -5)).toBe(20)
  })

  it('不是方向键时算不出位移', () => {
    expect(twin2dNudgeOf(keyEvent('Delete'), 20)).toBeNull()
  })
})

describe('装上之后的实际行为', () => {
  it('焦点在画布上时方向键真把节点挪了一格', () => {
    const { rec } = mountShortcuts()
    focusOn('div', { 'data-test': 'canvas' })

    window.dispatchEvent(keyEvent('ArrowRight'))

    expect(isTwin2dFormFocused()).toBe(false)
    expect(nodeAt(rec)).toEqual({ x: 120, y: 100 })
  })

  it('焦点在下拉触发器上时方向键一步不挪节点', () => {
    const { rec } = mountShortcuts()
    focusOn('button', { role: 'combobox' })

    window.dispatchEvent(keyEvent('ArrowRight'))
    window.dispatchEvent(keyEvent('ArrowDown'))

    expect(isTwin2dFormFocused()).toBe(true)
    expect(nodeAt(rec)).toEqual({ x: 100, y: 100 })
  })

  it('焦点落在弹窗里的按钮上时方向键一步不挪节点', () => {
    const { rec } = mountShortcuts()
    focusInside('dialog')

    window.dispatchEvent(keyEvent('ArrowUp'))

    expect(nodeAt(rec)).toEqual({ x: 100, y: 100 })
  })

  it('按住 Alt 时方向键走 1 px', () => {
    const { rec } = mountShortcuts()
    focusOn('div', { 'data-test': 'canvas' })

    window.dispatchEvent(keyEvent('ArrowDown', { altKey: true }))

    expect(nodeAt(rec)).toEqual({ x: 100, y: 101 })
  })

  it('数字键把工具切过去', () => {
    const { rec } = mountShortcuts()

    window.dispatchEvent(keyEvent('3'))

    expect(rec.tools).toEqual([TWIN_2D_TOOLS[2]])
  })

  it('复制粘贴各触发一次', () => {
    const { rec } = mountShortcuts()

    window.dispatchEvent(keyEvent('c', { metaKey: true }))
    window.dispatchEvent(keyEvent('v', { metaKey: true }))

    expect(rec.actions).toEqual(['copy', 'paste'])
  })

  it('接住的键要挡掉浏览器默认动作，没接住的不挡', () => {
    mountShortcuts()
    const taken = keyEvent('z', { metaKey: true })
    const free = keyEvent('F9')

    window.dispatchEvent(taken)
    window.dispatchEvent(free)

    expect(taken.defaultPrevented).toBe(true)
    expect(free.defaultPrevented).toBe(false)
  })

  it('覆盖层打开时只剩退出键', () => {
    const { rec } = mountShortcuts(() => true)

    window.dispatchEvent(keyEvent('c', { metaKey: true }))
    window.dispatchEvent(keyEvent('ArrowRight'))
    window.dispatchEvent(keyEvent('Escape'))

    expect(rec.actions).toEqual(['escape'])
    expect(nodeAt(rec)).toEqual({ x: 100, y: 100 })
  })

  it('表单里的退出键只把焦点收走，不动选中', () => {
    const { rec } = mountShortcuts()
    const field = focusOn('input')

    window.dispatchEvent(keyEvent('Escape'))

    expect(document.activeElement).not.toBe(field)
    expect(rec.actions).toEqual([])
  })

  it('卸载之后 window 上不再有这副监听', () => {
    const { rec, wrapper } = mountShortcuts()

    mounted.pop()
    wrapper.unmount()
    window.dispatchEvent(keyEvent('c', { metaKey: true }))
    window.dispatchEvent(keyEvent('ArrowRight'))

    expect(rec.actions).toEqual([])
    expect(nodeAt(rec)).toEqual({ x: 100, y: 100 })
  })
})
