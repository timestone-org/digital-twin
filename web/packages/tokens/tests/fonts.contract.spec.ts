/**
 * @fileoverview 契约：应用自带的鸿蒙字体保持官方原件，正文、标题和读数缺省
 * 都指向它；DS-Digital 仅是大屏的可选适配器，不进入全局管理页面。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FONT_FILE = path.resolve(
  HERE,
  '../src/fonts/harmonyos-sans-sc/HarmonyOS_Sans_SC_Regular.ttf',
)
const LICENSE_FILE = path.resolve(
  HERE,
  '../src/fonts/harmonyos-sans-sc/LICENSE.txt',
)
const DS_FONT_FILE = path.resolve(HERE, '../src/fonts/ds-digital/DS-DIGI.TTF')
const DS_LICENSE_FILE = path.resolve(
  HERE,
  '../src/fonts/ds-digital/DIGITAL.TXT',
)
const FONT_SCSS = readFileSync(path.resolve(HERE, '../src/fonts.scss'), 'utf-8')
const TOKENS_SCSS = readFileSync(
  path.resolve(HERE, '../src/tokens.scss'),
  'utf-8',
)

describe('HarmonyOS Sans SC 资源', () => {
  it('字体文件是 OpenHarmony 官方未修改原件', () => {
    const digest = createHash('sha256')
      .update(readFileSync(FONT_FILE))
      .digest('hex')

    expect(digest).toBe(
      '8b193c486e7fd959598d209e3974b5f3838f07384239a9f4d05d45d06e6116ae',
    )
  })

  it('保留完整字体授权，并由独立 SCSS 入口加载原始 TTF', () => {
    const license = readFileSync(LICENSE_FILE, 'utf-8')

    expect(license).toContain('HarmonyOS Sans Fonts License Agreement')
    expect(FONT_SCSS).toContain(
      "url('./fonts/harmonyos-sans-sc/HarmonyOS_Sans_SC_Regular.ttf')",
    )
    expect(FONT_SCSS).toContain("font-family: 'HarmonyOS Sans SC'")
    expect(FONT_SCSS).toContain('font-display: swap')
  })

  it('DS-Digital 保持作者原件、保留授权并由字体入口加载', () => {
    const digest = createHash('sha256')
      .update(readFileSync(DS_FONT_FILE))
      .digest('hex')
    const license = readFileSync(DS_LICENSE_FILE, 'utf-8')

    expect(digest).toBe(
      '87eb14d41eeeac0bd7fe0c62ece05134bbf1ee8059b6e3e701d7f4a7799506dc',
    )
    expect(license).toContain('DS-Digital (Normal, Bold, Italic, Bold Italic)')
    expect(license).toContain('$45 US')
    expect(FONT_SCSS).toContain("font-family: 'DS-Digital'")
    expect(FONT_SCSS).toContain(
      "url('./fonts/ds-digital/DS-DIGI.TTF') format('truetype')",
    )
  })

  it('DS-Digital 只进入大屏候选栈，不进入全局管理页面字体', () => {
    expect(TOKENS_SCSS).toContain('--font-family-ds-digital:')
    expect(TOKENS_SCSS).not.toContain(
      '--font-sans: var(--font-family-ds-digital)',
    )
  })

  it('正文、标题与读数缺省都收敛到鸿蒙，等宽技术文本保留专用语义', () => {
    expect(TOKENS_SCSS).toContain('--font-display: var(--font-family-harmony)')
    expect(TOKENS_SCSS).toContain('--font-sans: var(--font-family-harmony)')
    expect(TOKENS_SCSS).toContain(
      '--font-digit-base: var(--font-family-harmony)',
    )
    expect(TOKENS_SCSS).toContain('--font-digit: var(--font-digit-base)')
    expect(TOKENS_SCSS).toContain('--font-mono: ui-monospace')
  })
})
