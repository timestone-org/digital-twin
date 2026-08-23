/**
 * @fileoverview 公式编辑器的纯规则层：快速插入插在哪、光标停在哪、有选中内容时
 * 包裹还是替换；分段各档怎么拆开、怎么拼回同一行文本。
 *
 * ⚠ 这里**不认识公式语法**。拆分只认「整条就是一个 IF/IFS 调用」这一种形状，
 * 认不出就退回 null 让界面走播种兜底；拼接是纯字符串拼接。真正的语法判定只在
 * 后端一处（docs/DATASET_DESIGN.md §5.9）。
 * ⚠ 拆开再拼回必须逐字还原：连 `IF` / `IFS` 这个字都要留着，否则用户没碰过的
 * 那条公式会在切一次编辑面之后被静默改写。
 */

/** 一次插入：要插的片段，以及光标相对片段起点的偏移。 */
export interface InsertPayload {
  snippet: string
  caret: number
}

/** 插入之后的文本与新选区（起止相同即插入符）。 */
export interface InsertResult {
  text: string
  start: number
  end: number
}

/** 分支公式的一档：条件与取值都是公式原文。 */
export interface BranchArm {
  cond: string
  value: string
}

/**
 * 分段编辑面的草稿。
 * `form` 记的是原文用的是 `IF` 还是 `IFS`——只有一档时两种写法都合法，
 * 不记下来的话 `IFS(c, v, e)` 会在拆开再拼回之后变成 `IF(c, v, e)`。
 */
export interface BranchDraft {
  arms: BranchArm[]
  otherwise: string
  form: 'IF' | 'IFS'
}

/** 目录里的一个函数，取插入片段只需要这三项。 */
export interface SnippetFunction {
  name: string
  min_args: number
  signature: string
}

/**
 * 把 `[from, to)` 这段换成 `snippet`，光标落在片段内的 `caret` 处。
 * @param text 原文
 * @param from 替换区间起点
 * @param to 替换区间终点（不含）
 * @param snippet 要插入的片段
 * @param caret 光标相对片段起点的偏移，缺省落在片段末尾
 */
export function spliceText(
  text: string,
  from: number,
  to: number,
  snippet: string,
  caret: number = snippet.length,
): InsertResult {
  const head = text.slice(0, from)
  const at = head.length + caret
  return { text: head + snippet + text.slice(to), start: at, end: at }
}

/** 本表列引用写法：`{列key}`。 */
export function columnRef(key: string): string {
  return `{${key}}`
}

/** 跨表列引用写法：`{表code.列key}`。 */
export function externalRef(tableCode: string, key: string): string {
  return `{${tableCode}.${key}}`
}

/**
 * 时间窗函数的签名里自带一个建议窗口（`SUM_OVER({列}, '1h')`）。
 * ⚠ 这个值取自目录而不是前端写死：窗口的默认档由后端的函数说明一处说了算，
 * 那边改了这里跟着走。
 * @param signature 目录给的函数签名
 */
export function windowHint(signature: string): string | null {
  const found = /'([^']+)'/.exec(signature)
  return found?.[1] ?? null
}

/**
 * 一个函数的插入片段：有选中内容就套住它，否则把光标送进括号；
 * 签名里带建议窗口的（时间窗那一族）预填上，零参函数光标停在括号之后。
 * @param fn 目录里的这个函数
 * @param selection 当前选中的文本，空串表示没有选中
 */
export function functionSnippet(
  fn: SnippetFunction,
  selection = '',
): InsertPayload {
  if (fn.min_args === 0) {
    // PI() / E()：括号里不填东西，写成裸 `PI` 会被解析器当成未知标识符
    const snippet = `${fn.name}()`
    return { snippet, caret: snippet.length }
  }
  const hint = windowHint(fn.signature)
  const tail = hint === null ? '' : `, '${hint}'`
  if (selection !== '') {
    const snippet = `${fn.name}(${selection}${tail})`
    return { snippet, caret: snippet.length }
  }
  // 光标进括号：`NAME(` 的长度
  return { snippet: `${fn.name}(${tail})`, caret: fn.name.length + 1 }
}

/**
 * 库公式调用片段。
 * ⚠ 零参也必须带括号：裸 `@标识` 会被解析器明确拒绝。
 * ⚠ 不做「套住选中内容」：库公式的形参有种类之分，把一段选中文本塞进第一个位置
 * 多半正好违反那一条，而报错时又指不回这次插入。
 * @param code 库公式标识
 */
export function librarySnippet(code: string): InsertPayload {
  return { snippet: `@${code}()`, caret: code.length + 2 }
}

/**
 * 目录里的一条运算符速查拆成可以逐个插入的符号。
 * ⚠ 后端把同一类的几个符号写在一格里（`>  >=  <  <=`、`( )`、`and  or`），
 * 照原样插进去就是一串语法错误。
 * @param value 目录给的那一格
 */
export function operatorTokens(value: string): string[] {
  const trimmed = value.trim()
  return trimmed === '' ? [] : trimmed.split(/\s+/)
}

/** 运算符片段：括号贴着写，其余两侧补空格。 */
export function operatorSnippet(symbol: string): InsertPayload {
  if (symbol === '(' || symbol === ')') {
    return { snippet: symbol, caret: symbol.length }
  }
  const snippet = ` ${symbol} `
  return { snippet, caret: snippet.length }
}

