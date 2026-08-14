/**
 * @fileoverview 卡片外观（chrome）的渲染侧发射规则：一只 `CardChrome` 袋子 →
 * `--card-*` 覆盖变量 + 少数几个修饰类。键的词汇表在 `@dt/contracts` 的 `CHROME_KEYS`，
 * 这里只写逐键特例（单位、简写串、只有某一档才注入）。
 */
import type { CardChrome, ChromeKey } from '@dt/contracts'

/**
 * 卡片边框样式的选项表：面板的选项源，同时生成 `normalizeCardBorderStyle` 的白名单。
 * ⚠ 新增样式**必须同时登记进 `CHROME_KEYS.borderStyle.values`**：漏登记 = 面板能选、
 * 渲染静默回退 `'solid'`，是「选了没反应」最典型的一类。两表逐字一致由契约测试锁死。
 */
export const CARD_BORDER_STYLE_OPTIONS = [
  { value: 'solid', label: '标准细线' },
  { value: 'glow', label: '霓虹辉光' },
  { value: 'double', label: '双层描边' },
  { value: 'dashed', label: '虚线描边' },
  { value: 'bracket', label: '角括号' },
  { value: 'cut', label: '切角边框' },
  // 呼吸描边：细线 + 明暗呼吸（--card-border ⇄ --card-border-hover），刻意不叠任何
  // 阴影——这正是它与 glow（常亮外发光）的根本区别
  { value: 'breathe', label: '呼吸描边' },
  { value: 'none', label: '无边框' },
] as const

export type CardBorderStyle =
  (typeof CARD_BORDER_STYLE_OPTIONS)[number]['value']

const CARD_BORDER_STYLES = new Set<string>(
  CARD_BORDER_STYLE_OPTIONS.map((option) => option.value),
)

/**
 * 归一化边框样式：缺省 / 非白名单值回退 `'solid'`（= 平台现有观感）。
 * @param value chrome 袋子里的自由值
 */
export function normalizeCardBorderStyle(value: unknown): CardBorderStyle {
  return typeof value === 'string' && CARD_BORDER_STYLES.has(value)
    ? (value as CardBorderStyle)
    : 'solid'
}

/**
 * 是否「完全无框」：卡片框（背景 + 描边 + 圆角）整体退场，内容全幅。
 * 只有**显式** `'none'` 才算，未设置仍是有框。
 * @param chrome 已合并的 chrome 袋子
 */
export function isChromeFrameless(chrome: CardChrome): boolean {
  return chrome.borderStyle === 'none'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * 大屏级缺省 + 模块级覆盖合并成一只袋子。**浅合并且模块键盖大屏键**：
 * 合并后再一次性注入，模块级把某项改回默认时「不注入」就能正确压过大屏级，不留继承残留。
 * @param base 大屏级 `chrome_json.card`
 * @param override 模块级 `config_json.__cardStyle`
 */
export function mergeCardChrome(base: unknown, override: unknown): CardChrome {
  return { ...asRecord(base), ...asRecord(override) }
}

/**
 * chrome 里的数值容错：值来自后端 JSON 与属性面板，数字可能以 `'10'` 这种串回传。
 * number 直取（**含 0 与负数**——角标偏移的平台现值就是 -1），非空数字串转换，
 * 其余（undefined / null / '' / NaN / 对象）→ null =「没填」= 不注入变量。
 */
function chromeNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * 描边边数 → `border-width` 简写组合。卡片框恒 1px 四边，「只留一条边」由简写表达，
 * CSS 侧消费的是 `border-width: var(--card-border-side, 1px)`。
 * 缺省档 `'all'` 刻意**不进表** → 查不到 → 不注入 → 走四边各 1px 的现值。
 */
const BORDER_SIDE_WIDTH: Record<string, string> = {
  top: '1px 0 0',
  bottom: '0 0 1px',
  left: '0 0 0 1px',
  right: '0 1px 0 0',
}

/** 呼吸描边的缺省周期（秒），与 CSS 侧 `var(--card-pulse-dur, 6s)` 的兜底一致。 */
const BREATHE_SECONDS = 6

/** 悬停上浮的过渡时长：配了上浮才打开，否则「瞬间跳一下」不像悬停反馈。 */
const HOVER_LIFT_DURATION = '0.3s'

/** 把算出来的值写进变量表；`undefined` = 没填 = 不写这一条。 */
function put(
  out: Record<string, string>,
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) out[name] = value
}

