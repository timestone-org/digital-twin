/**
 * @fileoverview 契约：右键菜单开在落点上、每项抛出对应动作、置灰项点不动，
 * Esc / 点菜单外 / 滚动都收起，键盘能在项间走且 Tab 不跑出菜单，
 * 且**卸载后 window 上不再留监听**——编辑器一开就是几天，漏一次就永远跟着鼠标走。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import CanvasContextMenu from '@/pages/DashboardEditor/components/CanvasContextMenu.vue'
import {
  contextMenuGroups,
  type ContextMenuAction,
  type ContextMenuInput,
} from '@/pages/DashboardEditor/scripts/contextMenuItems'
import type { ContextMenuState } from '@/pages/DashboardEditor/scripts/useEditorContextMenu'

function stateOf(
  nodeId: string | null,
  over: Partial<ContextMenuInput> = {},
): ContextMenuState {
  return {
    at: { x: 30, y: 40 },
    nodeId,
    groups: contextMenuGroups({
      nodeId,
      isNodeVisible: true,
      canForward: true,
      canBackward: true,
      canCopy: true,
      canPaste: true,
      canSelectAll: true,
      isFitted: false,
      mod: '⌘',
      subEditorLabel: '',
      ...over,
    }),
  }
}

let mounted: { unmount: () => void } | null = null

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

function mountMenu(menu: ContextMenuState | null) {
  const calls: string[] = []
  const state = ref<ContextMenuState | null>(menu)
  const host = defineComponent({
    setup() {
      return () =>
        h(CanvasContextMenu, {
          menu: state.value,
          onPick: (action: ContextMenuAction) => calls.push(`pick:${action}`),
          onClose: () => calls.push('close'),
        })
    },
  })
  const wrapper = mount(host, { attachTo: document.body })
  mounted = wrapper
  return { wrapper, calls, state }
}

function root(): HTMLElement | null {
  return document.querySelector('.dt-ctxmenu')
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

/** 文案与快捷键分在两个 span 里，两边贴边排，读出来要自己补空格。 */
function labels(): string[] {
  return items().map((item) =>
    [...item.querySelectorAll('span')]
      .map((span) => (span.textContent ?? '').trim())
      .join(' '),
  )
}

function press(key: string, shiftKey = false): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }),
  )
}

describe('开合', () => {
  it('没开着的时候 body 里一个菜单都没有', () => {
    mountMenu(null)

    expect(root()).toBeNull()
  })

  it('开着时挂在落点上，根是 role=menu，每项是 role=menuitem', () => {
    mountMenu(stateOf('a'))

    expect(root()?.getAttribute('role')).toBe('menu')
    expect(root()?.style.left).toBe('30px')
    expect(root()?.style.top).toBe('40px')
    expect(labels()).toEqual([
      '置顶 ⌘ ⇧ ]',
      '上移一层 ⌘ ]',
      '下移一层 ⌘ [',
      '置底 ⌘ ⇧ [',
      '定位到此节点',
      '复制 ⌘ C',
      '再制 ⌘ D',
      '删除 Delete',
      '隐藏本节点',
    ])
  })

  it('每一项都有可读文本与 aria-label', () => {
    mountMenu(stateOf(null))

    expect(items().map((item) => item.getAttribute('aria-label'))).toEqual([
      '粘贴',
      '全选',
      '适应窗口',
    ])
  })

  it('组与组之间画分隔线', () => {
    mountMenu(stateOf('a'))

    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(2)
  })

  it('prop 变回 null 就摘掉整个浮层', async () => {
    const { state } = mountMenu(stateOf('a'))

    state.value = null
    await nextTick()

    expect(root()).toBeNull()
  })
})

describe('动作', () => {
  it('点一项抛出它的动作', () => {
    const { calls } = mountMenu(stateOf('a'))

    items()[5]?.click()

    expect(calls).toEqual(['pick:copy'])
  })

  it('置灰的项渲染成 disabled，点不出动作', () => {
    const { calls } = mountMenu(stateOf(null, { canPaste: false }))

    const paste = items()[0]
    expect(paste?.hasAttribute('disabled')).toBe(true)
    paste?.click()

    expect(calls).toEqual([])
  })
})

describe('收起', () => {
  it('Esc 收起', () => {
    const { calls } = mountMenu(stateOf('a'))

    press('Escape')

    expect(calls).toEqual(['close'])
  })

  it('点菜单外收起，点菜单里不收起', () => {
    const { calls } = mountMenu(stateOf('a'))

    items()[0]?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(calls).toEqual([])

    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }),
    )
    expect(calls).toEqual(['close'])
  })

  it('画布一滚就收起', () => {
    const { calls } = mountMenu(stateOf('a'))

    window.dispatchEvent(new Event('scroll'))

    expect(calls).toEqual(['close'])
  })
})

describe('键盘可达', () => {
  it('开的时候焦点落在第一项，方向键在项间移动', async () => {
    mountMenu(stateOf('a'))
    await nextTick()

    expect(document.activeElement).toBe(items()[0])

    press('ArrowDown')
    expect(document.activeElement).toBe(items()[1])

    press('ArrowUp')
    expect(document.activeElement).toBe(items()[0])
  })

  it('置灰的项不进焦点环', async () => {
    mountMenu(stateOf(null, { canSelectAll: false }))
    await nextTick()

    press('ArrowDown')

    // 三项里中间那项置灰，往下一步直接到第三项
    expect(document.activeElement).toBe(items()[2])
  })

  it('Tab 在菜单里循环，不跑到菜单外', async () => {
    mountMenu(stateOf(null))
    await nextTick()

    press('Tab')
    press('Tab')
    press('Tab')

    expect(root()?.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(items()[0])
  })

  it('Shift+Tab 反着走，同样留在菜单里', async () => {
    mountMenu(stateOf(null))
    await nextTick()

    press('Tab', true)

    expect(document.activeElement).toBe(items()[2])
  })
})

describe('卸载', () => {
  it('卸载之后 Esc / 点击 / 滚动都不再抛事件', () => {
    const { wrapper, calls } = mountMenu(stateOf('a'))
    wrapper.unmount()
    mounted = null

    press('Escape')
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }),
    )
    window.dispatchEvent(new Event('scroll'))

    expect(calls).toEqual([])
  })
})
