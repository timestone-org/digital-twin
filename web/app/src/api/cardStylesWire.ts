/**
 * @fileoverview 卡片样式出参的线形（后端 snake_case）与它到载荷（camelCase）的映射。
 */
import type { CardChrome, CardStyle } from '@dt/contracts'
import { isChromeKey } from '@dt/contracts'

export interface CardStyleWire {
  id: string
  name: string
  description: string | null
  module_type: string | null
  chrome_json: Record<string, unknown>
  config_json: Record<string, unknown>
  thumbnail: string | null
  created_at: string
  updated_at: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * 外壳段窄化：只留登记过的键。
 *
 * ⚠ 库里那袋是自由 JSON，可能带着一个已经从 `CHROME_KEYS` 里删掉的旧键——
 * 原样透传的话，它会跟着「另存为」一路存回去，永远清不掉；而渲染侧早就不认它了。
 * @param value 线上的外壳袋
 */
export function toCardChrome(value: unknown): CardChrome {
  const out: CardChrome = {}
  for (const [key, cell] of Object.entries(asRecord(value))) {
    if (isChromeKey(key)) out[key] = cell
  }
  return out
}

/**
 * 一条样式的载荷。
 * @param wire 线上的样式
 */
export function toCardStyle(wire: CardStyleWire): CardStyle {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    moduleType: wire.module_type,
    chrome: toCardChrome(wire.chrome_json),
    // ⚠ 内芯不窄化：观感键是逐模块的，这一层不认识任何一个模块；
    //   该拦的在服务端拦（写入时按目录校验），读侧原样带过去
    config: asRecord(wire.config_json),
    thumbnail: wire.thumbnail,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  }
}