/**
 * 原样透传的取值。只认字符串与有限数值：对象 / 布尔进不了 CSS，
 * 硬塞会变成 `[object Object]` 这种既不报错也不生效的声明。
 */
function rawOf(chrome: CardChrome, key: ChromeKey): string | undefined {
  const value = chrome[key]
  if (typeof value === 'string') return value === '' ? undefined : value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined
  }
  return undefined
}

/** 数值 → px（0 合法；只有「没填」才跳过）。 */
function pxOf(chrome: CardChrome, key: ChromeKey): string | undefined {
  const parsed = chromeNum(chrome[key])
  return parsed === null ? undefined : `${parsed}px`
}

/** 数值 → s（动画时长）。 */
function secOf(chrome: CardChrome, key: ChromeKey): string | undefined {
  const parsed = chromeNum(chrome[key])
  return parsed === null ? undefined : `${parsed}s`
}

/** 数值 → 无单位（透明度这类比例值）。 */
function numOf(chrome: CardChrome, key: ChromeKey): string | undefined {
  const parsed = chromeNum(chrome[key])
  return parsed === null ? undefined : String(parsed)
}

/** 背景 / 描边 / 圆角 / 两个显隐开关。 */
function frameVars(chrome: CardChrome): Record<string, string> {
  const out: Record<string, string> = {}
  put(out, '--card-bg', rawOf(chrome, 'bg'))
  put(out, '--card-border', rawOf(chrome, 'border'))
  put(out, '--card-border-hover', rawOf(chrome, 'borderHover'))
  put(out, '--card-corner-color', rawOf(chrome, 'cornerColor'))
  put(out, '--card-title-color', rawOf(chrome, 'titleColor'))
  put(out, '--card-radius', pxOf(chrome, 'radius'))
  // 四角与标题只在**显式关闭**时注入 none：缺省与 true 都走继承，标题照常显示
  if (chrome.corners === false) out['--card-corner-display'] = 'none'
  if (chrome.showTitle === false) out['--card-title-display'] = 'none'
  return out
}

/** 呼吸开关与只描一条边。 */
function borderVars(chrome: CardChrome): Record<string, string> {
  const out: Record<string, string> = {}
  // 与边框样式正交的「呼吸」开关：任何描边样式都能叠一层明暗呼吸，不必为每种样式各造
  // 一个枚举值。CSS 侧写的是 `animation: var(--card-anim, none)`，故注入的是**简写串**
  if (chrome.borderPulse === true) {
    const seconds = chromeNum(chrome.borderPulseDuration) ?? BREATHE_SECONDS
    out['--card-anim'] = `dt-card-breathe ${seconds}s ease-in-out infinite`
  }
  put(out, '--card-pulse-dur', secOf(chrome, 'borderPulseDuration'))
  const side = chrome.borderSide
  put(
    out,
    '--card-border-side',
    typeof side === 'string' ? BORDER_SIDE_WIDTH[side] : undefined,
  )
  return out
}

/** 角标几何。角标形状不是变量而是修饰类，见 cardChromeClasses。 */
function cornerVars(chrome: CardChrome): Record<string, string> {
  const out: Record<string, string> = {}
  put(out, '--card-corner-size', pxOf(chrome, 'cornerSize'))
  put(out, '--card-corner-glow', pxOf(chrome, 'cornerGlow'))
  put(out, '--card-corner-opacity', numOf(chrome, 'cornerOpacity'))
  put(out, '--card-corner-off', pxOf(chrome, 'cornerOffset'))
  return out
}

/**
 * 标题内边距 → 「上 左右 下」三值简写。
 * 三个都得是合法数值，缺一个就整条放弃：宁可不生效，也不产出半截非法的 padding。
 */
