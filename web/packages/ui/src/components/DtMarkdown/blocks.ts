/**
 * @fileoverview markdown 解析：把一段文字解成**块**的列表
 * （标题、段落、代码块、列表、引用、表格、分隔线），由组件渲染。
 *
 * ⚠ 为什么自己写而不是引一个库：这一层的输入是模型正文，而它随时可能夹带
 * 一段 HTML。市面上的渲染器都产出 HTML 字符串，接进 Vue 就得走 `v-html`——
 * 那是本仓明令拦住的一个 XSS 落点（eslint 的 `vue/no-v-html`）。产出结构、
 * 由模板渲染成文本节点，这条风险从根上就不存在。
 *
 * ⚠ **没闭合的代码围栏照样成块**。流式逐字出字时，「```json」后面那一段在
 * 收全之前一直是没闭合的——按「不成块」处理的话，用户会看着一段 JSON 先以
 * 纯文本刷出来、收尾时再整体跳成代码块。
 *
 * ⚠ 段落里的换行**留着**（由样式渲染成软换行）。吃掉的话，模型分行写的
 * 「第一步…第二步…」会挤成一整坨。
 */
import { parseInline, type MdSpan } from './inline'

/** 一个块。 */
export type MdBlock =
  | { kind: 'heading'; level: number; spans: MdSpan[] }
  | { kind: 'paragraph'; spans: MdSpan[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: MdBlock[][] }
  | { kind: 'quote'; blocks: MdBlock[] }
  | { kind: 'table'; head: MdSpan[][]; rows: MdSpan[][][] }
  | { kind: 'rule' }

interface Taken {
  block: MdBlock
  next: number
}

type Taker = (lines: readonly string[], at: number) => Taken | null

const FENCE = /^\s*(?:```|~~~)\s*(\S*)\s*$/
const FENCE_END = /^\s*(?:```|~~~)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_RULE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/

/**
 * 把一段 markdown 解成块。
 * @param source 原文
 */
export function parseMarkdown(source: string): MdBlock[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'))
}

function parseBlocks(lines: readonly string[]): MdBlock[] {
  const blocks: MdBlock[] = []
  let cursor = 0
  while (cursor < lines.length) {
    if ((lines[cursor] ?? '').trim() === '') {
      cursor += 1
      continue
    }
    const taken = takeBlock(lines, cursor)
    blocks.push(taken.block)
    cursor = taken.next
  }
  return blocks
}

/** 按登记顺序问一遍，谁认领算谁的；都不认就是段落。 */
const TAKERS: readonly Taker[] = [
  takeFence,
  takeHeading,
  takeRule,
  takeQuote,
  takeTable,
  takeList,
]

function takeBlock(lines: readonly string[], at: number): Taken {
  for (const take of TAKERS) {
    const taken = take(lines, at)
    if (taken !== null) return taken
  }
  return takeParagraph(lines, at)
}

/** 这一行是不是某个块的开头。段落靠它决定在哪停。 */
function startsBlock(lines: readonly string[], at: number): boolean {
  return TAKERS.some((take) => take(lines, at) !== null)
}

function takeFence(lines: readonly string[], at: number): Taken | null {
  const opened = FENCE.exec(lines[at] ?? '')
  if (opened === null) return null
  const body: string[] = []
  let cursor = at + 1
  while (cursor < lines.length && !FENCE_END.test(lines[cursor] ?? '')) {
    body.push(lines[cursor] ?? '')
    cursor += 1
  }
  const lang = opened[1] ?? ''
  // 没闭合时 cursor 已到末尾，+1 越界也无妨——外层用 `<` 判
  return {
    block: { kind: 'code', lang, text: body.join('\n') },
    next: cursor + 1,
  }
}

function takeHeading(lines: readonly string[], at: number): Taken | null {
  const matched = HEADING.exec(lines[at] ?? '')
  if (matched === null) return null
  return {
    block: {
      kind: 'heading',
      level: (matched[1] ?? '#').length,
      spans: parseInline(matched[2] ?? ''),
    },
    next: at + 1,
  }
}

function takeRule(lines: readonly string[], at: number): Taken | null {
  if (!RULE.test(lines[at] ?? '')) return null
  return { block: { kind: 'rule' }, next: at + 1 }
}

function takeQuote(lines: readonly string[], at: number): Taken | null {
  if (!QUOTE.test(lines[at] ?? '')) return null
  const body: string[] = []
  let cursor = at
  while (cursor < lines.length) {
    const matched = QUOTE.exec(lines[cursor] ?? '')
    if (matched === null) break
    body.push(matched[1] ?? '')
    cursor += 1
  }
  return { block: { kind: 'quote', blocks: parseBlocks(body) }, next: cursor }
}

function takeTable(lines: readonly string[], at: number): Taken | null {
  const head = lines[at] ?? ''
  if (!head.includes('|')) return null
  if (!TABLE_RULE.test(lines[at + 1] ?? '')) return null
  const rows: MdSpan[][][] = []
  let cursor = at + 2
  while (cursor < lines.length && (lines[cursor] ?? '').includes('|')) {
    rows.push(cellsOf(lines[cursor] ?? ''))
    cursor += 1
  }
  return { block: { kind: 'table', head: cellsOf(head), rows }, next: cursor }
}

function cellsOf(line: string): MdSpan[][] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()))
}

