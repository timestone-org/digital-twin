/**
 * @fileoverview 浮在世界坐标之外的那三样东西的定位，以及快捷键说明与真实绑定
 * 对不对得上。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import {
  ghostStyleOf,
  guideStylesOf,
  marqueeStyleOf,
} from '@/pages/Modeling/Canvas/scripts/overlayStyles'
import { shortcutSections } from '@/pages/Modeling/Canvas/scripts/shortcutHelp'
import type { ShortcutActions } from '@/pages/Modeling/Canvas/scripts/useCanvasShortcuts'
import { useCanvasShortcuts } from '@/pages/Modeling/Canvas/scripts/useCanvasShortcuts'

const VIEWPORT = { left: 30, top: 10, zoom: 2 }

describe('浮层定位', () => {
  // ⚠ 这三样不跟着世界坐标那层 transform 走，所以要自己乘一次缩放
  it('框选框按当前缩放换算，起点终点反过来画也一样', () => {
    const style = marqueeStyleOf(
      VIEWPORT,
      { left: 100, top: 50 },
      { left: 0, top: 0 },
    )

    expect(style['left']).toBe('30px')
    expect(style['top']).toBe('10px')
    expect(style['width']).toBe('200px')
    expect(style['height']).toBe('100px')
  })

  it('竖参考线只定 left，横参考线只定 top', () => {
    const styles = guideStylesOf(VIEWPORT, [
      { axis: 'x', at: 10 },
      { axis: 'y', at: 20 },
    ])

    expect(styles[0]?.isVertical).toBe(true)
    expect(styles[0]?.style).toEqual({ left: '50px' })
    expect(styles[1]?.style).toEqual({ top: '50px' })
  })

  it('落件预览框把光标放在框正中', () => {
    const style = ghostStyleOf(VIEWPORT, { left: 112, top: 34 })

    expect(style['left']).toBe('30px')
    expect(style['top']).toBe('10px')
  })
})

describe('快捷键说明与真实绑定对得上', () => {
  /** 说明里出现的全部「修饰键 + 一个字母」组合。 */
  function listedKeys(): string[] {
    const found = new Set<string>()
    for (const section of shortcutSections('⌘')) {
      for (const row of section.rows) {
        for (const hit of row.keys.matchAll(/⌘(⇧)?([A-Z])/g)) {
          found.add(`${hit[1] ?? ''}${hit[2] ?? ''}`)
        }
      }
    }
    return [...found]
  }

  function actions(): ShortcutActions {
    return {
      removeSelected: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      clearSelection: vi.fn(),
      selectAll: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      duplicate: vi.fn(),
      rename: vi.fn(),
      openConfig: vi.fn(),
      fit: vi.fn(),
      nudge: vi.fn(),
      canEdit: () => true,
    }
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  // ⚠ 说明、绑定、右键菜单里的提示是同一批键的三处表述。一份对不上的说明比
  // 没有说明更糟——这条用例就是那个对照
  it('说明里写的每一个组合都真的绑了动作', () => {
    const hooks = actions()
    mount(
      defineComponent({
        setup() {
          useCanvasShortcuts(hooks)
          return () => h('div')
        },
      }),
    )
    const before = Object.values(hooks).filter(
      (item) => typeof item === 'function' && 'mock' in item,
    ).length

    for (const combo of listedKeys()) {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: combo.replace('⇧', ''),
          metaKey: true,
          shiftKey: combo.includes('⇧'),
          cancelable: true,
        }),
      )
    }

    const fired = [
      hooks.undo,
      hooks.redo,
      hooks.selectAll,
      hooks.copy,
      hooks.paste,
      hooks.duplicate,
    ].filter((item) => vi.isMockFunction(item) && item.mock.calls.length > 0)
    expect(before).toBeGreaterThan(0)
    expect(fired).toHaveLength(6)
  })

  it('说明里列的组合恰好是这六个，加了绑定别忘了写说明', () => {
    expect(listedKeys().sort()).toEqual(['A', 'C', 'D', 'V', 'Z', '⇧Z'])
  })
})