function titlePadValue(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined
  const [top, sides, bottom] = value.map((cell) => chromeNum(cell))
  if (top == null || sides == null || bottom == null) return undefined
  return `${top}px ${sides}px ${bottom}px`
}

/** 标题条的排版与配色。 */
function titleVars(chrome: CardChrome): Record<string, string> {
  const out: Record<string, string> = {}
  // 纵向对齐只有贴底一档需要动，居中就是现值
  if (chrome.titleAlign === 'bottom') out['--card-title-align'] = 'flex-end'
  put(out, '--card-title-pad', titlePadValue(chrome.titlePadding))
  // 竖条与文字的间距同时管「竖条 ↔ 文字」与「文字 ↔ 右侧装饰带」，落到 0 就是两侧都
  // 贴死，没有任何版式用得上，故 ≤0 按未设置处理、退回平台现值
  const gap = chromeNum(chrome.titleGap)
  if (gap !== null && gap > 0) out['--card-title-gap'] = `${gap}px`
  put(out, '--card-title-size', pxOf(chrome, 'titleFontSize'))
  put(out, '--card-title-weight', rawOf(chrome, 'titleFontWeight'))
  put(out, '--card-title-ls', pxOf(chrome, 'titleLetterSpacing'))
  put(out, '--card-title-bar-w', pxOf(chrome, 'titleBarWidth'))
  // 竖条贯穿整行要「满高 + 拉伸对齐」两件套同时生效：只给 height:100% 而 align-self
  // 仍是 center 的话，flex 子项在交叉轴上根本不会被拉开
  if (chrome.titleBarFull === true) {
    out['--card-title-bar-h'] = '100%'
    out['--card-title-bar-align'] = 'stretch'
  }
  put(out, '--card-title-bar-radius', pxOf(chrome, 'titleBarRadius'))
  put(out, '--card-title-bar-glow', pxOf(chrome, 'titleBarGlow'))
  put(out, '--card-title-bar', rawOf(chrome, 'titleBarColor'))
  // 脉动的另一端色必须独立成字段：有的主题主 / 辅色差极小、有的差异巨大
  put(out, '--card-title-bar-alt', rawOf(chrome, 'titleBarColorAlt'))
  return out
}

/** 标题条的脉动与右侧装饰带。 */
function titleMotionVars(chrome: CardChrome): Record<string, string> {
  const out: Record<string, string> = {}
  // 标题栏侧写的是 `animation-name: var(--card-title-anim, none)`（时长与缓动是各自
  // 独立的 CSS 属性），故这两个变量注入的是**纯 keyframes 名**而不是简写串
  if (chrome.titlePulse === true) {
    out['--card-title-anim'] = 'dt-title-pulse'
    out['--card-title-text-anim'] = 'dt-title-glow-pulse'
  }
  put(out, '--card-title-anim-dur', secOf(chrome, 'titlePulseDuration'))
  const rule = chrome.titleRule
  if (rule === 'line' || rule === 'hatch') {
    out['--card-title-rule-display'] = 'block'
    // 装饰带要吃掉标题右侧余量，故把文字的 flex-grow 从 1 改成 0。
    // ⚠ 必须是 `0 1 auto` 而不是 `none`（= `0 0 auto`）：后者连收缩都不允许，
    // 标题一长就顶出标题行被裁掉半个字，而不是走本该生效的省略号
    out['--card-title-text-flex'] = '0 1 auto'
    // 细线档 = 把 45° 斜纹图层打成透明，只留底部那条实线。刻意**不**改带高：
    // 带高一变，标题行的交叉轴布局会跟着变，还会与用户显式的装饰带高度打架
    if (rule === 'line') out['--card-title-rule-hatch'] = 'transparent'
  }
  put(out, '--card-title-rule-h', pxOf(chrome, 'titleRuleHeight'))
  put(out, '--card-title-rule-opacity', numOf(chrome, 'titleRuleOpacity'))
  return out
}

