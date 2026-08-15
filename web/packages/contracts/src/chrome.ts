/**
 * @fileoverview 卡片外观（chrome）的键词汇表：大屏级 `chrome_json.card` 与模块级
 * `config_json.__cardStyle` 这两只无类型袋子里允许出现的全部键及其类型 / 合法值。
 * 编辑器字段组与渲染侧的 `cardVars` 共用这一份，选项从目录推导（DASHBOARD_DESIGN §5.3 ⑤）。
 */

/** 键的取值类型：决定编辑器摆哪种控件、渲染侧按哪种口径解析。 */
export type ChromeKeyType =
  /** CSS 颜色表达式，原样透传（含 `var(--token)`）。 */
  | 'color'
  /** 数值；`'10'` 这类数字串同样合法（后端 JSON 里的自由值）。 */
  | 'number'
  /** 只认严格 `true`。 */
  | 'boolean'
  /** `values` 白名单内的字符串。 */
  | 'enum'
  /** `number[3]`，「上 左右 下」三值简写。 */
  | 'number3'

export interface ChromeKeySpec {
  key: string
  type: ChromeKeyType
  /**
   * 合法值白名单（仅 `enum`）。**不含「未设置」**——那是删键，不是一个值，
   * 故凡是「缺省档」的枚举值（`borderSide:'all'` / `cornerStyle:'bracket'` /
   * `titleAlign:'center'`）都不在表里。
   */
  values?: readonly string[]
}

/**
 * 边框样式的合法值。带 label 的选项表（面板选项源 + `normalizeCardBorderStyle` 的白名单）
 * 在 `@dt/runtime` 的 `CARD_BORDER_STYLE_OPTIONS`：值在契约层、译名在渲染层，
 * 两者逐字一致由 chromeKeyCatalog 契约测试锁死——两份各写一遍就一定会漂。
 */
const BORDER_STYLE_VALUES = [
  'solid',
  'glow',
  'double',
  'dashed',
  'bracket',
  'cut',
  'breathe',
  'none',
] as const

/**
 * 全部 chrome 键，分节顺序与编辑器字段组的面板顺序一致。
 *
 * ⚠ 刻意**不复用 `ConfigField`**：两套系统的不变量是相反的。chrome 的铁律是
 * 「未设置 = 不写值」——键不存在才不注入 `--card-*`，渲染才落回 `var(--x, 现值)`
 * 的平台缺省与主题；而 `ConfigField.default` 是「没配过就用它兜底」，两者合成一套
 * 会让每张卡片都带上显式值，等于把当下的默认观感固化进存量大屏
 * （`ConfigField.default` 的注释里那条「改它会改变存量大屏渲染」正是这个坑）。
 *
 * 本清单只收**键的词汇表**：`--card-*` 的发射规则逐键特例（animation 简写串、
 * 三值简写、修饰类而非变量、只有某一档才注入……）属于渲染侧，留在 `cardVars`。
 * 两侧的穷尽对齐由 `packages/runtime/tests/chromeKeyCatalog.contract.test.ts` 双向锁死。
 */
export const CHROME_KEYS = [
  /* 常显块 */
  { key: 'borderStyle', type: 'enum', values: BORDER_STYLE_VALUES }, // 边框样式
  { key: 'bg', type: 'color' }, // 卡片背景
  { key: 'border', type: 'color' }, // 边框色
  { key: 'borderHover', type: 'color' }, // 悬停边框色（兼呼吸描边的亮端色）
  { key: 'cornerColor', type: 'color' }, // 角标色
  { key: 'radius', type: 'number' }, // 圆角
  { key: 'corners', type: 'boolean' }, // 四角辉光
  { key: 'showTitle', type: 'boolean' }, // 显示标题
  { key: 'titleColor', type: 'color' }, // 标题色

  /* 边框 */
  { key: 'borderPulse', type: 'boolean' }, // 呼吸描边
  { key: 'borderPulseDuration', type: 'number' }, // 呼吸周期（秒）
  {
    key: 'borderSide',
    type: 'enum',
    values: ['top', 'bottom', 'left', 'right'],
  }, // 描边边数
  /* 四角 */
  { key: 'cornerStyle', type: 'enum', values: ['dot'] }, // 角标形状（缺省 L 形角括号）
  { key: 'cornerSize', type: 'number' }, // 角标尺寸
  { key: 'cornerGlow', type: 'number' }, // 角标辉光
  { key: 'cornerOpacity', type: 'number' }, // 角标透明度
  { key: 'cornerOffset', type: 'number' }, // 角标偏移

  /* 标题条 */
  { key: 'titleAlign', type: 'enum', values: ['bottom'] }, // 纵向对齐（缺省居中）
  { key: 'titlePadding', type: 'number3' }, // 标题内边距
  { key: 'titleGap', type: 'number' }, // 竖条与文字间距
  { key: 'titleFontSize', type: 'number' }, // 标题字号
  {
    key: 'titleFontWeight',
    type: 'enum',
    values: ['400', '500', '600', '700'],
  }, // 标题字重
  { key: 'titleLetterSpacing', type: 'number' }, // 标题字距
  { key: 'titleBarWidth', type: 'number' }, // 竖条宽度
  { key: 'titleBarFull', type: 'boolean' }, // 竖条贯穿整行
  { key: 'titleBarRadius', type: 'number' }, // 竖条圆角
  { key: 'titleBarGlow', type: 'number' }, // 竖条辉光
  { key: 'titleBarColor', type: 'color' }, // 竖条颜色
  { key: 'titleBarColorAlt', type: 'color' }, // 竖条脉动辅色
  { key: 'titlePulse', type: 'boolean' }, // 标题脉动
  { key: 'titlePulseDuration', type: 'number' }, // 脉动周期（秒）
  { key: 'titleRule', type: 'enum', values: ['line', 'hatch'] }, // 标题右侧装饰带
  { key: 'titleRuleHeight', type: 'number' }, // 装饰带高度
  { key: 'titleRuleOpacity', type: 'number' }, // 装饰带透明度

  /* 文字：整格的正文排版缺省，靠继承往下走。模块自己配了的一律赢过它 */
  {
    key: 'fontFamily',
    type: 'enum',
    values: ['sans', 'display', 'mono'],
  }, // 正文字体
  { key: 'fontSize', type: 'number' }, // 正文字号
  { key: 'textColor', type: 'color' }, // 正文字色

  /* 交互 */
  { key: 'backdropBlur', type: 'number' }, // 毛玻璃模糊
  { key: 'hoverLift', type: 'number' }, // 悬停上浮
  { key: 'hoverGlow', type: 'boolean' }, // 悬停辉光
] as const satisfies readonly ChromeKeySpec[]

/** 合法 chrome 键名的联合类型——三个消费方写错键名即 typecheck 失败。 */
export type ChromeKey = (typeof CHROME_KEYS)[number]['key']

/**
 * 一只 chrome 袋子（`chrome_json.card` / `config_json.__cardStyle`），也是面板整包的形状。
 * 全键可选：**键不存在 = 未设置 = 渲染侧不注入变量**；面板把清空的控件翻译成删键。
 * 值一律 `unknown`——它落库时是自由 JSON，读侧各自容错。
 */
export type CardChrome = Partial<Record<ChromeKey, unknown>>

const CHROME_KEY_SET = new Set<string>(CHROME_KEYS.map((spec) => spec.key))

/**
 * 是否为清单登记过的 chrome 键。
 * @param key 待判定的键名
 */
export function isChromeKey(key: string): key is ChromeKey {
  return CHROME_KEY_SET.has(key)
}
