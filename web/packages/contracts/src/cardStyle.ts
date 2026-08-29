/**
 * @fileoverview 卡片样式：用户自己存下来的一整套观感取值，全站共享。
 * 分两段——**外壳**（`CardChrome`，键出自 `CHROME_KEYS`，任何模块都吃）与
 * **内芯**（某一个模块自己的观感键）。见 docs/CARD_STYLE_LIBRARY_DESIGN.md。
 */
import type { CardChrome } from './chrome'

export interface CardStyle {
  id: string
  name: string
  description: string | null
  /**
   * 绑哪个模块类型；**null = 通用外壳样式**，套到任何模块上都只写外壳。
   * ⚠ 非空时才允许有内芯：`info-card` 的观感键写到 `gauge-card` 上既不报错
   * 也不生效，正是这套东西最该拦住的那类静默失效。
   */
  moduleType: string | null
  /** 外壳段，落到节点的 `config_json.__cardStyle` 或大屏级 `chrome_json.card`。 */
  chrome: CardChrome
  /**
   * 内芯段，浅合并进节点 `config_json` 的顶层。
   * ⚠ `moduleType` 为 null 时恒为空对象——服务端也有一条同义的库级约束。
   */
  config: Record<string, unknown>
  /** 缩略图 data URL；存样式时从预览区截一张，之后不回溯。 */
  thumbnail: string | null
  createdAt: string
  updatedAt: string
}
