/**
 * @fileoverview 讲解与提示句是纯文本渲染的：里面写 Markdown 的 `**加粗**` 会把星号原样
 * 印到界面上。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'app', 'src', 'pages', 'Modeling')

/** 目录下全部 .ts / .vue 源文件。 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

/** 不在注释里的那些行。 */
function codeLines(text: string): string[] {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
}

it('给人看的句子里没有 Markdown 加粗星号', () => {
  const offenders = sources(ROOT).flatMap((path) =>
    codeLines(readFileSync(path, 'utf8'))
      .filter((line) => /\*\*[^*\s][^*]*\*\*/.test(line))
      .map((line) => `${path}: ${line.trim()}`),
  )

  expect(offenders).toEqual([])
})
