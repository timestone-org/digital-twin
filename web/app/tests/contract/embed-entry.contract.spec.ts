// @vitest-environment node —— 直接读取静态 HTML，避免 DOM 自动补排标签顺序
/**
 * @fileoverview 嵌入首航的静态安全契约：referrer 策略必须在应用脚本执行前生效。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(join(process.cwd(), 'app', 'index.html'), 'utf8')

describe('嵌入静态入口', () => {
  it('no-referrer 声明早于应用脚本，初始 token query 不会随请求外带', () => {
    const policy = html.indexOf('<meta name="referrer" content="no-referrer"')
    const entry = html.indexOf('<script type="module" src="/src/main.ts"')

    expect(policy).toBeGreaterThanOrEqual(0)
    expect(policy).toBeLessThan(entry)
  })
})
