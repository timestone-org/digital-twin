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
// ⚠ `import type` 会被 TypeScript 整条擦除，产物里一个字节都不留，故它进不了
// 任何 chunk。值导入才是这条闸真正要拦的东西。
const VALUE_IMPORT = /^\s*import\s+(?!type\s)[\s\S]*?from\s*'[^']+'/gm

function specifiersOf(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map(
    (match) => match.groups?.target ?? '',
  )
}

describe('注入接缝的依赖面', () => {
  it('host.ts 没有任何**值**导入', () => {
    // 这条守的是「启动期从这里进不会拖进运行时代码」。`import type` 编译期就
    // 被整条擦掉，进不了任何 chunk，故放行；值导入一律不许——它会跟着
    // 启动图一路走进首屏 chunk，而超预算是在 build 之后才发现的
    expect([...HOST_SOURCE.matchAll(VALUE_IMPORT)]).toEqual([])
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
