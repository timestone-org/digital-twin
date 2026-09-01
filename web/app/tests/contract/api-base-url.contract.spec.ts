/**
 * @fileoverview 接口封装里的路径**不许再写一遍服务前缀**。
 *
 * ⚠ 客户端是 `${baseUrl}${path}` 直接拼。路径里再写一遍前缀就会拼成
 * `/api/v1/platform/api/v1/platform/…`，**一律 404**，而 typecheck、lint 与打了桩
 * 的单测全都拦不住——桩收下的是调用方给的那个字符串，它对不对没人核。
 * 这一条已经在分析建模上真实发生过一次（整页取不到数）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const API_DIR = join(process.cwd(), 'app/src/api')

/** 服务前缀，与 `config/app.ts` 的常量一一对应。 */
const PREFIXES = [
  '/api/v1/auth',
  '/api/v1/platform',
  '/api/v1/assistant',
  '/api/v1/knowledge',
  '/api/v1/opcua',
  '/api/v1/realtime',
]

/** 每个封装文件里出现的路径字面量（单引号串与模板串的开头）。 */
function pathsIn(text: string): string[] {
  const found = [...text.matchAll(/(?:'|`)(\/[a-zA-Z0-9_\-./${}:]*)/g)]
  return found.map((one) => one[1] ?? '')
}

const FILES = readdirSync(API_DIR).filter((name) => name.endsWith('.ts'))

describe('接口封装的路径不重复带服务前缀', () => {
  it('确实扫到了一批封装文件', () => {
    expect(FILES.length).toBeGreaterThan(10)
  })

  it.each(FILES)('%s', (name) => {
    const text = readFileSync(join(API_DIR, name), 'utf8')
    // 只看代码，注释里写前缀是在解释这条规矩本身
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const offending = pathsIn(code).filter((path) =>
      PREFIXES.some((prefix) => path.startsWith(prefix)),
    )

    expect(offending).toEqual([])
  })
})
