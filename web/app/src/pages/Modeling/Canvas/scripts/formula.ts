/**
 * @fileoverview 算子公式的数据模型：一棵可排版的树，外加一份纯 ASCII 序列化。
 *
 * 用 HTML + CSS 手排，不引 KaTeX / MathJax、不用 MathML：工控内网离线拿不到
 * CDN 字体、全局 dist CSS 计入首屏预算、HTML 排的式子跟着六套主题白拿且读屏
 * 能念（MODELING_RESULT_VIEW_DESIGN §6）。复议条件：要展示矩阵推导、多行等式
 * 对齐或积分超过三处时，另开 ADR + 锁文件 PR 引 KaTeX。
 *
 * ⚠ 序列化出来的是 ASCII 不是 LaTeX：用户拿它去 Excel 或台账 `PREDICT()` 里
 * 核对，LaTeX 对他没用。
 */
import { niceNumber } from './numbers'

/** 一项在式子里的角色。数值走 `--font-digit`，变量与运算符走 `--font-mono`。 */
export type FormulaTermKind = 'var' | 'num' | 'op' | 'name' | 'warn'

/** 式子里的一项。 */
export interface FormulaTerm {
  text: string
  kind: FormulaTermKind
}

/** 分档式的一档：条件 + 这一档的式子。 */
export interface FormulaCase {
  when: string
  then: FormulaNode[]
}

/** 一段式子。`run` 是行内线性式，其余四种要二维排版。 */
export type FormulaNode =
  | { node: 'run'; terms: FormulaTerm[] }
  | { node: 'frac'; over: FormulaNode[]; under: FormulaNode[] }
  | { node: 'sqrt'; of: FormulaNode[] }
  | { node: 'sum'; from: string; to: string; of: FormulaNode[] }
  | { node: 'cases'; rows: FormulaCase[] }

export const varOf = (text: string): FormulaTerm => ({ text, kind: 'var' })
export const opOf = (text: string): FormulaTerm => ({ text, kind: 'op' })
export const nameOf = (text: string): FormulaTerm => ({ text, kind: 'name' })
export const warnOf = (text: string): FormulaTerm => ({ text, kind: 'warn' })

/** 一个数。⚠ 一律过 `niceNumber`：自己格式化会把小系数印成 0。 */
export const numOf = (value: number): FormulaTerm => ({
  text: niceNumber(value),
  kind: 'num',
})

export const run = (...terms: FormulaTerm[]): FormulaNode => ({
  node: 'run',
  terms,
})
export const frac = (
  over: FormulaNode[],
  under: FormulaNode[],
): FormulaNode => ({ node: 'frac', over, under })
export const sqrt = (of: FormulaNode[]): FormulaNode => ({ node: 'sqrt', of })
export const sum = (
  from: string,
  to: string,
  of: FormulaNode[],
): FormulaNode => ({ node: 'sum', from, to, of })
export const cases = (rows: FormulaCase[]): FormulaNode => ({
  node: 'cases',
  rows,
})

/**
 * 数学字形 → ASCII。
 *
 * ⚠ `⌊` / `⌋` 各翻一半凑成 `floor(…)`，所以这两个符号必须成对出现。
 * ⚠ `ŷ` 翻成 `y`：这是用户要粘进 Excel 的那一串。真值与预测值同现的式子
 * （残差一类）要把真值写成 `y_true`，否则两边都翻成 `y` 就分不开了。
 */
const ASCII: Record<string, string> = {
  ŷ: 'y',
  β: 'b',
  α: 'alpha',
  σ: 'sigma',
  ν: 'nu',
  π: 'pi',
  Σ: 'sum',
  Δ: 'delta',
  '√': 'sqrt',
  '·': '*',
  '×': '*',
  '−': '-',
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  '≈': '~=',
  '⌊': 'floor(',
  '⌋': ')',
  '…': '...',
  '∅': 'null',
  '₀': '0',
  '₁': '1',
  '₂': '2',
  ᵢ: 'i',
  ⱼ: 'j',
  ₖ: 'k',
  ₘ: 'm',
  ₙ: 'n',
  '²': '^2',
}

// 两侧都不留空格的运算符
const TIGHT = new Set(['*', '/', '^'])
// 这些符号前面不留空格
const NO_SPACE_BEFORE = new Set([')', ']', ',', '^2'])
// 这些符号后面不留空格
const NO_SPACE_AFTER = new Set(['(', '['])

/**
 * 一段文字逐字翻成 ASCII。
 *
 * ⚠ 先 `NFC` 归一：`ŷ` 既可能是单个码位也可能是 `y` 加一个组合符，后者逐字翻
 * 会漏掉，表现是复制出来的式子里冒出一个看不见的重音符。
 * Args: text。
 */
function asciiOf(text: string): string {
  return [...text.normalize('NFC')]
    .map((glyph) => ASCII[glyph] ?? glyph)
    .join('')
}

/**
 * 把若干片段拼成一行，按运算符松紧决定要不要空格。
 * Args: pieces。
 */
function joined(pieces: string[]): string {
  let text = ''
  let last = ''
  for (const piece of pieces) {
    if (piece === '') continue
    const tight =
      TIGHT.has(piece) ||
      TIGHT.has(last) ||
      NO_SPACE_BEFORE.has(piece) ||
      NO_SPACE_AFTER.has(last)
    text += text === '' || tight ? piece : ` ${piece}`
    last = piece
  }
  return text
}

/**
 * 一段的 ASCII 片段。二维的四种各折成**一个**不可再拆的片段，括号自带，
 * 于是外层怎么拼都读不错优先级。
 * Args: node。
 */
function piecesOf(node: FormulaNode): string[] {
  if (node.node === 'run') return node.terms.map((term) => asciiOf(term.text))
  if (node.node === 'frac') {
    return [`(${formulaText(node.over)}) / (${formulaText(node.under)})`]
  }
  if (node.node === 'sqrt') return [`sqrt(${formulaText(node.of)})`]
  if (node.node === 'sum') {
    const range = `${asciiOf(node.from)}..${asciiOf(node.to)}`
    return [`sum(${range}, ${formulaText(node.of)})`]
  }
  const rows = node.rows.map(
    (row) => `${formulaText(row.then)} 若 ${asciiOf(row.when)}`,
  )
  return [`{ ${rows.join('; ')} }`]
}

/**
 * 把一棵式子折成一行纯 ASCII，供复制。
 * Args: nodes。
 */
export function formulaText(nodes: readonly FormulaNode[]): string {
  return joined(nodes.flatMap(piecesOf))
}

// 可以在它前面断行的运算符。⚠ `·` 不在内：断在乘号上会把「3.21·温度」拆两行
const BREAKING = new Set(['+', '−', '=', '≥', '≤', '<', '>', '≠', '≈', ','])

/**
 * 把一串项切成若干「项组」，每组渲染成一个不可断的 span。
 *
 * ⚠ 换行只许发生在运算符**前**：整式交给浏览器自由折行的话，断点会落进变量
 * 名中间，一个中文列名被劈成两半在式子里完全读不出来。
 * Args: terms。
 */
export function termItems(terms: readonly FormulaTerm[]): FormulaTerm[][] {
  const items: FormulaTerm[][] = []
  let current: FormulaTerm[] = []
  for (const term of terms) {
    if (term.kind === 'op' && BREAKING.has(term.text) && current.length > 0) {
      items.push(current)
      current = []
    }
    current.push(term)
  }
  if (current.length > 0) items.push(current)
  return items
}
