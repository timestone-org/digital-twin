/**
 * @fileoverview 引用按文档收拢：一份文档一行，页码合并成不重叠的区间。
 *
 * ⚠ 这是这一轮的核心诉求——**只列用到的页**。用户要的是「哪份文件的哪几页」，
 * 而不是十来条各自成行的召回；同一份文档被引到三段时，摆三行等于让他自己去合。
 */
import type { KnowledgeCitation } from '@dt/contracts'

export interface PageSpan {
  from: number
  to: number
}

/** 一份文档下被引到的那几段。 */
export interface CitationGroup {
  documentId: string
  documentTitle: string
  baseName: string
  /** 合并之后的页码区间，已排序且互不重叠；没有页码的格式给空数组。 */
  pages: readonly PageSpan[]
  /** 这份文档下的那几条，按角标出现序。 */
  items: readonly KnowledgeCitation[]
}

/**
 * 页码区间摊成一句（「4–6、9」）。
 * @param spans 合并过的区间
 */
export function pagesLabel(spans: readonly PageSpan[]): string {
  return spans
    .map((one) =>
      one.from === one.to ? `${one.from}` : `${one.from}–${one.to}`,
    )
    .join('、')
}

/**
 * 把几段页码合并成不重叠的区间。
 * ⚠ 相邻也合（4–6 与 7 合成 4–7）：读的人翻的是连续的几页，而「4–6、7」
 * 只是把同一件事说得更碎。
 * @param spans 原始区间，可能重叠、可能乱序
 */
export function mergedSpans(spans: readonly PageSpan[]): PageSpan[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from || a.to - b.to)
  const made: PageSpan[] = []
  for (const one of sorted) {
    const last = made[made.length - 1]
    if (last !== undefined && one.from <= last.to + 1) {
      last.to = Math.max(last.to, one.to)
      continue
    }
    made.push({ ...one })
  }
  return made
}

/** 一条引用占哪几页；没有页码给 null。 */
function spanOf(one: KnowledgeCitation): PageSpan | null {
  if (one.page === null) return null
  return { from: one.page, to: one.page_end ?? one.page }
}

interface Building extends CitationGroup {
  spans: PageSpan[]
}

/**
 * 按文档收拢，顺序即「这份文档第一次被引到」的先后。
 * ⚠ 保序而不是按文件名排：读的人扫答案是从上往下的，引用面跟着那个顺序走
 * 才对得上。
 * @param items 这一轮真正用到的那几条
 */
export function groupedCitations(
  items: readonly KnowledgeCitation[],
): CitationGroup[] {
  const made = new Map<string, Building>()
  for (const one of items) {
    const found: Building = made.get(one.document_id) ?? {
      documentId: one.document_id,
      documentTitle: one.document_title,
      baseName: one.base_name,
      pages: [],
      items: [],
      spans: [],
    }
    found.items = [...found.items, one]
    const span = spanOf(one)
    if (span !== null) found.spans.push(span)
    made.set(one.document_id, found)
  }
  return [...made.values()].map((one) => ({
    documentId: one.documentId,
    documentTitle: one.documentTitle,
    baseName: one.baseName,
    pages: mergedSpans(one.spans),
    items: one.items,
  }))
}
