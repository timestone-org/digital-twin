/**
 * @fileoverview 守「注入接缝不拖 three」这条契约：`host.ts` 是启动期代码唯一
 * 允许进来的入口，它一旦长出 import，首屏 chunk 就可能被整个 three 撑破预算。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const PACKAGE_ROOT = join(process.cwd(), 'packages', 'three-core', 'src')
const HOST_SOURCE = readFileSync(join(PACKAGE_ROOT, 'host.ts'), 'utf8')
const BARREL_SOURCE = readFileSync(join(PACKAGE_ROOT, 'index.ts'), 'utf8')
const IMPORT_SPECIFIER = /(?:import|export)[\s\S]*?from\s*'(?<target>[^']+)'/g

function specifiersOf(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map(
    (match) => match.groups?.target ?? '',
  )
}

describe('注入接缝的依赖面', () => {
  it('host.ts 一条 import 都没有', () => {
    expect(specifiersOf(HOST_SOURCE)).toEqual([])
  })

  it('host.ts 的正文里不出现 three', () => {
    expect(HOST_SOURCE.includes("'three")).toBe(false)
    expect(HOST_SOURCE.includes('"three')).toBe(false)
  })

  it('桶文件顶部写明了启动期禁止从这里进', () => {
    expect(BARREL_SOURCE.startsWith('// ⚠')).toBe(true)
    expect(BARREL_SOURCE).toContain('@dt/three-core/host')
  })

  it('桶文件确实会拖进 three，深路径才是接缝', () => {
    expect(specifiersOf(BARREL_SOURCE)).toContain('./TwinScene.vue')
    expect(specifiersOf(BARREL_SOURCE)).toContain('./host')
  })
})
