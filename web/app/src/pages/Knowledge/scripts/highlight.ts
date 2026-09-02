/**
 * @fileoverview 把召回正文按检索词切成「命中 / 未命中」片段，供模板逐段渲染。
 * ⚠ 出的是片段数组不是 HTML：模板用 v-for 出 `<mark>`，不经 v-html。
 */

/** 正文里的一片。`start` 是它在原文里的偏移，模板拿它当 key。 */
export interface HighlightPart {
  text: string
  isHit: boolean
  start: number
}

interface Range {
  start: number
  end: number
}

/** 空白、标点与符号：按它们切词。 */
const SEPARATORS = /[\s\p{P}\p{S}]+/u
/** 整句只有标点（用户输了个「。」）时它不是词。 */
const ONLY_SEPARATORS = /^[\s\p{P}\p{S}]+$/u

/**
 * 从检索句里取要高亮的词：整句 + 逐个词，去重、忽略大小写、长的在前。
 * ⚠ 整句也要试：中文没有空格，切词只会得到整句本身。
 * @param query 检索句
 */
function queryTerms(query: string): string[] {
  const whole = query.trim().toLowerCase()
  if (whole === '') return []
  const seen = new Set<string>()
  for (const one of [whole, ...whole.split(SEPARATORS)]) {
    if (one !== '' && !ONLY_SEPARATORS.test(one)) seen.add(one)
  }
  // 长词在前：先命中长的，短词才不会把长词切碎
  return [...seen].sort((a, b) => b.length - a.length)
}

function hitRanges(haystack: string, terms: readonly string[]): Range[] {
  const found: Range[] = []
  for (const term of terms) {
    let from = haystack.indexOf(term)
    while (from !== -1) {
      found.push({ start: from, end: from + term.length })
      from = haystack.indexOf(term, from + 1)
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/** 重叠或相接的区间并成一段，免得一处命中渲染成两个挨着的 <mark>。 */
function mergeRanges(ranges: readonly Range[]): Range[] {
  const merged: Range[] = []
  for (const one of ranges) {
    const last = merged[merged.length - 1]
    if (last !== undefined && one.start <= last.end) {
      last.end = Math.max(last.end, one.end)
    } else {
      merged.push({ ...one })
    }
  }
  return merged
}

/**
 * 把正文按检索词切成片段；没命中就整段一片。
 * ⚠ 转小写会改变某些字符的长度（土耳其语的 İ），偏移就对不上原文；
 * 长度一变就退回区分大小写地匹配，宁可少亮也不能亮错位置。
 * @param text 召回正文
 * @param query 检索句
 */
export function splitByQuery(text: string, query: string): HighlightPart[] {
  if (text === '') return []
  const lowered = text.toLowerCase()
  const haystack = lowered.length === text.length ? lowered : text
  const ranges = mergeRanges(hitRanges(haystack, queryTerms(query)))
  if (ranges.length === 0) return [{ text, isHit: false, start: 0 }]
  const parts: HighlightPart[] = []
  let cursor = 0
  for (const { start, end } of ranges) {
    if (start > cursor) {
      parts.push({
        text: text.slice(cursor, start),
        isHit: false,
        start: cursor,
      })
    }
    parts.push({ text: text.slice(start, end), isHit: true, start })
    cursor = end
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), isHit: false, start: cursor })
  }
  return parts
}
