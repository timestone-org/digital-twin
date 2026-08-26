/**
 * @fileoverview 用户可填的 CSS 值的消毒判据与颜色兜底链拼接。文档里的颜色/渐变/阴影
 * 经 `:style` 注入时 `;` 与 `}` 逃不出去，但 `url()` 能把请求打到外部；被拒的值回落
 * 该字段缺省并进诊断（不静默）。口径见 docs/MODULE_TWIN_2D_DESIGN.md §11.5、§7 #47/#61。
 */
import { trimmedString } from './sanitize'

/** CSS 值长度上限 */
export const CSS_VALUE_MAX_LEN = 200

/** 兜底链收底的语义 token */
const ACCENT_FALLBACK = 'var(--accent-primary)'

/** 外链取数 */
const URL_TOKEN = 'url('
/** 外部样式表引入 */
const IMPORT_TOKEN = '@import'
/** 转义引子 */
const BACKSLASH = '\\'
/** 控制字符区上界 */
const CTRL_MAX = 0x1f
/** 单独的 DEL */
const CTRL_DEL = 0x7f

/** 连续空白 */
const WHITESPACE_RE = /\s+/g
/** 裸自定义属性名 */
const BARE_VAR_NAME_RE = /^--[A-Za-z0-9_-]+$/
/** 无兜底的单参 `var()` 引用 */
const VAR_REF_RE = /^var\(\s*--[A-Za-z0-9_-]+\s*\)$/

// ⚠ 控制字符按码位判而不用正则字面量：正则里写控制字符区会被 no-control-regex 拦下，
// 按码位判等价且不用给 lint 开口子
function isControlChar(char: string): boolean {
  const code = char.charCodeAt(0)
  return code <= CTRL_MAX || code === CTRL_DEL
}

/**
 * 一个 CSS 值能不能原样注入：拒 `url(` / `@import` / 反斜杠 / 控制字符 / 超长。
 * ⚠ 判据本身导出，是给诊断面用的入口：渲染层消毒后只剩缺省值，诊断要在原值上再判
 * 一次才说得出「你填的哪一处被拒了」（§17）。
 * ⚠ 先把空白全抹掉再比对，所以 `URL (`、`u r l (` 这类变形一并挡住；代价是
 * `--my-url (` 这种写法会被误杀——判据宁可误杀，回落的是缺省而不是外链。
 * @param value 已 trim 的 CSS 值
 */
export function isSafeCssValue(value: string): boolean {
  if (value.length > CSS_VALUE_MAX_LEN) return false
  if (value.includes(BACKSLASH)) return false
  if ([...value].some(isControlChar)) return false
  const condensed = value.replace(WHITESPACE_RE, '').toLowerCase()
  return !condensed.includes(URL_TOKEN) && !condensed.includes(IMPORT_TOKEN)
}

/**
 * 消毒一个 CSS 值：非串、空串与被拒的值一律回落该字段缺省。
 * ⚠ `fallback` 是代码侧字面量，不再过判据：它要是脏的，脏的是发版而不是配置。
 * @param raw 原始值
 * @param fallback 被拒时的缺省
 */
export function sanitizeCssValue(raw: unknown, fallback: string): string {
  const text = trimmedString(raw)
  if (text === '') return fallback
  return isSafeCssValue(text) ? text : fallback
}

// 取一段的自定义属性名：裸名与单参 var() 引用都能续链，其余形状不能
function varNameOf(segment: string): string | null {
  if (BARE_VAR_NAME_RE.test(segment)) return segment
  if (!VAR_REF_RE.test(segment)) return null
  return segment
    .slice(segment.indexOf('(') + 1, segment.lastIndexOf(')'))
    .trim()
}

// 一段接在尾链前面：字面值解析不会失败，故它自己就是终点，尾链丢弃
function chainLink(value: string, tail: string): string {
  const name = varNameOf(value)
  if (name === null) return value
  return tail === '' ? `var(${name})` : `var(${name}, ${tail})`
}

/**
 * 把 N 段拼成 `var(a, var(b, c))`：空段跳过，字面值段终止其后的尾链。
 * @param values 从高优先到低优先的各段，每段是自定义属性名、单参 `var()` 引用或字面值
 */
export function cssVarChain(...values: readonly string[]): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .reduceRight((tail, value) => chainLink(value, tail), '')
}

/**
 * 强调色三级兜底链：节点 accent → 样式 accent → `var(--accent-primary)`。
 * ⚠ 拼的是**字符串**，一处都不读 token 取值、不监听换肤（本包 deps 里没有 @dt/tokens）。
 * ⚠ 二级兜底不能省：内联 `--accent: var(--xxx)` 没有兜底时，`--xxx` 拼错就整条声明
 * 失效，而内联优先级更高会把根上的兜底一起遮掉——描边、发光、读数色、角标兜底色
 * 一起丢，且零报错。所以链尾恒是 `--accent-primary`。
 * ⚠ 唯一收不了底的是高优先段填了字面色（`#62ff8a`）：字面值不会解析失败，把它塞进
 * `var()` 的头位反而让整条声明非法——正是要避开的那个故障，故此时链在它那里结束。
 * @param nodeAccent 节点上的强调色，`''` = 用样式的
 * @param styleAccent 样式上的强调色，`''` = 用语义 token
 */
export function resolveAccent(nodeAccent: string, styleAccent: string): string {
  return cssVarChain(
    sanitizeCssValue(nodeAccent, ''),
    sanitizeCssValue(styleAccent, ''),
    ACCENT_FALLBACK,
  )
}
