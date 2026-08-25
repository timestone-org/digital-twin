/**
 * @fileoverview 一行文字里的行内标记：粗体、斜体、删除线、行内代码、链接。
 * 出来的是**结构**，由组件渲染成真实节点。
 *
 * ⚠ 全程不生成 HTML 字符串，因此也用不着 `v-html`。助手的正文里随时可能出现
 * 用户点位名带来的 `<`、或者模型复读回来的一段 HTML——走 `v-html` 的话那就是
 * 一个直通的 XSS 落点，而这一层的产出只能被渲染成文本节点。
 *
 * ⚠ 链接的协议**白名单放行**：`javascript:` 一类写进 `href` 会在点击时执行，
 * 而它看起来与普通链接一模一样。不在白名单里的一律降级成纯文字。
 */

/** 行内的一段。 */
export type MdSpan =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; spans: MdSpan[] }
  | { kind: 'strong'; spans: MdSpan[] }
  | { kind: 'em'; spans: MdSpan[] }
  | { kind: 'del'; spans: MdSpan[] }

/** 允许出现在 `href` 里的协议。⚠ 白名单，不是黑名单。 */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|\/|#)/i

interface Matcher {
  pattern: RegExp
  build: (matched: RegExpExecArray) => MdSpan
}

/**
 * 匹配器按**优先级**排：同一个位置上先命中的赢。
 * ⚠ 代码排第一：反引号里的 `**` 是字面量，不是加粗。
 * ⚠ `**` 排在 `*` 前面同理。
 */
const MATCHERS: readonly Matcher[] = [
  { pattern: /`([^`\n]+)`/, build: (m) => ({ kind: 'code', text: at(m, 1) }) },
  {
    pattern: /\[([^\]\n]*)\]\(([^)\s]*)\)/,
    build: (m) => linkOf(at(m, 1), at(m, 2)),
  },
  { pattern: /\*\*([\s\S]+?)\*\*/, build: (m) => wrap('strong', at(m, 1)) },
  { pattern: /__([\s\S]+?)__/, build: (m) => wrap('strong', at(m, 1)) },
  { pattern: /~~([\s\S]+?)~~/, build: (m) => wrap('del', at(m, 1)) },
  { pattern: /\*([^*\n]+)\*/, build: (m) => wrap('em', at(m, 1)) },
  { pattern: /_([^_\n]+)_/, build: (m) => wrap('em', at(m, 1)) },
]

/**
 * 把一段文字解成行内片段。
 * @param text 原文
 */
export function parseInline(text: string): MdSpan[] {
  const spans: MdSpan[] = []
  let rest = text
  // ⚠ 循环而不是递归：一段长回答里有上百个标记，递归会按标记数堆栈
  while (rest !== '') {
    const hit = earliest(rest)
    if (hit === null) {
      spans.push({ kind: 'text', text: rest })
      break
    }
    if (hit.index > 0) {
      spans.push({ kind: 'text', text: rest.slice(0, hit.index) })
    }
    spans.push(hit.span)
    rest = rest.slice(hit.index + hit.length)
  }
  return spans
}

interface Hit {
  index: number
  length: number
  span: MdSpan
}

/** 最靠前的那一个匹配；同一位置上按匹配器的先后取。 */
function earliest(text: string): Hit | null {
  let best: Hit | null = null
  for (const matcher of MATCHERS) {
    const matched = matcher.pattern.exec(text)
    if (matched === null) continue
    if (best !== null && matched.index >= best.index) continue
    best = {
      index: matched.index,
      length: matched[0].length,
      span: matcher.build(matched),
    }
  }
  return best
}

function wrap(kind: 'strong' | 'em' | 'del', inner: string): MdSpan {
  return { kind, spans: parseInline(inner) }
}

/** 协议不在白名单里就降级成纯文字——看得见地址，但点不动。 */
function linkOf(text: string, href: string): MdSpan {
  if (!SAFE_HREF.test(href)) return { kind: 'text', text: `${text}（${href}）` }
  return { kind: 'link', href, spans: parseInline(text) }
}

/** 取第 n 个捕获组；没捕到就是空串。⚠ 不用 `!`，本仓禁非空断言。 */
function at(matched: RegExpExecArray, index: number): string {
  return matched[index] ?? ''
}
