/**
 * @fileoverview 锁住图标注册契约。
 * ⚠ 传给 DtIcon 一个未登记的名字，typecheck 与 lint 双双放行、控制台无声，
 * 图标位置只是空着。这个文件是它唯一的防线。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtIcon from '../../src/components/DtIcon/DtIcon.vue'
import { ICONS, isIconName } from '../../src/components/DtIcon/registry'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const WORKSPACE = process.cwd()
const SEARCH_ROOTS = ['app/src', 'packages']
// 只收字面量 name；`:name="expr"` 是绑定，取值在运行时才知道，扫不到也不该扫
const NAME_PATTERN = /(?<![:\w-])name="([a-z0-9-]+)"/g

function collectVueFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...collectVueFiles(full))
    } else if (entry.endsWith('.vue')) {
      found.push(full)
    }
  }
  return found
}

/** 扫出模板里所有 `<DtIcon name="...">` 的字面量名字。 */
function usedIconNames(): Map<string, string[]> {
  const usage = new Map<string, string[]>()
  for (const root of SEARCH_ROOTS) {
    for (const file of collectVueFiles(join(WORKSPACE, root))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<DtIcon\b[^>]*>/g)) {
        for (const name of match[0].matchAll(NAME_PATTERN)) {
          const key = name[1] as string
          usage.set(key, [...(usage.get(key) ?? []), file])
        }
      }
    }
  }
  return usage
}

describe('图标注册表', () => {
  it('模板里用到的每个字面量名字都已登记', () => {
    const unregistered = [...usedIconNames().entries()].filter(
      ([name]) => !isIconName(name),
    )
    expect(unregistered).toEqual([])
  })

  it('每个图标至少有一条路径', () => {
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0)
    }
  })
})

describe('DtIcon', () => {
  it('登记过的名字渲染出对应数量的 path', () => {
    const wrapper = mount(DtIcon, { props: { name: 'user' } })
    expect(wrapper.findAll('path')).toHaveLength(ICONS.user.length)
  })

  it('未登记的名字什么都不渲染，也不抛错', () => {
    const wrapper = mount(DtIcon, { props: { name: 'no-such-icon' } })
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('尺寸落到 width / height 上', () => {
    const wrapper = mount(DtIcon, { props: { name: 'user', size: 32 } })
    expect(wrapper.find('svg').attributes('width')).toBe('32')
  })

  it('非法尺寸回退默认值而不是产出 NaN', () => {
    const wrapper = mount(DtIcon, { props: { name: 'user', size: Number.NaN } })
    expect(wrapper.find('svg').attributes('width')).toBe('18')
  })

  it('图标对读屏隐藏：它是装饰，名称由承载它的控件给', () => {
    const wrapper = mount(DtIcon, { props: { name: 'user' } })
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true')
  })
})
