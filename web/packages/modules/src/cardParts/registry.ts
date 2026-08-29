/**
 * @fileoverview 部件的渲染分发表：`kind` → 部件定义。卡片按表查，不写 switch——
 * 加一种部件 = 登记一个定义，卡片本体一行不改。逐字照 `configControls.ts` 那张表写。
 *
 * ⚠ 与 `registerModule` 同理，这是**机制**：任何来源的部件都能在运行期登记进来，
 * 内置那几个只是它的第一个调用方。
 * ⚠ 但运行期登记的部件**进不了 `module_types.json`**：那份目录是构建期产物，
 * 摆卡片的模块把内置部件的字段**静态**并进自己的 `configSchema`。第三方部件画得出来，
 * 属性面板与模型却看不见它的字段——与第三方模块不进目录是同一条边界。
 */
import type { CardPartDefinition } from './types'

/** 登记期告警的接收端。⚠ 不打 console：本仓 lint 禁 console，装不装由应用壳定。 */
export type CardPartWarn = (message: string) => void

const DISCARD: CardPartWarn = () => undefined

const parts = new Map<string, CardPartDefinition>()
let warn: CardPartWarn = DISCARD

/**
 * 装上登记期告警的接收端；不装即静默。
 * @param sink 收告警文本的函数
 */
export function setCardPartWarn(sink: CardPartWarn): void {
  warn = sink
}

/**
 * 登记一个部件；同档后登记者生效。
 * @param part 已经过 `defineCardPart` 整理的定义
 */
export function registerCardPart(part: CardPartDefinition): void {
  const kind = typeof part.kind === 'string' ? part.kind.trim() : ''
  if (kind === '') {
    throw new Error('部件定义必须有 kind')
  }
  const existing = parts.get(kind)
  if (existing !== undefined && existing !== part) {
    warn(`部件 ${kind} 被重复登记，后登记的生效`)
  }
  parts.set(kind, part)
}

/**
 * 按档取部件。
 * ⚠ 返回 undefined 时卡片必须画出「这档部件还没登记」：静默留白就是
 * 「我加了部件但没反应」，那是这套系统里最难查的一类故障
 * （DASHBOARD_DESIGN §5.3 陷阱 ⑤ 的同款）。
 * @param kind 部件档名
 */
export function getCardPart(kind: string): CardPartDefinition | undefined {
  return parts.get(kind)
}

/** 已登记的部件，顺序即登记先后——也就是「加部件」菜单里的顺序。 */
export function listCardParts(): readonly CardPartDefinition[] {
  return [...parts.values()]
}

/**
 * 一批档名里还没登记的那些。摆卡片的模块用它自检：
 * 自己 `configSchema` 里列出的档，运行期必须都查得到组件。
 * @param kinds 要检查的档名
 */
export function missingCardParts(kinds: readonly string[]): readonly string[] {
  return kinds.filter((kind) => !parts.has(kind))
}

/** 清空分发表，供测试与组件展示隔离。 */
export function __resetCardParts(): void {
  parts.clear()
  warn = DISCARD
}