/** 时间窗字面量片段：`'1h'`。窗口是字符串参数，不带引号解析不过。 */
export function windowSnippet(unit: string): InsertPayload {
  const snippet = `'${unit}'`
  return { snippet, caret: snippet.length }
}

/**
 * 分段各档 → 一行公式文本。
 * ⚠ 只有一档时写法由 `form` 决定而不是一律写 `IF`：拆出来是 `IFS` 就还写
 * `IFS`，否则用户什么都没改，保存下去的却是另一条文本。
 * @param draft 各档条件、取值与兜底
 */
export function composeBranches(draft: BranchDraft): string {
  const parts = draft.arms.flatMap((arm) => [arm.cond.trim(), arm.value.trim()])
  parts.push(draft.otherwise.trim())
  const name = draft.arms.length > 1 ? 'IFS' : draft.form
  return `${name}(${parts.join(', ')})`
}

/**
 * 一行公式文本 → 分段各档；不是「整条就是一个 IF/IFS 调用」就退回 null。
 * ⚠ 这不是解析器：它只按括号、方括号与引号数嵌套，找最外层的逗号。认不出的
 * 一律退回 null，由界面把整条公式放进「否则」那一档，绝不猜。
 * @param formula 公式原文
 */
export function splitBranches(formula: string): BranchDraft | null {
  const text = formula.trim()
  const head = /^(IFS|IF)\s*\(/.exec(text)
  if (head === null || !text.endsWith(')')) return null
  const form = head[1] === 'IFS' ? 'IFS' : 'IF'
  const parts = splitTopLevel(text.slice(head[0].length, -1))
  if (parts === null || !isBranchArity(form, parts.length)) return null
  return { arms: armsOf(parts), otherwise: parts[parts.length - 1] ?? '', form }
}

/** `IF` 恰好三段；`IFS` 至少三段且必须是奇数——末段是兜底，其余成对。 */
function isBranchArity(form: 'IF' | 'IFS', count: number): boolean {
  return form === 'IF' ? count === 3 : count >= 3 && count % 2 === 1
}

/** 除末段之外两两成一档。 */
function armsOf(parts: readonly string[]): BranchArm[] {
  const arms: BranchArm[] = []
  for (let at = 0; at + 1 < parts.length - 1; at += 2) {
    arms.push({ cond: parts[at] ?? '', value: parts[at + 1] ?? '' })
  }
  return arms
}

/**
 * ⚠ 花括号**不当括号数**：`{列key}` 里的花括号是列引用的一部分，把它当嵌套会让
 * `IF({a} > 0, 1, 0)` 整条切不开。
 */
const DEPTH_STEP: Record<string, number> = {
  '(': 1,
  '[': 1,
  ')': -1,
  ']': -1,
}
const QUOTES = `'"`

/**
 * 按最外层的逗号切开；括号不配对或引号没闭合就退回 null。
 * @param inner 调用括号里的那一段
 */
function splitTopLevel(inner: string): string[] | null {
  const cuts = topLevelCommas(inner)
  if (cuts === null) return null
  const parts: string[] = []
  let from = 0
  for (const at of cuts) {
    parts.push(inner.slice(from, at))
    from = at + 1
  }
  parts.push(inner.slice(from))
  return parts.map((one) => one.trim())
}

/**
 * 最外层那几个逗号的下标；括号不配对或引号没闭合一律退回 null。
 * @param inner 调用括号里的那一段
 */
function topLevelCommas(inner: string): number[] | null {
  const cuts: number[] = []
  let depth = 0
  let quote = ''
  for (let at = 0; at < inner.length; at += 1) {
    const char = inner.charAt(at)
    const quoted = quote !== '' || QUOTES.includes(char)
    quote = quoteAfter(char, quote)
    if (quoted) continue
    depth += DEPTH_STEP[char] ?? 0
    if (depth < 0) return null
    if (char === ',' && depth === 0) cuts.push(at)
  }
  return depth === 0 && quote === '' ? cuts : null
}

/**
 * 扫过一个字符之后还在不在引号里，在的话是哪一种引号。
 * ⚠ 引号跨度里的括号与逗号都不算结构：`IF({a} > 0, "x,y", "")` 里那个逗号是
 * 文本的一部分，当成分隔符会把这一档切成两半。
 * @param char 这个字符
 * @param quote 扫到它之前所处的引号，空串表示不在引号里
 */
function quoteAfter(char: string, quote: string): string {
  if (quote !== '') return char === quote ? '' : quote
  return QUOTES.includes(char) ? char : ''
}

/**
 * 公式里已经写了哪些 `{...}` 引用，跨表引用取整段（`表code.列key`）。
 * ⚠ 只用来在工具箱上标「已用」这类提示，不做语法校验：真正的依赖清单来自
 * 校验回执的 `deps`。
 * @param formula 公式原文
 */
export function referencedKeys(formula: string): Set<string> {
  const found = new Set<string>()
  for (const match of formula.matchAll(/\{([^{}]+)\}/g)) {
    const key = match[1]?.trim()
    if (key !== undefined && key !== '') found.add(key)
  }
  return found
}
