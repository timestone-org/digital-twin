/**
 * @fileoverview 引用按文档收拢、页码合并。守的是「只列用到的页」这件事。
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgeCitation } from '@dt/contracts'

import {
  groupedCitations,
  mergedSpans,
  pagesLabel,
} from '@/features/knowledgeChat/citationGroups'

function cite(
  marker: string,
  documentId: string,
  page: number | null,
  pageEnd: number | null = null,
): KnowledgeCitation {
  return {
    marker,
    chunk_id: `c-${marker}`,
    document_id: documentId,
    document_title: documentId === 'd1' ? '现场手册' : '维护规程',
    base_name: '手册库',
    heading_path: '二、运行参数',
    where: page === null ? '二、运行参数' : `第 ${page} 页`,
    page,
    page_end: pageEnd,
    text: '正文',
    figures: [],
  }
}

describe('页码区间合并', () => {
  it('重叠与相邻都合成一段', () => {
    // ⚠ 相邻也合：读的人翻的是连续的几页，而「4–6、7」只是把同一件事说得更碎
    expect(
      mergedSpans([
        { from: 4, to: 6 },
        { from: 7, to: 7 },
      ]),
    ).toEqual([{ from: 4, to: 7 }])
    expect(
      mergedSpans([
        { from: 4, to: 6 },
        { from: 5, to: 9 },
      ]),
    ).toEqual([{ from: 4, to: 9 }])
  })

  it('隔开的保持两段，且按页排序', () => {
    expect(
      mergedSpans([
        { from: 9, to: 9 },
        { from: 4, to: 6 },
      ]),
    ).toEqual([
      { from: 4, to: 6 },
      { from: 9, to: 9 },
    ])
  })

  it('摊成一句给人看', () => {
    expect(
      pagesLabel([
        { from: 4, to: 6 },
        { from: 9, to: 9 },
      ]),
    ).toBe('4–6、9')
    expect(pagesLabel([])).toBe('')
  })
})

describe('按文档收拢', () => {
  it('同一份文档的几段并成一行，页码合并', () => {
    // ⚠ 这就是这一轮的核心：用户要的是「哪份文件的哪几页」，
    // 而不是十来条各自成行的召回
    const made = groupedCitations([
      cite('①', 'd1', 4, 6),
      cite('②', 'd1', 9),
      cite('③', 'd2', 12),
    ])
    expect(made).toHaveLength(2)
    const [first, second] = made
    // ⚠ 不写 `!`：断言被闸门拦，而这里正好也该证明「真的有两组」
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(pagesLabel(first?.pages ?? [])).toBe('4–6、9')
    expect(first?.items.map((one) => one.marker)).toEqual(['①', '②'])
    expect(pagesLabel(second?.pages ?? [])).toBe('12')
  })

  it('顺序是「第一次被引到」的先后，不是文件名', () => {
    // ⚠ 读的人扫答案是从上往下的，引用面跟着那个顺序走才对得上
    const made = groupedCitations([cite('①', 'd2', 12), cite('②', 'd1', 4)])
    expect(made.map((one) => one.documentId)).toEqual(['d2', 'd1'])
  })

  it('没有页码的格式给空区间，不硬凑一个页码', () => {
    // ⚠ docx / md 根本没有页这个概念；凑一个「第 1 页」是在说假话
    const [only] = groupedCitations([cite('①', 'd1', null)])
    expect(only?.pages).toEqual([])
    expect(pagesLabel(only?.pages ?? [])).toBe('')
  })

  it('一条都没有时给空数组', () => {
    expect(groupedCitations([])).toEqual([])
  })
})
