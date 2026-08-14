/**
 * @fileoverview 客户端生成的两种 id：请求的幂等键，与前端先给的节点 id。
 *
 * ⚠ 两者都不用 `crypto.randomUUID()`：它只在**安全上下文**（HTTPS 或 localhost）
 * 里存在。本平台按内网 IP 走纯 HTTP 交付，那里 `crypto.randomUUID` 是 undefined，
 * 调用直接抛 TypeError——而它只在现场炸，开发机（localhost）永远复现不了。
 */

const HEX_DIGITS = '0123456789abcdef'

/** 幂等键：时间戳前缀让它按发起时刻大致有序，便于对日志。 */
export function newIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2)
  const more = Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}-${random}${more}`
}

/** 随机十六进制串。 */
function randomHex(length: number): string {
  let out = ''
  for (let index = 0; index < length; index += 1) {
    out += HEX_DIGITS[Math.floor(Math.random() * HEX_DIGITS.length)] ?? '0'
  }
  return out
}

/**
 * RFC 4122 v4 形状的 id，给编辑器里**尚未落库**的节点用。
 * ⚠ 新节点的 id 必须由前端先给：同一次整树替换里的子节点要写得出 `parent_id`，
 * 而服务端只按 id 三路比对、不重新生成（ADR-0012 二）。
 * ⚠ 取值来自 `Math.random`，只用于本地标识，不做任何安全用途。
 */
export function newClientUuid(): string {
  // 变体位固定落在 8..b，版本位固定 4——服务端按 uuid 解析，形状不对当场 422
  const variant = HEX_DIGITS[8 + Math.floor(Math.random() * 4)] ?? '8'
  const head = `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}`
  return `${head}-${variant}${randomHex(3)}-${randomHex(12)}`
}
