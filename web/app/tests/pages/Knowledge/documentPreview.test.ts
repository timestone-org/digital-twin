/**
 * @fileoverview 原件按后缀挑画法那张表。
 *
 * ⚠ 有一条盯的是「后端收得进来、前端查不到画法」：那时预览面会安静地退到
 * 「只给下载」，而两边单看都对——解析那边确实收它，表这边确实没它。
 * 这一条把「后来加了一种格式却忘了这张表」换成红灯。
 */
import { describe, expect, it } from 'vitest'

import {
  previewKindOf,
  suffixOf,
} from '@/pages/Knowledge/scripts/documentPreview'

/**
 * 这套部署收得进来的后缀，与 knowledge-server 的 `parsing/` 各路后端逐字同源
 * （text / word / office 三路本地 + MinerU 那一路外部）。
 */
const ACCEPTED = [
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.log',
  '.html',
  '.htm',
  '.json',
  '.docx',
  '.xlsx',
  '.xlsm',
  '.pptx',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
] as const

/** 收得进来、却有意不画的那几种。⚠ 加进来一条就要在这里记一笔，理由在表里。 */
const NO_PREVIEW = ['.pptx'] as const

describe('原件的画法', () => {
  it('收得进来的后缀，除了明确不画的那几种，都有画法', () => {
    const missing = ACCEPTED.filter(
      (one) => previewKindOf(`手册${one}`) === 'none',
    )
    expect(missing).toEqual([...NO_PREVIEW])
  })

  it('认不出的后缀退到「不画」，不猜一个画法', () => {
    expect(previewKindOf('归档.zip')).toBe('none')
    expect(previewKindOf('没有后缀的文件')).toBe('none')
  })

  it('后缀不分大小写', () => {
    expect(previewKindOf('图纸.PDF')).toBe('pdf')
    expect(suffixOf('图纸.PDF')).toBe('.pdf')
  })

  it('只认最后一个点之后那一段', () => {
    expect(suffixOf('2026.09.报表.xlsx')).toBe('.xlsx')
    expect(previewKindOf('2026.09.报表.xlsx')).toBe('sheet')
  })

  it('文本族各自走各自的画法', () => {
    expect(previewKindOf('说明.md')).toBe('markdown')
    expect(previewKindOf('运行.log')).toBe('text')
    expect(previewKindOf('配置.json')).toBe('text')
    // ⚠ HTML 单独一档：它要关进沙箱 iframe 才能画，与纯文本不是一条路
    expect(previewKindOf('页面.html')).toBe('html')
  })
})
