/**
 * @fileoverview 契约：框体动效的节奏只有一份，且不会在动画结束后留下 transform。
 *
 * ⚠ 全是 CSS，typecheck 与单测都碰不到：keyframes 写错名字框体只是照旧直出，
 * 留着 transform 则是框体里的下拉偏到别处，两种都不报错。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/
const TOKENS = readFileSync(
  join(process.cwd(), 'packages/tokens/src/tokens.scss'),
  'utf8',
)
const MOTION_TOKENS = ['--motion-fast', '--motion-enter', '--motion-exit']

function keyframes(name: string): string {
  const found = new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`).exec(
    TOKENS,
  )
  return found?.[0] ?? ''
}

describe('动效 token', () => {
  it.each(MOTION_TOKENS)('%s 在减少动态时压成 0', (token) => {
    const [base, reduced] = TOKENS.split('prefers-reduced-motion: reduce')
    expect(base).toMatch(new RegExp(`${token}: [1-9]\\d*ms`))
    expect(reduced).toContain(`${token}: 0ms`)
  })

  it('入场 keyframes 只写起点：终点要回到元素自身，不许钉死 transform', () => {
    const frames = keyframes('dt-overlay-enter')
    expect(frames).toContain('from')
    expect(frames).not.toMatch(/\bto \{/)
    expect(frames).not.toContain('scale')
  })
})