/** 卡片框整体质感：毛玻璃与悬停上浮。 */
function fxVars(chrome: CardChrome): Record<string, string> {
  const out: Record<string, string> = {}
  // 字段是「模糊半径 px 数」，而 CSS 侧消费的是**整条 backdrop-filter 值**，注入裸
  // `9.6px` 会在计算值阶段静默失效，故这里负责包成完整函数串。≤0 显式注入 none：
  // blur(0px) 仍是非 none 的滤镜，会新建合成层与层叠上下文、改变内部绝对定位元素的
  // 包含块，与「没有这条声明」不等价
  const blur = chromeNum(chrome.backdropBlur)
  if (blur !== null) {
    out['--card-backdrop-blur'] = blur > 0 ? `blur(${blur}px)` : 'none'
  }
  const lift = chromeNum(chrome.hoverLift)
  if (lift !== null) {
    out['--card-hover-lift'] = `${lift}px`
    if (lift !== 0) out['--card-hover-lift-dur'] = HOVER_LIFT_DURATION
  }
  return out
}

/**
 * chrome 袋子 → `--card-*` 覆盖变量。
 *
 * 铁律：「**未设置 = 不注入变量 = 走 CSS 的 `var(--x, 现值)` 兜底 = 平台现有默认值**」，
 * 故没写的键一个变量都不产出。约定：数值字段一律带单位输出（px / s）；布尔字段只认严格
 * `true`（否则 JSON 里的 `'false'` 字符串会把动效意外点亮）；枚举字段只认白名单值。
 * @param chrome 已合并的 chrome 袋子
 */
export function cardVars(chrome: CardChrome): Record<string, string> {
  return {
    ...frameVars(chrome),
    ...borderVars(chrome),
    ...cornerVars(chrome),
    ...titleVars(chrome),
    ...titleMotionVars(chrome),
    ...fxVars(chrome),
  }
}

/**
 * chrome 袋子 → 卡片框上的修饰类。
 *
 * 这三个键走类而不是变量：边框样式与角标形状要换的是整套画法（伪元素几何、多层阴影），
 * 不是某一个值；悬停辉光写成 `box-shadow: var(--x)` 的话，变量缺席会让整条声明失效成
 * none，反而把边框样式自带的阴影在悬停时抹掉——类名缺席则完全不产生这条规则。
 * @param chrome 已合并的 chrome 袋子
 */
export function cardChromeClasses(chrome: CardChrome): string[] {
  const classes: string[] = []
  const border = chrome.borderStyle
  // 未设置就不写类：观感完全交给基类，与「未设置 = 不写值」同一条铁律。
  // 无边框档也不写：那一档是整个卡片框退场，由宿主去掉卡片类表达
  if (border != null && border !== '' && !isChromeFrameless(chrome)) {
    classes.push(`dt-card-border--${normalizeCardBorderStyle(border)}`)
  }
  if (chrome.cornerStyle === 'dot') classes.push('dt-corners--dot')
  if (chrome.hoverGlow === true) classes.push('dt-module--hover-glow')
  return classes
}

/** 一格的卡片外观渲染结果：内联变量 + 修饰类 + 还套不套卡片框。 */
export interface CardChromeRender {
  isFramed: boolean
  /** ⚠ 一个键都没配时是 `undefined` 而不是空对象：空 style 属性就不再是零注入。 */
  style: Record<string, string> | undefined
  classes: string[]
}

/**
 * 两级 chrome 合并后算出这一格要挂的东西，是渲染侧唯一的入口。
 * @param base 大屏级 `chrome_json.card`
 * @param override 模块级 `config_json.__cardStyle`
 * @param isCard 清单声明本模块套卡片框（裸渲染模块没有框可修饰）
 */
export function resolveCardChrome(
  base: unknown,
  override: unknown,
  isCard: boolean,
): CardChromeRender {
  const chrome = mergeCardChrome(base, override)
  const isFramed = isCard && !isChromeFrameless(chrome)
  const vars = cardVars(chrome)
  return {
    isFramed,
    style: Object.keys(vars).length === 0 ? undefined : vars,
    classes: isFramed ? cardChromeClasses(chrome) : [],
  }
}