interface ItemHead {
  indent: number
  ordered: boolean
  start: number
  text: string
}

function matchItem(line: string): ItemHead | null {
  const matched = ITEM.exec(line)
  if (matched === null) return null
  const marker = matched[2] ?? '-'
  const ordered = /\d/.test(marker)
  return {
    indent: (matched[1] ?? '').length,
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    text: matched[3] ?? '',
  }
}

function takeList(lines: readonly string[], at: number): Taken | null {
  const first = matchItem(lines[at] ?? '')
  if (first === null) return null
  const items: MdBlock[][] = []
  let cursor = at
  for (;;) {
    const head = matchItem(lines[cursor] ?? '')
    if (head === null || head.ordered !== first.ordered) break
    const body = takeItemBody(lines, cursor + 1, head.indent)
    items.push(parseBlocks([head.text, ...body.lines]))
    cursor = skipLooseBlank(lines, body.next, first.ordered)
  }
  const block: MdBlock = {
    kind: 'list',
    ordered: first.ordered,
    start: first.start,
    items,
  }
  return { block, next: cursor }
}

/** 一项的续行：缩进比标记更深的都算它的，去掉缩进后递归解。 */
function takeItemBody(
  lines: readonly string[],
  at: number,
  indent: number,
): { lines: string[]; next: number } {
  const kept: string[] = []
  let cursor = at
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    if (line.trim() === '' || leadingSpaces(line) <= indent) break
    kept.push(line.slice(indent + 2))
    cursor += 1
  }
  return { lines: kept, next: cursor }
}

/**
 * 项与项之间的空行。
 * ⚠ 后面还是同一种标记时要跨过去：不跨的话「- a」「空行」「- b」会渲染成
 * 两个各自带上下外边距的列表，看着像中间断了一截。
 */
function skipLooseBlank(
  lines: readonly string[],
  at: number,
  ordered: boolean,
): number {
  let cursor = at
  while ((lines[cursor] ?? '').trim() === '' && cursor < lines.length) {
    cursor += 1
  }
  const next = matchItem(lines[cursor] ?? '')
  return next !== null && next.ordered === ordered ? cursor : at
}

function takeParagraph(lines: readonly string[], at: number): Taken {
  const kept: string[] = []
  let cursor = at
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    if (line.trim() === '') break
    if (cursor > at && startsBlock(lines, cursor)) break
    kept.push(line.trim())
    cursor += 1
  }
  const spans = parseInline(kept.join('\n'))
  return { block: { kind: 'paragraph', spans }, next: cursor }
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length
}
