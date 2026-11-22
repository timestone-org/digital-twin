/** @fileoverview 续期请求绑定发起时的会话主体。 */
export interface RequestOwner {
  readonly token: string | null
  readonly session: string | null
}

/** 有会话信息时允许同一主体轮换令牌，旧存储缺少主体时只认可原令牌。 */
export function sameRequestOwner(
  before: RequestOwner,
  after: RequestOwner,
): boolean {
  return before.session === null
    ? before.token === after.token
    : before.session === after.session
}
