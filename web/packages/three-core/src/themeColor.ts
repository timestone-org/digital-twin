/**
 * @fileoverview 3D 侧取色的单一真源：颜色规格（`#rrggbb` 或 `--token`）→ `THREE.Color`。
 * 规格的形状由 `@dt/twin-config` 归一化，取值只有在有 CSS 级联的宿主里才解析得出来。
 */
import * as THREE from 'three'

/** 强调色 token，锚点等装饰件的取色入口。 */
export const ACCENT_COLOR_TOKEN = '--accent-primary'

/** `setStyle` 认得的形状：三位或六位 hex、rgb()/rgba() 函数式 */
const CSS_COLOR_RE = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6})|rgba?\([^)]*\))$/i

function readCssVariable(token: string, host: HTMLElement | null): string {
  if (host === null || typeof getComputedStyle !== 'function') return ''
  return getComputedStyle(host).getPropertyValue(token).trim()
}

/**
 * 颜色规格 → `THREE.Color`；取不出返回 null。
 * ⚠ 取不出时不许回落成某个默认色：那会让「token 名写错了」看起来像「配对了」，
 * 而 3D 里没有任何别的迹象能提示这一点。
 * @param spec `#rrggbb` 或 `--token`
 * @param host 读 CSS 变量级联的宿主元素
 */
export function resolveColorSpec(
  spec: string,
  host: HTMLElement | null,
): THREE.Color | null {
  const text = spec.trim()
  const value = text.startsWith('--') ? readCssVariable(text, host) : text
  return CSS_COLOR_RE.test(value) ? new THREE.Color().setStyle(value) : null
}

/**
 * 颜色规格的记忆表：同一个规格只解析一次。
 *
 * ⚠ token 的取值要走 `getComputedStyle` 读 CSS 级联，那是布局相关的同步调用——
 * 每帧给每个部件解析一次会直接吃掉帧预算，而画面上只表现为「模型一多就卡」。
 * ⚠ 表里的 `THREE.Color` 是**共享只读**的：调用方要改色必须先 `clone()`，
 * 就地改会让下一个用同一个规格的元素跟着变色。
 */
export class ColorSpecCache {
  private readonly memo = new Map<string, THREE.Color | null>()

  constructor(private readonly host: HTMLElement | null) {}

  /**
   * 取一个规格解析出来的颜色；解析不出来给 null。
   * @param spec `#rrggbb` 或 `--token`；空串一律 null
   */
  get(spec: string): THREE.Color | null {
    if (spec === '') return null
    const hit = this.memo.get(spec)
    if (hit !== undefined) return hit
    const color = resolveColorSpec(spec, this.host)
    this.memo.set(spec, color)
    return color
  }

  /** 主题换了或重建了图层时清空；不清的话换肤后仍是上一套配色。 */
  clear(): void {
    this.memo.clear()
  }
}
