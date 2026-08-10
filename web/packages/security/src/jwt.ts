/**
 * @fileoverview 只读地解 JWT 的 exp，用来在到期前主动刷新。
 * ⚠ 这里**不做任何校验**：前端解出来的载荷只用于安排定时器，
 * 真正的校验在服务端。任何解析失败都按「不做主动刷新」处理。
 */

/** 取 access token 的过期时刻（Unix 秒）；非 JWT 或缺 exp 返回 null。 */
export function readTokenExpiry(token: string): number | null {
  const payload = token.split('.')[1]
  if (payload === undefined) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = decodeURIComponent(
      atob(normalized)
        .split('')
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    )
    const parsed: unknown = JSON.parse(decoded)
    if (typeof parsed !== 'object' || parsed === null) return null
    const exp = (parsed as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}

/**
 * 令牌是否已过期（可留出提前量）。
 * ⚠ 无 token 视为过期；解不出 exp 视为**未**过期——那种情况交给
 * 被动 401 兜底，比误把人踢下线好。
 * @param token 待判定的 access token
 * @param skewSeconds 提前量，到期前这么久即视为过期
 * @param nowMs 当前时刻，测试注入
 */
export function isTokenExpired(
  token: string | null,
  skewSeconds = 0,
  nowMs: number = Date.now(),
): boolean {
  if (token === null || token === '') return true
  const exp = readTokenExpiry(token)
  if (exp === null) return false
  return exp - skewSeconds <= nowMs / 1000
}
