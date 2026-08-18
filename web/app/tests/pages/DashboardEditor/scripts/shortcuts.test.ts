/**
 * @fileoverview 快捷键清单契约：修饰键随平台变形、清单里没有空组。
 */
import { describe, expect, it } from 'vitest'

import {
  modLabel,
  shortcutGroups,
} from '@/pages/DashboardEditor/scripts/shortcuts'

describe('修饰键', () => {
  it('Mac 系是 ⌘，其余是 Ctrl', () => {
    expect(modLabel('MacIntel')).toBe('⌘')
    expect(modLabel('iPhone')).toBe('⌘')
    expect(modLabel('Win32')).toBe('Ctrl')
    expect(modLabel('Linux x86_64')).toBe('Ctrl')
  })
})

describe('清单', () => {
  it('每组非空且组合串都吃到了修饰键替换', () => {
    const groups = shortcutGroups('⌘')
    expect(groups.length).toBeGreaterThanOrEqual(5)
    for (const group of groups) {
      expect(group.items.length).toBeGreaterThan(0)
    }
    const all = groups.flatMap((group) => group.items.map((item) => item.keys))
    expect(all.some((keys) => keys.includes('⌘'))).toBe(true)
    expect(all.some((keys) => keys.includes('Ctrl'))).toBe(false)
  })

  it('保存与撤销这两条底线手势在清单里', () => {
    const all = shortcutGroups('Ctrl')
      .flatMap((group) => group.items)
      .map((item) => `${item.keys} ${item.desc}`)
      .join('\n')
    expect(all).toContain('Ctrl S')
    expect(all).toContain('撤销')
  })
})
