/**
 * @fileoverview 颜色取值解析：DtColorInput 的单一口径。
 *
 * 裸 `--x` 与 `var(--x)` 双向接受——只认一种时用户在不同面板要记两套写法，
 * 而写错的那种不报错、只是静默失效。
 */

// token 解析的跳数上限
const MAX_VAR_HOPS = 8

/**
 * `#rgb` / `#rrggbb` 规范化成小写 `#rrggbb`；不是 hex 返回 null。
 * @param raw 原始文本
 */
export function expandHex(raw: string): string | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
    .exec(raw.trim())?.[1]
    ?.toLowerCase()
  if (hex === undefined) return null
  if (hex.length === 6) return `#${hex}`
  return `#${[...hex].map((digit) => `${digit}${digit}`).join('')}`
}

function toByte(value: number): string {
  return Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
}

/**
 * `rgb()` / `rgba()` 转 `#rrggbb`，透明度丢弃——取色器无从表达它。
 * @param raw 原始文本，逗号与空格两种分隔都认（getComputedStyle 两种都会给）
 */
export function rgbToHex(raw: string): string | null {
  const match = /rgba?\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)/i.exec(
    raw,
  )
  if (match === null) return null
  const channels = match.slice(1, 4).map(Number)
  if (channels.some((value) => !Number.isFinite(value))) return null
  return `#${channels.map(toByte).join('')}`
}

/**
 * 颜色规格转成能直接喂给 CSS 的表达式；裸 token 补成 `var(...)`。
 * @param spec 原始颜色规格，空值渲染成透明
 */
export function toCssColor(spec: string | undefined | null): string {
  const value = (spec ?? '').trim()
  if (value === '') return 'transparent'
  return value.startsWith('--') ? `var(${value})` : value
}

/** 颜色名靠浏览器算：塞一个探针进宿主，读它的计算色。 */
function probeNamedColor(value: string, host: HTMLElement): string | null {
  const probe = document.createElement('span')
  probe.style.color = value
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  host.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  return rgbToHex(computed)
}

function resolve(
  raw: string,
  host: HTMLElement | null,
  hops: number,
): string | null {
  const value = raw.trim()
  if (value === '') return null
  const direct = expandHex(value) ?? rgbToHex(value)
  if (direct !== null) return direct
  if (host === null) return null

  const token = /^(?:var\(\s*)?(--[\w-]+)/.exec(value)?.[1]
  if (token === undefined) return probeNamedColor(value, host)
  // ⚠ 自引用的 token（`--a: var(--a)`）在部分环境里原样返回，不限跳数就是死循环
  if (hops <= 0) return null
  return resolve(getComputedStyle(host).getPropertyValue(token), host, hops - 1)
}

/**
 * 任意 CSS 颜色解析成 `#rrggbb`，供原生取色器当初值；解析不出返回 null。
 * @param raw hex / rgb() / 颜色名 / `--token` / `var(--token)`
 * @param host 读 CSS 变量级联的宿主；为 null 时 token 与颜色名两条路都走不通
 */
export function resolveColorToHex(
  raw: string,
  host: HTMLElement | null,
): string | null {
  return resolve(raw, host, MAX_VAR_HOPS)
}
